import { setTimeout } from "node:timers/promises"
import {failure, isStepResult, Step, StepHandlerContext, StepResult, success, Workflow} from "../workflow";
import {StorageInterface, WithoutIt} from "./storage.interface";
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

            const result = await this.handle(mStep, record.state, record.context)

            if (result.type === "success") {
              const mNextStep = this.workflow.getNextStep(mStep)

              if (!mNextStep) {
                await this.storage.acknowledge(record)
                continue
              }

              const newRecord: WithoutIt<T> = {
                recipient: mNextStep?.name,
                belongsTo: this.workflow.name,
                createdAt: new Date(),
                state: result.value ?? record.state,
                context: { attempt: 1 }
              }

              await this.storage.publishAndAcknowledge(newRecord, record)
            }
            else if (result.type === "stop") {
              await this.storage.acknowledge(record)
            }
            else if (result.type === "skip") {
              const mNextStep = this.workflow.getNextStep(mStep, 2)

              if (!mNextStep) {
                await this.storage.acknowledge(record)
                continue
              }

              const newRecord: WithoutIt<T> = {
                recipient: mNextStep?.name,
                belongsTo: this.workflow.name,
                createdAt: new Date(),
                state: record.state,
                context: { attempt: 1 }
              }

              await this.storage.publishAndAcknowledge(newRecord, record)
            }
            else {
              await this.storage.nack(record, this.timeBetweenRetries)
            }
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

  async stop () {
    const p = once(this, "stopped")
    this.stopped = true
    return p
  }

  private async handle(step: Step<T>, state: T, context: StepHandlerContext): Promise<StepResult<T>> {
    try {
      const result = await step.handler(state, context, this.pollerId)

      if (result === undefined) {
        return success(state)
      }

      return isStepResult(result) ? result : success(result)
    } catch (error) {
      return failure(error)
    }
  }

  private * stoppableInfiniteLoop (signal: AbortSignal) {
    signal.addEventListener("abort", () => this.stopped = true)

    while (!this.stopped) {
      yield
    }

    this.emit("stopped")
  }
}