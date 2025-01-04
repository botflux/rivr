import { setTimeout } from "node:timers/promises"
import {
  BatchStep,
  failure,
  isStepResult,
  SingleStep,
  Step,
  StepExecutionContext,
  StepResult,
  success,
  Workflow
} from "../workflow";
import {PollerRecord, StorageInterface, Write} from "./storage.interface";
import {GetTimeToWait} from "../retry";
import EventEmitter, {once} from "node:events";
import {StartOpts, WorkerInterface} from "../worker.interface";

export class Poller<T> extends EventEmitter implements WorkerInterface {
  private stopped = true

  constructor(
    private readonly pollerId: string,
    private readonly minTimeBetweenPollsMs: number,
    private readonly getStorage: () => Promise<StorageInterface<T>>,
    private readonly workflow: Workflow<T>,
    private readonly pageSize: number,
    private readonly maxRetry: number,
    private readonly timeBetweenRetries: GetTimeToWait
  ) {
    super()
  }

  /**
   * Start the poller.
   *
   * @param opts
   */
  start(opts: StartOpts = {}): void {
    const { signal } = opts

    if (!this.stopped) {
      return
    }

    this.stopped = false

    ;(async () => {
      try {
        this.emit("started")
        for (const _ of this.stoppableInfiniteLoop(signal)) {
          const storage = await this.getStorage()

          const [isPaginationExhausted, records] = await storage.poll(
            this.pollerId,
            this.workflow,
            this.pageSize,
            this.maxRetry
          )

          const recordsByStep = this.groupRecordsByStep(this.workflow, records)

          for (const [ step, records ] of recordsByStep) {
            const results = step.type === "single"
              ? await this.handleSingleStep(step, records)
              : await this.handleBatchStep(step, records)

            const writes: Write<T>[] = results.map(([ record, result ]) => {
              switch (result.type) {
                case "success": {
                  const mNextStep = this.workflow.getNextStep(step)
                  return mNextStep === undefined
                    ? [
                      {
                        type: "ack",
                        record
                      }
                    ] satisfies Write<T>[]
                    : [
                      {
                        type: "ack",
                        record
                      },
                      {
                        type: "publish",
                        record: {
                          recipient: mNextStep.name,
                          belongsTo: this.workflow.name,
                          createdAt: new Date(),
                          state: result.value ?? record.state,
                          tenant: record.tenant,
                          attempt: 1
                        }
                      }
                    ] satisfies Write<T>[]
                }
                case "failure": {
                  return [
                    {
                      type: "nack",
                      record,
                      timeBetweenRetries: this.timeBetweenRetries
                    }
                  ] satisfies Write<T>[]
                }
                case "skip": {
                  const mNextStep = this.workflow.getNextStep(step, 2)
                  return mNextStep === undefined
                    ? [
                      {
                        type: "ack",
                        record
                      }
                    ] satisfies Write<T>[]
                    : [
                      {
                        type: "ack",
                        record
                      },
                      {
                        type: "publish",
                        record: {
                          recipient: mNextStep.name,
                          belongsTo: this.workflow.name,
                          createdAt: new Date(),
                          state: record.state,
                          attempt: 1,
                          tenant: record.tenant
                        }
                      }
                    ] satisfies Write<T>[]
                }
                case "stop": {
                  return [
                    {
                      type: "ack",
                      record,
                    }
                  ] satisfies Write<T>[]
                }
              }
            }).flat()

            await storage.batchWrite(writes)
          }

          if (isPaginationExhausted) {
            await setTimeout(this.minTimeBetweenPollsMs, undefined, { signal })
          }
        }
      } catch (e) {
        if (this.listenerCount("error") > 0) {
          this.emit("error", e)
        }
      }
    })()
  }

  /**
   * Stop the poller and wait for it to be stopped.
   * The poller will finish its last poll before stopping.
   *
   * Use `stop()` if you don't need to wait for the poller to be stopped.
   */
  async stopAndWaitToBeStopped (): Promise<void> {
    const p = once(this, "stopped")
    this.stopped = true
    await p
  }

  /**
   * Stop the poller.
   * The poller will finish its last poll before stopping.
   * You can wait for `stopped` event to be fired.
   * You can also call `stopAndWaitToBeStopped` also.
   */
  stop (): void {
    this.stopped = true
  }

  private groupRecordsByStep (workflow: Workflow<T>, records: PollerRecord<T>[]): [Step<T>, PollerRecord<T>[]][] {
    const pollerRecordsAndStep = records
      .map(r => [r, workflow.getStepByName(r.recipient)] as const)
      .filter(([, mStep]) => mStep !== undefined) as [ PollerRecord<T>, Step<T> ][]

    return pollerRecordsAndStep.reduce (
      (acc: [Step<T>, PollerRecord<T>[]][], [ record, step ])=> {
        const [ , records ] = acc.find(([s]) => s.name === step.name) ?? [ undefined, [] ]

        return [
          ...acc.filter(([ s ]) => s.name !== step.name),
          [ step, [ ...records, record ] ]
        ]
      },
      []
    )
  }

  private handleSingleStep(step: SingleStep<T>, records: PollerRecord<T>[]): Promise<[PollerRecord<T>, StepResult<T>][]> {
    return Promise.all(records.map(async record => {
      try {
        const result = await step.handler({
          state: record.state,
          metadata: {
            attempt: record.attempt,
            tenant: record.tenant,
            id: record.id
          }
        }, {
          workerId: this.pollerId
        })
        // const result = await step.handler(record.state, record.context, this.pollerId)

        if (result === undefined) {
          return [record, success(record.state)] as const
        }

        return [record, isStepResult(result) ? result : success(result)] as const
      } catch (e) {
        return [record, failure(e)] as const
      }
    }))
  }

  private * stoppableInfiniteLoop (signal?: AbortSignal) {
    signal?.addEventListener("abort", () => this.stopped = true)

    while (!this.stopped) {
      yield
    }

    this.emit("stopped")
  }

  private async handleBatchStep(step: BatchStep<T>, records: PollerRecord<T>[]): Promise<[PollerRecord<T>, StepResult<T>][]> {
    try {
      const contexts: StepExecutionContext<T>[] = records.map(record => ({
        metadata: { attempt: record.attempt, tenant: record.tenant, id: record.id },
        state: record.state
      }))
      const results = await step.handler(contexts, {
        workerId: this.pollerId
      })

      if (results === undefined) {
        return records.map(r => [ r, success(r.state) ])
      }

      if (results.length !== records.length) {
        throw new Error("Not implemented at line 219 in poller.ts")
      }
      
      return results.map ((result, i) => [ records[i], isStepResult(result) ? result : success(result) ] as const)
    } catch (e) {
      return records.map(r => [ r, failure(e)])
    }
  }
}