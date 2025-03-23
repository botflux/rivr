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
}
export type Handler<State, Decorators> = (opts: HandlerOpts<State, Decorators>) => State | StepResult<State>
export type StepOpts<State, Decorators> = {
  name: string
  handler: Handler<State, Decorators>
}
export type OnWorkflowCompletedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, state: State) => void
export type OnStepErrorHook<State, Decorators> = (error: unknown, workflow: Workflow<State, Decorators>, state: State) => void
export type OnStepSkippedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, step: StepOpts<State, Decorators>, state: State) => void
export type OnWorkflowStoppedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, step: StepOpts<State, Decorators>, state: State) => void
export type OnStepCompletedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, step: StepOpts<State, Decorators>, state: State) => void

export type Plugin<State, Decorators, NewDecorators> = (workflow: Workflow<State, Decorators>) => Workflow<State, NewDecorators>

export type StepElement<State, Decorators> = { type: "step", step: StepOpts<State, Decorators> }
export type ContextElement<State, Decorators> = { type: "context", context: Workflow<State, Decorators> }
export type StepCompletedElement<State, Decorators> = { type: "onStepCompleted", hook: OnStepCompletedHook<State, Decorators> }

export type ExecutionGraph<State, Decorators> =
  | StepElement<State, Decorators>
  | ContextElement<State, Decorators>
  | StepCompletedElement<State, Decorators>

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
   * A tree containing the steps and sub-workflow in order.
   * Iterating through this tree depth-first would yield the steps in order.
   */
  graph: ExecutionGraph<State, Decorators>[]

  /**
   * Hooks to execute once a workflow is completed.
   */
  onWorkflowCompleted: OnWorkflowCompletedHook<State, Decorators>[]

  /**
   * Hooks to execute for each step error.
   */
  onStepError: OnStepErrorHook<State, Decorators>[]

  /**
   * Hooks to execute for each skipped step.
   */
  onStepSkipped: OnStepSkippedHook<State, Decorators>[]

  /**
   * Hooks to execute for each stopped workflow.
   */
  onWorkflowStopped: OnWorkflowStoppedHook<State, Decorators>[]

  /**
   * Hooks to execute each time a step is completed.
   */
  onStepCompleted: OnStepCompletedHook<State, Decorators>[]

  /**
   * Get this workflow's first step.
   * Returns `undefined` if the workflow is empty.
   */
  getFirstStep(): StepOpts<State, Decorators> | undefined

  /**
   * Search a step by its name.
   * Returns `undefined` if there is no step matching the given name.
   *
   * @param name
   */
  getStep(name: string): StepOpts<State, Decorators> | undefined

  /**
   * Search the step succeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): StepOpts<State, Decorators> | undefined

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
  register<NewDecorators>(plugin: Plugin<State, Decorators, NewDecorators>): Workflow<State, NewDecorators>

  /**
   * Iterate over each step.
   * The iterator yields a tuple containing the step, and the context within which the step must be executed.
   */
  steps(): Iterable<[step: StepOpts<State, Decorators>, context: Workflow<State, Decorators>]>

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

  getHook(hook: "onStepCompleted"): OnStepCompletedHook<State, Decorators>[]
} & Decorators