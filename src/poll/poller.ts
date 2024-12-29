import { setTimeout } from "node:timers/promises"
import {failure, isStepResult, Step, StepHandlerContext, StepResult, success, Workflow} from "../workflow";
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

          for (const record of records) {
            const mStep = this.workflow.getStepByName(record.recipient)

            if (!mStep)
              continue

            const results = await this.handleBatch(mStep, [ record ])
            const writes: Write<T>[] = results.map(result => {
              switch (result.type) {
                case "success": {
                  const mNextStep = this.workflow.getNextStep(mStep)
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
                          context: { attempt: 1, tenant: record.context.tenant }
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
                  const mNextStep = this.workflow.getNextStep(mStep, 2)
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
                          context: { attempt: 1, tenant: record.context.tenant }
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

  private handleBatch(step: Step<T>, records: PollerRecord<T>[]): Promise<StepResult<T>[]> {
    return Promise.all(records.map(async record => {
      try {
        const result = await step.handler(record.state, record.context, this.pollerId)

        if (result === undefined) {
          return success(record.state)
        }

        return isStepResult(result) ? result : success(result)
      } catch (e) {
        return failure(e)
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
}