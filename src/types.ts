import {RivrPlugin, RivrPluginOpts} from "./plugin.ts";

export type Success<State> = {
  type: "success"
  state: State
}
export type Failure = {
  type: "failure"
  error: unknown
}
export type Skipped = {
  type: "skipped"
}
export type Stopped = {
  type: "stopped"
}

export type StepResult<State> =
  | Success<State>
  | Failure
  | Skipped
  | Stopped
export type HandlerOpts<State, Decorators> = {
  state: State
  workflow: Workflow<State, Decorators>
  ok: (state: State) => Success<State>
  err: (error: unknown) => Failure
  skip: () => Skipped
  stop: () => Stopped
  attempt: number
}
export type Handler<State, Decorators> = (opts: HandlerOpts<State, Decorators>) => State | StepResult<State> | Promise<State> | Promise<StepResult<State>>
export type Step<State, Decorators> = {
  name: string
  handler: Handler<State, Decorators>
  maxAttempts: number
}

export type StepOpts<State, Decorators> = {
  name: string
  handler: Handler<State, Decorators>
  maxAttempts?: number
}

export type OnWorkflowCompletedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, state: State) => void
export type OnStepErrorHook<State, Decorators> = (error: unknown, workflow: Workflow<State, Decorators>, state: State) => void
export type OnStepSkippedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void
export type OnWorkflowStoppedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void
export type OnWorkflowFailedHook<State, Decorators> = (error: unknown, workflow: Workflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void
export type OnStepCompletedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void

export type Plugin<State, Decorators, NewDecorators> = (workflow: Workflow<State, Decorators>) => Workflow<State, NewDecorators>

export type WithContext<T, State, Decorators> = [ item: T, context: Workflow<State, Decorators> ]

export const kWorkflow = Symbol("kWorkflow")

export type Workflow<State, Decorators> = {
  /**
   * A flag to discriminates if an object is a workflow.
   */
  [kWorkflow]: true

  /**
   * The name of the workflow.
   */
  name: string

  /**
   * Get this workflow's first step.
   * Returns `undefined` if the workflow is empty.
   */
  getFirstStep(): Step<State, Decorators> | undefined

  /**
   * Search a step by its name.
   * Returns `undefined` if there is no step matching the given name.
   *
   * @param name
   */
  getStep(name: string): Step<State, Decorators> | undefined

  getStepAndExecutionContext(name: string): WithContext<Step<State, Decorators>, State, Decorators> | undefined

  /**
   * Search the step succeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): Step<State, Decorators> | undefined

  /**
   * Add a property to the current workflow.
   *
   * @param key
   * @param value
   */
  decorate<K extends string, V>(key: K, value: V): Workflow<State, Decorators & Record<K, V>>

  /**
   * Register a plugin.
   *
   * @param plugin
   */
  register<NewDecorators>(plugin: Plugin<State, Decorators, NewDecorators>): Workflow<State, Decorators & NewDecorators>
  register<NewDecorators>(plugin: RivrPlugin<NewDecorators, State>): Workflow<State, Decorators & NewDecorators>

  /**
   * Iterate over each step.
   * The iterator yields a tuple containing the step, and the context within which the step must be executed.
   */
  steps(): Iterable<[step: Step<State, Decorators>, context: Workflow<State, Decorators>]>

  /**
   * Add a step
   *
   * @param opts
   */
  step(opts: StepOpts<State, Decorators>): Workflow<State, Decorators>

  /**
   * Hook on workflow completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, Decorators>): Workflow<State, Decorators>

  /**
   * Hook on step error.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepError", handler: OnStepErrorHook<State, Decorators>): Workflow<State, Decorators>

  /**
   * Hook on skipped steps.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepSkipped", handler: OnStepSkippedHook<State, Decorators>): Workflow<State, Decorators>

  /**
   * Hook on workflow stopped.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowStopped", handler: OnWorkflowStoppedHook<State, Decorators>): Workflow<State, Decorators>

  /**
   * Hook on step completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepCompleted", handler: OnStepCompletedHook<State, Decorators>): Workflow<State, Decorators>

  addHook(hook: "onWorkflowFailed", handler: OnWorkflowFailedHook<State, Decorators>): Workflow<State, Decorators>

  getHook(hook: "onStepCompleted"): WithContext<OnStepCompletedHook<State, Decorators>, State, Decorators>[]
  getHook(hook: "onWorkflowCompleted"): WithContext<OnWorkflowCompletedHook<State, Decorators>, State, Decorators>[]
  getHook(hook: "onStepError"): WithContext<OnStepErrorHook<State, Decorators>, State, Decorators>[]
  getHook(hook: "onStepSkipped"): WithContext<OnStepSkippedHook<State, Decorators>, State, Decorators>[]
  getHook(hook: "onWorkflowStopped"): WithContext<OnWorkflowStoppedHook<State, Decorators>, State, Decorators>[]
  getHook(hook: "onWorkflowFailed"): WithContext<OnWorkflowFailedHook<State, Decorators>, State, Decorators>[]

  /**
   * Execute the dependency graph.
   * This function does nothing if the dependency graph was already executed.
   */
  ready(): Promise<Workflow<State, Decorators>>
} & Decorators