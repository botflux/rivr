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
export type HandlerOpts<State, FirstState, Decorators> = {
  state: State
  workflow: ReadyWorkflow<State, FirstState, Decorators>
  ok: (state: State) => Success<State>
  err: (error: unknown) => Failure
  skip: () => Skipped
  stop: () => Stopped
  attempt: number
}
export type Handler<State, FirstState, Decorators> = (opts: HandlerOpts<State, FirstState, Decorators>) => State | StepResult<State> | Promise<State> | Promise<StepResult<State>>
export type Step<State, FirstState, Decorators> = {
  name: string
  handler: Handler<State, FirstState, Decorators>
  maxAttempts: number
  optional: boolean
  delayBetweenAttempts: number | ((attempt: number) => number)
}

export type StepOpts<Name extends string, State, FirstState, Decorators> = {
  name: Name
  handler: Handler<State, FirstState, Decorators>
  maxAttempts?: number
  delayBetweenAttempts?: number | ((attempt: number) => number)

  /**
   * True if this step can fail without blocking the workflow.
   */
  optional?: boolean
}

export type OnWorkflowCompletedHook<State, FirstState, Decorators> = (workflow: ReadyWorkflow<State, FirstState, Decorators>, state: State) => void
export type OnStepErrorHook<State, FirstState, Decorators> = (error: unknown, workflow: ReadyWorkflow<State, FirstState, Decorators>, state: State) => void
export type OnStepSkippedHook<State, FirstState, Decorators> = (workflow: ReadyWorkflow<State, FirstState, Decorators>, step: Step<State, FirstState, Decorators>, state: State) => void
export type OnWorkflowStoppedHook<State, FirstState, Decorators> = (workflow: ReadyWorkflow<State, FirstState, Decorators>, step: Step<State, FirstState, Decorators>, state: State) => void
export type OnWorkflowFailedHook<State, FirstState, Decorators> = (error: unknown, workflow: ReadyWorkflow<State, FirstState, Decorators>, step: Step<State, FirstState, Decorators>, state: State) => void
export type OnStepCompletedHook<State, FirstState, Decorators> = (workflow: ReadyWorkflow<State, FirstState, Decorators>, step: Step<State, FirstState, Decorators>, state: State) => void

export type Plugin<State, FirstState, Decorators, NewDecorators> = (workflow: Workflow<State, FirstState, Decorators>) => Workflow<State, FirstState, NewDecorators>

export type WithContext<T, State, FirstState, Decorators> = [ item: T, context: ReadyWorkflow<State, FirstState, Decorators> ]

export type Workflow<State, FirstState, Decorators> = {
  /**
   * The name of the workflow.
   */
  name: string

  /**
   * Get this workflow's first step.
   * Returns `undefined` if the workflow is empty.
   */
  getFirstStep(): Step<State, FirstState, Decorators> | undefined

  /**
   * Get a step, and its execution context, from its name.
   * Returns `undefined` if no step is matching the given name.
   *
   * @param name
   */
  getStepByName(name: string): WithContext<Step<State, FirstState, Decorators>, State, FirstState, Decorators> | undefined

  /**
   * Search the step succeeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): Step<State, FirstState, Decorators> | undefined

  /**
   * Add a property to the current workflow.
   *
   * @param key
   * @param value
   */
  decorate<K extends string, V>(key: K, value: V): Workflow<State, FirstState, Decorators & Record<K, V>>

  /**
   * Register a plugin.
   *
   * @param plugin
   */
  register<NewDecorators>(plugin: Plugin<State, FirstState, Decorators, NewDecorators>): Workflow<State, FirstState, Decorators & NewDecorators>
  register<NewDecorators>(plugin: RivrPlugin<NewDecorators, undefined, State, FirstState>): Workflow<State, FirstState, Decorators & NewDecorators>
  register<NewDecorators, Opts>(plugin: RivrPlugin<NewDecorators, Opts, State, FirstState>, opts: Opts | ((workflow: ReadyWorkflow<State, FirstState, Decorators>) => Opts)): Workflow<State, FirstState, Decorators & NewDecorators>

  /**
   * Iterate over each step.
   * The iterator yields a tuple containing the step, and the context within which the step must be executed.
   */
  steps(): Iterable<[step: Step<State, FirstState, Decorators>, context: Workflow<State, FirstState, Decorators>]>

  /**
   * Add a step
   *
   * @param opts
   */
  step<Name extends string>(opts: StepOpts<Name, State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  /**
   * Hook on workflow completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  /**
   * Hook on step error.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepError", handler: OnStepErrorHook<State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  /**
   * Hook on skipped steps.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepSkipped", handler: OnStepSkippedHook<State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  /**
   * Hook on workflow stopped.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowStopped", handler: OnWorkflowStoppedHook<State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  /**
   * Hook on step completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepCompleted", handler: OnStepCompletedHook<State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  addHook(hook: "onWorkflowFailed", handler: OnWorkflowFailedHook<State, FirstState, Decorators>): Workflow<State, FirstState, Decorators>

  getHook(hook: "onStepCompleted"): WithContext<OnStepCompletedHook<State, FirstState, Decorators>, State, FirstState, Decorators>[]
  getHook(hook: "onWorkflowCompleted"): WithContext<OnWorkflowCompletedHook<State, FirstState, Decorators>, State, FirstState, Decorators>[]
  getHook(hook: "onStepError"): WithContext<OnStepErrorHook<State, FirstState, Decorators>, State, FirstState, Decorators>[]
  getHook(hook: "onStepSkipped"): WithContext<OnStepSkippedHook<State, FirstState, Decorators>, State, FirstState, Decorators>[]
  getHook(hook: "onWorkflowStopped"): WithContext<OnWorkflowStoppedHook<State, FirstState, Decorators>, State, FirstState, Decorators>[]
  getHook(hook: "onWorkflowFailed"): WithContext<OnWorkflowFailedHook<State, FirstState, Decorators>, State, FirstState, Decorators>[]

  /**
   * Execute the dependency graph.
   * This function does nothing if the dependency graph was already executed.
   */
  ready(): Promise<ReadyWorkflow<State, FirstState, Decorators>>
}

export type ReadyWorkflow<State, FirstState, Decorators> = Workflow<State, FirstState, Decorators> & Decorators

/**
 * Claude gave me this typescript type.
 * I don't understand the hack that make this works, but essentially
 * this type merges unions.
 *
 * So, this type will map this: `{ foo: string } | { bar: string }`,
 * to this `{ foo: string } & { bar: string }`.
 */
export type MergeUnionTypes<T> = (T extends any ? (x: T) => any : never) extends
  (x: infer R) => any ? R : never;

export type RivrPlugin<Out, Opts, State, FirstState> = {
  (w: Workflow<State, FirstState, any>, opts: Opts): Workflow<State, FirstState, Out>
  opts: RivrPluginOpts<State, FirstState>
}

export type RivrPluginOpts<State, FirstState, Deps extends RivrPlugin<any, any, State, FirstState>[] = []> = {
  deps?: Deps
  /**
   * The plugin's name
   */
  name: string
}

export function rivrPlugin<Out, Opts = undefined, State = any, FirstState = any, Deps extends RivrPlugin<any, any, State, FirstState>[] = []> (
  plugin: (w: ReadyWorkflow<State, FirstState, MergeUnionTypes<GetDecorator<UnwrapItem<Deps>, State, FirstState>>>, opts: Opts) => Workflow<State, FirstState, Out>,
  opts: RivrPluginOpts<State, FirstState, Deps>
): RivrPlugin<Out, Opts, State, FirstState> {
  Object.assign(plugin, {
    opts,
  })

  return plugin as RivrPlugin<Out, Opts, State, FirstState>
}

type UnwrapItem<T> = T extends (infer U)[] ? U : never
type GetDecorator<T, State, FirstState> = T extends RivrPlugin<infer U, any, State, FirstState> ? U : never
