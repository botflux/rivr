import { setTimeout } from "node:timers/promises"
import {
  Workflow
} from "../workflow";
import {PollerRecord, StorageInterface, Write} from "./storage.interface";
import {GetTimeToWait} from "../retry";
import EventEmitter, {once} from "node:events";
import {StartOpts, WorkerInterface} from "../worker.interface";
import {
  BatchStep,
  DefaultWorkerMetadata,
  failure,
  isStepResult,
  SingleStep,
  Step,
  StepExecutionContext, StepResult, success
} from "../types";

export class Poller<State, WorkerMetadata extends DefaultWorkerMetadata> extends EventEmitter<{ error: [ unknown ], stopped: [] }> implements WorkerInterface {
  private stopped = true

  constructor(
    public readonly id: string,
    private readonly minTimeBetweenPollsMs: number,
    private readonly getStorage: () => Promise<[StorageInterface<State, WorkerMetadata>, WorkerMetadata]>,
    private readonly workflows: Workflow<State, WorkerMetadata>[],
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
        for (const _ of this.stoppableInfiniteLoop(signal)) {
          const [storage, workerMetadata] = await this.getStorage()

          const [isPaginationExhausted, records] = await storage.poll(
            this.id,
            this.workflows,
            this.pageSize,
            this.maxRetry
          )

          const recordsByStep = this.groupRecordsByStep(this.workflows, records)

          for (const [ step, records ] of recordsByStep) {
            const results = step.type === "single"
              ? await this.handleSingleStep(step, records, workerMetadata)
              : await this.handleBatchStep(step, records, workerMetadata)

            const writes: Write<State>[] = results.map(([ record, result ]) => {
              switch (result.type) {
                case "success": {
                  const mNextStep = step.workflow?.getNextStep(step)
                  return mNextStep === undefined
                    ? [
                      {
                        type: "ack",
                        record
                      }
                    ] satisfies Write<State>[]
                    : [
                      {
                        type: "ack",
                        record
                      },
                      {
                        type: "publish",
                        record: {
                          recipient: mNextStep.name,
                          belongsTo: step.workflow.name,
                          createdAt: new Date(),
                          state: result.value ?? record.state,
                          tenant: record.tenant,
                          attempt: 1
                        }
                      }
                    ] satisfies Write<State>[]
                }
                case "failure": {
                  return [
                    {
                      type: "nack",
                      record,
                      timeBetweenRetries: this.timeBetweenRetries
                    }
                  ] satisfies Write<State>[]
                }
                case "skip": {
                  const mNextStep = step.workflow.getNextStep(step, 2)
                  return mNextStep === undefined
                    ? [
                      {
                        type: "ack",
                        record
                      }
                    ] satisfies Write<State>[]
                    : [
                      {
                        type: "ack",
                        record
                      },
                      {
                        type: "publish",
                        record: {
                          recipient: mNextStep.name,
                          belongsTo: step.workflow.name,
                          createdAt: new Date(),
                          state: record.state,
                          attempt: 1,
                          tenant: record.tenant
                        }
                      }
                    ] satisfies Write<State>[]
                }
                case "stop": {
                  return [
                    {
                      type: "ack",
                      record,
                    }
                  ] satisfies Write<State>[]
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
   * Stop the poller.
   * The poller will finish its last poll before stopping.
   * You can wait for `stopped` event to be fired.
   * You can also call `stopAndWaitToBeStopped` also.
   */
  stop (): void {
    this.stopped = true
  }

  private groupRecordsByStep (workflows: Workflow<State, WorkerMetadata>[], records: PollerRecord<State>[]): [Step<State, WorkerMetadata>, PollerRecord<State>[]][] {
    const pollerRecordsAndStep = records
      .map(r => [r, workflows.find (w => w.name === r.belongsTo)?.getStepByName(r.recipient)] as const)
      .filter(([, mStep]) => mStep !== undefined) as [ PollerRecord<State>, Step<State, WorkerMetadata> ][]

    return pollerRecordsAndStep.reduce (
      (acc: [Step<State, WorkerMetadata>, PollerRecord<State>[]][], [ record, step ])=> {
        const [ , records ] = acc.find(([s]) => s.name === step.name) ?? [ undefined, [] ]

        return [
          ...acc.filter(([ s ]) => s.name !== step.name),
          [ step, [ ...records, record ] ]
        ]
      },
      []
    )
  }

  private handleSingleStep(step: SingleStep<State, WorkerMetadata>, records: PollerRecord<State>[], workerMetadata: WorkerMetadata): Promise<[PollerRecord<State>, StepResult<State>][]> {
    return Promise.all(records.map(async record => {
      try {
        const result = await step.handler({
          state: record.state,
          metadata: {
            attempt: record.attempt,
            tenant: record.tenant,
            id: record.id
          },
          worker: workerMetadata
        })

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

  private async handleBatchStep(step: BatchStep<State, WorkerMetadata>, records: PollerRecord<State>[], workerMetadata: WorkerMetadata): Promise<[PollerRecord<State>, StepResult<State>][]> {
    try {
      const contexts: StepExecutionContext<State, WorkerMetadata>[] = records.map(record => ({
        metadata: { attempt: record.attempt, tenant: record.tenant, id: record.id },
        state: record.state,
        worker: workerMetadata
      }))
      const results = await step.handler(contexts, {
        workerId: this.id
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