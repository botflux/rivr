import {setTimeout} from "node:timers/promises"
import {DefaultTriggerOpts, OnErrorHook, type Trigger, type Worker} from "../engine"
import {ReadyWorkflow, Step, StepResult, Workflow} from "../types";
import {tryCatch, tryCatchSync} from "../utils/inline-catch";
import {createWorkflowState, updateWorkflowState, WorkflowState} from "./state";

export type Insert<State> = {
  type: "insert"
  state: WorkflowState<State>
}

export type Update<State> = {
  type: "update"
  state: WorkflowState<State>
}

export type Write<State> = Update<State> | Insert<State>

export type PullOpts = {
  limit: number
}

export interface Storage<WriteOpts> {
  pull<State, Decorators extends Record<never, never>, FirstState, StateByStepName extends Record<never, never>>(
    workflows: Workflow<State, FirstState, StateByStepName, Decorators>[],
    opts: PullOpts
  ): Promise<WorkflowState<State>[]>
  write<State>(writes: Write<State>[], opts?: WriteOpts): Promise<void>
  findById<State>(id: string): Promise<WorkflowState<State> | undefined>
  disconnect(): Promise<void>
}

export class InfiniteLoop {
  #stopped = false;

  *[Symbol.iterator]() {
    while (!this.#stopped) {
      yield
    }
  }

  stop(): void {
    this.#stopped = true
  }
}

export class PullTrigger<TriggerOpts extends DefaultTriggerOpts> implements Trigger<TriggerOpts> {
  #storage: Storage<TriggerOpts>

  constructor(storage: Storage<TriggerOpts>) {
    this.#storage = storage
  }

  async trigger<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(
    workflow: Workflow<State, FirstState, StateByStepName, Decorators>,
    state: FirstState,
    opts?: TriggerOpts
  ): Promise<WorkflowState<State>> {
    const mFirstStep = workflow.getFirstStep()

    if (!mFirstStep) {
      throw new Error("Cannot trigger a workflow that has no step")
    }

    const s = createWorkflowState(
      workflow as unknown as Workflow<State, FirstState, StateByStepName, Record<never, never>>,
      mFirstStep.name as keyof StateByStepName,
      state as StateByStepName[keyof StateByStepName],
      opts?.id
    )

    await this.#storage.write([
      {
        type: "insert",
        state: s
      }
    ], opts)

    return s
  }

  async triggerFrom<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName, Decorators extends Record<never, never>>(
    workflow: Workflow<State, FirstState, StateByStepName, Decorators>,
    name: Name,
    state: StateByStepName[Name],
    opts?: TriggerOpts & DefaultTriggerOpts
  ): Promise<WorkflowState<State>> {
    const mStep = workflow.getStepByName(name as string)

    if (!mStep) {
      throw new Error("Not implemented at line 81 in poller.ts")
    }

    const s = createWorkflowState(
      workflow as unknown as Workflow<State, FirstState, StateByStepName, Record<never, never>>,
      name,
      state,
      opts?.id
    )

    await this.#storage.write([
      {
        type: "insert",
        state: s
      }
    ], opts)

    return s
  }
}

export class Poller<TriggerOpts> implements Worker {
  #loop = new InfiniteLoop()
  #storage: Storage<TriggerOpts>

  #hasFinished = false
  #delayBetweenPulls: number
  #countPerPull: number

  #onError: OnErrorHook[] = []

  constructor(
    storage: Storage<TriggerOpts>,
    delayBetweenPulls: number,
    countPerPull: number
  ) {
    this.#storage = storage
    this.#delayBetweenPulls = delayBetweenPulls
    this.#countPerPull = countPerPull
  }

  async start<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<void> {
    const readyWorkflows = await Promise.all(workflows.map(async workflow => workflow.ready()))

    ;(async () => {
      for (const _ of this.#loop) {
        const [tasks, tasksErr] = await tryCatch(this.#storage.pull(workflows, { limit: this.#countPerPull }))

        if (tasksErr !== undefined) {
          this.#executeErrorHooks(tasksErr)
          continue
        }

        for (const task of tasks) {
          const mWorkflow = readyWorkflows.find(w => w.name === task.name)

          if (!mWorkflow)
            continue

          const mStepAndContext = mWorkflow.getStepByName(task.toExecute.step)

          if (!mStepAndContext)
            continue

          const {item: step, context: executionContext} = mStepAndContext

          const result = await this.#handleStep(step, task, executionContext)
          const newState = updateWorkflowState(task, step, result)

          await this.#write([
            {
              type: "update",
              state: newState
            }
          ])

          switch(result.type) {
            case "stopped": {
              for (const { item: handler, context } of mWorkflow.getHook("onWorkflowStopped")) {
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
                for (const { item: handler, context } of mWorkflow.getHook("onStepSkipped")) {
                  const [, error] = tryCatchSync(() => handler(context, step, task.toExecute.state))

                  if (error !== undefined) {
                    this.#executeErrorHooks(error)
                  }
                }
              }

              for (const { item: handler, context } of mWorkflow.getHook("onStepCompleted")) {
                const [, error] = tryCatchSync(() => handler(context, step, newState as State))

                if (error !== undefined) {
                  this.#executeErrorHooks(error)
                }
              }

              if (mNextStep === undefined) {
                for (const { item: handler, context } of mWorkflow.getHook("onWorkflowCompleted")) {
                  const [ , err ] = tryCatchSync(() => handler.call(context, context, newState as State))

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

              for (const { item: handler, context } of mWorkflow.getHook("onStepError")) {
                const [, error] = tryCatchSync(() => handler(result.error, context, task.toExecute.state))

                if (error !== undefined) {
                  this.#executeErrorHooks(error)
                }
              }

              if (hasExhaustedRetry && !step.optional) {
                for (const { item: handler, context } of mWorkflow.getHook("onWorkflowFailed")) {
                  const [, error] = tryCatchSync(() => handler(result.error, context, step, task.toExecute.state))

                  if (error !== undefined) {
                    this.#executeErrorHooks(error)
                  }
                }
              }

              if (hasExhaustedRetry && step.optional && mNextStep === undefined) {
                for (const { item: handler, context } of mWorkflow.getHook("onWorkflowCompleted")) {
                  const [, error] = tryCatchSync(() => handler(context, task.toExecute.state))

                  if (error !== undefined) {
                    this.#executeErrorHooks(error)
                  }
                }
              }
            }
          }
        }

        if (tasks.length === 0) {
          await setTimeout(this.#delayBetweenPulls)
        }
      }

      this.#hasFinished = true
    })().catch(console.error)
  }

  addHook(hook: "onError", handler: OnErrorHook): this {
    this.#onError.push(handler)
    return this
  }

  async stop(): Promise<void> {
    this.#loop.stop()

    while (!this.#hasFinished) {
      await setTimeout(10)
    }

    await this.#storage.disconnect()
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
    } catch(error: unknown) {
      return ({ type: "failure", error })
    }
  }

  #isStepResult (value: unknown): value is StepResult<unknown> {
    return typeof value === "object" && value !== null &&
      "type" in value && typeof value["type"] === "string"
  }

  #executeErrorHooks(err: unknown): void {
    for (const hook of this.#onError) {
      hook(err)
    }
  }

  async #write<State>(writes: Write<State>[]) {
    const [, err ] = await tryCatch(this.#storage.write(writes))

    if (err !== undefined) {
      this.#executeErrorHooks(err)
    }
  }
}