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
export type HandlerOpts<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>> = {
  state: State
  workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>
  ok: (state: State) => Success<State>
  err: (error: unknown) => Failure<State>
  skip: () => Skipped<State>
  stop: () => Stopped<State>
  attempt: number
}
export type Handler<StateIn, StateOut, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>> = (opts: HandlerOpts<StateIn, FirstState, StateByStepName, Decorators>) => StateOut | StepResult<StateOut> | Promise<StateOut> | Promise<StepResult<StateOut>>
export type Step<Decorators extends Record<never, never>> = {
  name: string
  handler: Handler<unknown, unknown, unknown, Record<never, never>, Decorators>
  maxAttempts: number
  optional: boolean
  delayBetweenAttempts: number | ((attempt: number) => number)
}

export type StepOpts<Name extends string, StateIn, StateOut, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>> = {
  name: Name
  handler: Handler<StateIn, StateOut, FirstState, StateByStepName, Decorators>
  maxAttempts?: number
  delayBetweenAttempts?: number | ((attempt: number) => number)

  /**
   * True if this step can fail without blocking the workflow.
   */
  optional?: boolean
}

export type OnWorkflowCompletedHook<Decorators extends Record<never, never>> = (
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  state: unknown
) => void
export type OnStepErrorHook<Decorators extends Record<never, never>> = (
  error: unknown,
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  state: unknown
) => void
export type OnStepSkippedHook<Decorators extends Record<never, never>> = (
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step<Decorators>, state: unknown
) => void
export type OnWorkflowStoppedHook<Decorators extends Record<never, never>> = (
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step<Decorators>, state: unknown
) => void
export type OnWorkflowFailedHook<Decorators extends Record<never, never>> = (
  error: unknown,
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step<Decorators>,
  state: unknown
) => void
export type OnStepCompletedHook<Decorators extends Record<never, never>> = (
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step<Decorators>,
  state: unknown
) => void

export type WithContext<T, Decorators extends Record<never, never>> = {
  item: T
  context: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>
}

export type Workflow<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>> = {
  /**
   * The name of the workflow.
   */
  name: string

  /**
   * Get this workflow's first step.
   * Returns `undefined` if the workflow is empty.
   */
  getFirstStep(): Step<Decorators> | undefined

  /**
   * Get a step, and its execution context, from its name.
   * Returns `undefined` if no step is matching the given name.
   *
   * @param name
   */
  getStepByName(name: string): WithContext<Step<Decorators>, Decorators> | undefined

  /**
   * Search the step succeeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): Step<Decorators> | undefined

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
  steps(): Iterable<WithContext<Step<Decorators>, Decorators>>

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

  /**
   * Register a plugin using a plain function.
   * You can't pass option to this plugin type.
   *
   * @param plugin
   */
  register<OutState, OutStateByStepName extends StateByStepName, OutDecorators extends Decorators>(
    plugin: PlainPlugin<State, FirstState, StateByStepName, Decorators, OutState, OutStateByStepName, OutDecorators>
  ): Workflow<OutState, FirstState, OutStateByStepName, OutDecorators>
}

export type ReadyWorkflow<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>> = Workflow<State, FirstState, StateByStepName, Decorators> & Decorators

/**
 * A plain plugin is function without a plugin name and deps.
 * This type should be used when you want to create plugin using anonymous function.
 *
 * Rivr will assign the plugin a name automatically (e.g. 'plugin-auto-ID').
 */
export type PlainPlugin<
  InState,
  FirstState,
  InStateByStepName extends Record<string, never>,
  InDecorators extends Record<never, never>,
  OutState,
  OutStateByStepName extends InStateByStepName,
  OutDecorators extends InDecorators
> = (
  workflow: ReadyWorkflow<InState, FirstState, InStateByStepName, InDecorators>
) => Workflow<OutState, FirstState, OutStateByStepName, OutDecorators>

export type RivrPlugin<
  InState,
  FirstState,
  InStateByStepName extends Record<string, never>,
  InDecorators extends Record<never, never>,
  OutState,
  OutStateByStepName extends InStateByStepName,
  OutDecorators extends InDecorators
> = {
  (workflow: ReadyWorkflow<InState, FirstState, InStateByStepName, InDecorators>): Workflow<OutState, FirstState, OutStateByStepName, OutDecorators>
  name: string
}