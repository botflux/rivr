import {Consumption, Queue, Write} from "./base-infrastructure";
import {OnErrorHook, Worker} from "./engine";
import {ReadyWorkflow, Step, StepResult, Workflow} from "./types";
import {updateWorkflowState, WorkflowState} from "./state/state";
import {tryCatch, tryCatchSync} from "./utils/inline-catch";

class ConcreteWorker<TriggerOpts> implements Worker {
  #queues: Queue<TriggerOpts>[]

  #consumptions: Consumption[] = []
  #onError: OnErrorHook[] = []

  constructor(
    queues: Queue<TriggerOpts>[],
  ) {
    this.#queues = queues
  }

  async start<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<void> {
    const readyWorkflows = await Promise.all(workflows.map(async workflow => workflow.ready()))

    for (const queue of this.#queues) {
      const c = await queue.consume({
        workflows: readyWorkflows,
        onMessage: async task => {
          try {
            const mWorkflow = readyWorkflows.find(w => w.name === task.name)

            if (!mWorkflow)
              return

            const mStepAndContext = mWorkflow.getStepByName(task.toExecute.step)

            if (!mStepAndContext)
              return

            const {item: step, context: executionContext} = mStepAndContext

            const result = await this.#handleStep(step, task, executionContext)
            const newState = updateWorkflowState(task, step, result)

            await this.#write([
              {
                type: "update",
                state: newState
              }
            ])

            switch (result.type) {
              case "stopped": {
                for (const {item: handler, context} of mWorkflow.getHook("onWorkflowStopped")) {
                  const [, error] = tryCatchSync(() => handler(context, step, task.toExecute.state))

                  if (error !== undefined) {
                    this.#executeErrorHooks(error)
                  }
                }

                break
              }

              case "success":
              case "skipped": {
                const newState = result.type === "skipped"
                  ? task.toExecute.state
                  : result.state
                const mNextStep = mWorkflow.getNextStep(task.toExecute.step)

                if (result.type === "skipped") {
                  for (const {item: handler, context} of mWorkflow.getHook("onStepSkipped")) {
                    const [, error] = tryCatchSync(() => handler(context, step, task.toExecute.state))

                    if (error !== undefined) {
                      this.#executeErrorHooks(error)
                    }
                  }
                }

                for (const {item: handler, context} of mWorkflow.getHook("onStepCompleted")) {
                  const [, error] = tryCatchSync(() => handler(context, step, newState as State))

                  if (error !== undefined) {
                    this.#executeErrorHooks(error)
                  }
                }

                if (mNextStep === undefined) {
                  for (const {item: handler, context} of mWorkflow.getHook("onWorkflowCompleted")) {
                    const [, err] = tryCatchSync(() => handler.call(context, context, newState as State))

                    if (err !== undefined) {
                      this.#executeErrorHooks(err)
                    }
                  }
                }

                break
              }

              case "failure": {
                const hasExhaustedRetry = task.toExecute.attempt + 1 > step.maxAttempts
                const mNextStep = mWorkflow.getNextStep(task.toExecute.step)

                for (const {item: handler, context} of mWorkflow.getHook("onStepError")) {
                  const [, error] = tryCatchSync(() => handler(result.error, context, task.toExecute.state))

                  if (error !== undefined) {
                    this.#executeErrorHooks(error)
                  }
                }

                if (hasExhaustedRetry && !step.optional) {
                  for (const {item: handler, context} of mWorkflow.getHook("onWorkflowFailed")) {
                    const [, error] = tryCatchSync(() => handler(result.error, context, step, task.toExecute.state))

                    if (error !== undefined) {
                      this.#executeErrorHooks(error)
                    }
                  }
                }

                if (hasExhaustedRetry && step.optional && mNextStep === undefined) {
                  for (const {item: handler, context} of mWorkflow.getHook("onWorkflowCompleted")) {
                    const [, error] = tryCatchSync(() => handler(context, task.toExecute.state))

                    if (error !== undefined) {
                      this.#executeErrorHooks(error)
                    }
                  }
                }
              }
            }
          } catch (error: unknown) {
            this.#executeErrorHooks(error)
          }
        }
      })

      this.#consumptions.push(c)
    }
  }

  addHook(hook: "onError", handler: OnErrorHook): this {
    this.#onError.push(handler)
    return this
  }

  async stop(): Promise<void> {
    for (const c of this.#consumptions) {
      await c.stop()
    }

    for (const q of this.#queues) {
      await q.disconnect()
    }
  }

  async #handleStep<State>(
    step: Step,
    state: WorkflowState<State>,
    workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Record<never, never>>
  ): Promise<StepResult<unknown>> {
    try {
      const nextStateOrResult = await step.handler({
        state: state.toExecute.state,
        workflow,
        ok: state => ({
          type: "success",
          state
        }),
        err: error => ({
          type: "failure",
          error,
        }),
        skip: () => ({
          type: "skipped"
        }),
        stop: () => ({
          type: "stopped"
        }),
        attempt: state.toExecute.attempt
      })

      if (this.#isStepResult(nextStateOrResult)) {
        return nextStateOrResult
      }

      return ({
        type: "success",
        state: nextStateOrResult
      })
    } catch (error: unknown) {
      return ({type: "failure", error})
    }
  }

  #isStepResult(value: unknown): value is StepResult<unknown> {
    return typeof value === "object" && value !== null &&
      "type" in value && typeof value["type"] === "string"
  }

  #executeErrorHooks(err: unknown): void {
    for (const hook of this.#onError) {
      hook(err)
    }
  }

  async #write<State>(writes: Write<State>[]) {
    for (const queue of this.#queues) {
      const [, err] = await tryCatch(queue.write(writes))

      if (err !== undefined) {
        this.#executeErrorHooks(err)
      }
    }
  }
}

export type CreateWorkerOpts = {
  // todo: find a better type than any
  queues: Queue<any>[]
}

export function createWorker (opts: CreateWorkerOpts): Worker {
  return new ConcreteWorker(opts.queues)
}

