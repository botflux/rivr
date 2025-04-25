export type Success<State> = {
  type: "success"
  state: State
}
export type Failure<State> = {
  type: "failure"
  error: unknown
}
export type Skipped<State> = {
  type: "skipped"
}
export type Stopped<State> = {
  type: "stopped"
}

export type StepResult<State> =
  | Success<State>
  | Failure<State>
  | Skipped<State>
  | Stopped<State>
export type HandlerOpts<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  state: State
  workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>
  ok: (state: State) => Success<State>
  err: (error: unknown) => Failure<State>
  skip: () => Skipped<State>
  stop: () => Stopped<State>
  attempt: number
}
export type Handler<StateIn, StateOut, FirstState, StateByStepName extends Record<never, never>, Decorators> = (opts: HandlerOpts<StateIn, FirstState, StateByStepName, Decorators>) => StateOut | StepResult<StateOut> | Promise<StateOut> | Promise<StepResult<StateOut>>
export type Step<State, StateOut, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  name: string
  handler: Handler<State, StateOut, FirstState, StateByStepName, Decorators>
  maxAttempts: number
  optional: boolean
  delayBetweenAttempts: number | ((attempt: number) => number)
}

export type StepOpts<Name extends string, StateIn, StateOut, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  name: Name
  handler: Handler<StateIn, StateOut, FirstState, StateByStepName, Decorators>
  maxAttempts?: number
  delayBetweenAttempts?: number | ((attempt: number) => number)

  /**
   * True if this step can fail without blocking the workflow.
   */
  optional?: boolean
}

export type OnWorkflowCompletedHook<Decorators> = (
  workflow: ReadyWorkflow<any, any, any, Decorators>, state: unknown
) => void
export type OnStepErrorHook<Decorators> = (
  error: unknown,
  workflow: ReadyWorkflow<any, any, any, Decorators>,
  state: unknown
) => void
export type OnStepSkippedHook<Decorators> = (
  workflow: ReadyWorkflow<any, any, any, Decorators>,
  step: Step<any, any, any, any, Decorators>, state: unknown
) => void
export type OnWorkflowStoppedHook<Decorators> = (
  workflow: ReadyWorkflow<any, any, any, Decorators>,
  step: Step<any, any, any, any, Decorators>, state: unknown
) => void
export type OnWorkflowFailedHook<Decorators> = (
  error: unknown,
  workflow: ReadyWorkflow<any, any, any, Decorators>,
  step: Step<any, any, any, any, Decorators>,
  state: unknown
) => void
export type OnStepCompletedHook<Decorators> = (
  workflow: ReadyWorkflow<any, any, any, Decorators>, step: Step<any, any, any, any, Decorators>, state: unknown) => void

export type WithContext<T, Decorators> = {
  item: T
  context: ReadyWorkflow<any, any, any, Decorators>
}

export type Workflow<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  /**
   * The name of the workflow.
   */
  name: string

  /**
   * Get this workflow's first step.
   * Returns `undefined` if the workflow is empty.
   */
  getFirstStep(): Step<FirstState, unknown, FirstState, StateByStepName, Decorators> | undefined

  /**
   * Get a step, and its execution context, from its name.
   * Returns `undefined` if no step is matching the given name.
   *
   * @param name
   */
  getStepByName(name: string): WithContext<Step<State, unknown, FirstState, StateByStepName, Decorators>, Decorators> | undefined

  /**
   * Search the step succeeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): Step<State, unknown, FirstState, StateByStepName, Decorators> | undefined

  /**
   * Add a property to the current workflow.
   *
   * @param key
   * @param value
   */
  decorate<K extends string, V>(key: K, value: V): Workflow<State, FirstState, StateByStepName, Decorators & Record<K, V>>

  /**
   * Iterate over each step.
   * The iterator yields a tuple containing the step, and the context within which the step must be executed.
   */
  steps(): Iterable<[
    step: Step<unknown, unknown, unknown, Record<never, never>, Decorators>,
    context: Workflow<unknown, unknown, Record<never, never>, Decorators>
  ]>

  /**
   * Add a step
   *
   * @param opts
   */
  step<Name extends string, StateOut>(opts: StepOpts<Name, State, StateOut, FirstState, StateByStepName, Decorators>): Workflow<StateOut, FirstState, StateByStepName & Record<Name, State>, Decorators>

  /**
   * Hook on workflow completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on step error.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepError", handler: OnStepErrorHook<Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on skipped steps.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepSkipped", handler: OnStepSkippedHook<Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on workflow stopped.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowStopped", handler: OnWorkflowStoppedHook<Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on step completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepCompleted", handler: OnStepCompletedHook<Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  addHook(hook: "onWorkflowFailed", handler: OnWorkflowFailedHook<Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  getHook(hook: "onStepCompleted"): WithContext<OnStepCompletedHook<Decorators>, Decorators>[]
  getHook(hook: "onWorkflowCompleted"): WithContext<OnWorkflowCompletedHook<Decorators>, Decorators>[]
  getHook(hook: "onStepError"): WithContext<OnStepErrorHook<Decorators>, Decorators>[]
  getHook(hook: "onStepSkipped"): WithContext<OnStepSkippedHook<Decorators>, Decorators>[]
  getHook(hook: "onWorkflowStopped"): WithContext<OnWorkflowStoppedHook<Decorators>, Decorators>[]
  getHook(hook: "onWorkflowFailed"): WithContext<OnWorkflowFailedHook<Decorators>, Decorators>[]

  /**
   * Execute the dependency graph.
   * This function does nothing if the dependency graph was already executed.
   */
  ready(): Promise<ReadyWorkflow<State, FirstState, StateByStepName, Decorators>>
}

export type ReadyWorkflow<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = Workflow<State, FirstState, StateByStepName, Decorators> & Decorators
