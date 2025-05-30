import {setTimeout} from "node:timers/promises"
import {DefaultTriggerOpts, OnErrorHook, type Trigger, type Worker} from "../engine"
import {ReadyWorkflow, Step, StepResult, Workflow} from "../types";
import {tryCatch, tryCatchSync} from "../utils/inline-catch";
import {createWorkflowState, updateWorkflowState, WorkflowState} from "../state/state";

export type Insert<State> = {
  type: "insert"
  state: WorkflowState<State>
}

export type Update<State> = {
  type: "update"
  state: WorkflowState<State>
}

export type Write<State> = Update<State> | Insert<State>

export interface Consumption {
  /**
   * Iterate over the workflow states.
   */
  [Symbol.asyncIterator](): AsyncIterator<WorkflowState<unknown>>

  /**
   * Stop the consumption.
   */
  stop(): Promise<void>
}

export type FindAll<
  State,
  FirstState,
  StateByStepName extends Record<string, never>,
  Decorators extends Record<never, never>
> = {
  workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]
}

/**
 * The storage is an abstraction representing the underlying
 * database/queuing system.
 */
export interface Storage<WriteOpts> {
  /**
   * Batch insert/update workflow states.
   *
   * @param writes
   * @param opts
   */
  write<State>(writes: Write<State>[], opts?: WriteOpts): Promise<void>

  /**
   * Find a workflow state using its id.
   *
   * @param id
   */
  findById<State>(id: string): Promise<WorkflowState<State> | undefined>

  findAll<
    State,
    FirstState,
    StateByStepName extends Record<string, never>,
    Decorators extends Record<never, never>
  >(opts: FindAll<State, FirstState, StateByStepName, Decorators>): Promise<WorkflowState<unknown>[]>

  disconnect(): Promise<void>
}

export interface Consumption2 {
  stop(): Promise<void>
}

export type OnMessage = (state: WorkflowState<unknown>) => Promise<void>

export interface ConsumeOpts {
  // TODO: remove any's in favor of unknown
  workflows: Workflow<any, any, any, Record<never, never>>[]
  onMessage: OnMessage
}

export interface Queue<WriteOpts> {
  /**
   * Create a list of consumptions.
   *
   * This method can seem a bit weird because we'd expect
   * to have only one consumption, but some storages cannot be implemented
   * using only one consumption.
   *
   * @param workflows
   */
  createConsumptions<State, Decorators extends Record<never, never>, FirstState, StateByStepName extends Record<never, never>>(
    workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]
  ): Promise<Consumption[]>

  consume(opts: ConsumeOpts): Promise<Consumption2>

  /**
   * Batch insert/update workflow states.
   *
   * @param writes
   * @param opts
   */
  write<State>(writes: Write<State>[], opts?: WriteOpts): Promise<void>
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

export class ConcreteTrigger<TriggerOpts extends DefaultTriggerOpts> implements Trigger<TriggerOpts> {
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
      opts?.id,
      opts?.now ?? new Date()
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
      opts?.id,
      new Date()
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

export class Executor<TriggerOpts> implements Worker {
  #storage: Queue<TriggerOpts> & Storage<TriggerOpts>

  #consumption: Consumption2 | undefined
  #onError: OnErrorHook[] = []

  constructor(
    storage: Queue<TriggerOpts> & Storage<TriggerOpts>,
  ) {
    this.#storage = storage
  }

  async start<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<void> {
    const readyWorkflows = await Promise.all(workflows.map(async workflow => workflow.ready()))
    this.#consumption = await this.#storage.consume({
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
  }

  addHook(hook: "onError", handler: OnErrorHook): this {
    this.#onError.push(handler)
    return this
  }

  async stop(): Promise<void> {
    this.#consumption?.stop()
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