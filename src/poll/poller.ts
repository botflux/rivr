import { setTimeout } from "node:timers/promises"
import {
  BatchStep,
  failure,
  isStepResult,
  SingleStep,
  Step,
  StepHandlerContext, StepHandlerContext2,
  StepResult,
  success,
  Workflow
} from "../workflow";
import {PollerRecord, StorageInterface, WithoutIt, Write} from "./storage.interface";
import {GetTimeToWait} from "../retry";
import EventEmitter, {once} from "node:events";

export class Poller<T> extends EventEmitter {
  private stopped = false

  constructor(
    private readonly pollerId: string,
    private readonly minTimeBetweenPollsMs: number,
    private readonly storage: StorageInterface<T>,
    private readonly workflow: Workflow<T>,
    private readonly pageSize: number,
    private readonly maxRetry: number,
    private readonly timeBetweenRetries: GetTimeToWait
  ) {
    super()
  }

  start (signal: AbortSignal): void {
    (async () => {
      try {
        this.emit("started")
        for (const _ of this.stoppableInfiniteLoop(signal)) {
          const [isPaginationExhausted, records] = await this.storage.poll(
            this.pollerId,
            this.workflow,
            this.pageSize,
            this.maxRetry
          )

          const recordsByStep = this.groupRecordsByStep(records)

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

            await this.storage.batchWrite(writes)
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

  async stopAndWaitToBeStopped () {
    const p = once(this, "stopped")
    this.stopped = true
    return p
  }

  stop () {
    this.stopped = true
  }

  private groupRecordsByStep (records: PollerRecord<T>[]): [Step<T>, PollerRecord<T>[]][] {
    const pollerRecordsAndStep = records
      .map(r => [r, this.workflow.getStepByName(r.recipient)] as const)
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
            pollerId: this.pollerId,
            attempt: record.attempt,
            tenant: record.tenant,
            id: record.id
          }
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

  private * stoppableInfiniteLoop (signal: AbortSignal) {
    signal.addEventListener("abort", () => this.stopped = true)

    while (!this.stopped) {
      yield
    }

    this.emit("stopped")
  }

  private async handleBatchStep(step: BatchStep<T>, records: PollerRecord<T>[]): Promise<[PollerRecord<T>, StepResult<T>][]> {
    try {
      const contexts: StepHandlerContext2<T>[] = records.map(record => ({
        metadata: { pollerId: this.pollerId, attempt: record.attempt, tenant: record.tenant, id: record.id },
        state: record.state
      }))
      const results = await step.handler(contexts)

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