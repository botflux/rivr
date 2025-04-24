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
export type HandlerOpts<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  state: State
  workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>
  ok: (state: State) => Success<State>
  err: (error: unknown) => Failure
  skip: () => Skipped
  stop: () => Stopped
  attempt: number
}
export type Handler<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (opts: HandlerOpts<State, FirstState, StateByStepName, Decorators>) => State | StepResult<State> | Promise<State> | Promise<StepResult<State>>
export type Step<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  name: string
  handler: Handler<State, FirstState, StateByStepName, Decorators>
  maxAttempts: number
  optional: boolean
  delayBetweenAttempts: number | ((attempt: number) => number)
}

export type StepOpts<Name extends string, State, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  name: Name
  handler: Handler<State, FirstState, StateByStepName, Decorators>
  maxAttempts?: number
  delayBetweenAttempts?: number | ((attempt: number) => number)

  /**
   * True if this step can fail without blocking the workflow.
   */
  optional?: boolean
}

export type OnWorkflowCompletedHook<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>, state: State) => void
export type OnStepErrorHook<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (error: unknown, workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>, state: State) => void
export type OnStepSkippedHook<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>, step: Step<State, FirstState, StateByStepName, Decorators>, state: State) => void
export type OnWorkflowStoppedHook<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>, step: Step<State, FirstState, StateByStepName, Decorators>, state: State) => void
export type OnWorkflowFailedHook<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (error: unknown, workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>, step: Step<State, FirstState, StateByStepName, Decorators>, state: State) => void
export type OnStepCompletedHook<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = (workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>, step: Step<State, FirstState, StateByStepName, Decorators>, state: State) => void

export type Plugin<State, FirstState, StateByStepName extends Record<never, never>, Decorators, NewDecorators> = (workflow: Workflow<State, FirstState, StateByStepName, Decorators>) => Workflow<State, FirstState, StateByStepName, NewDecorators>

export type WithContext<T, State, FirstState, StateByStepName extends Record<never, never>, Decorators> = [ item: T, context: ReadyWorkflow<State, FirstState, StateByStepName, Decorators> ]

export type Workflow<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = {
  /**
   * The name of the workflow.
   */
  name: string

  /**
   * Get this workflow's first step.
   * Returns `undefined` if the workflow is empty.
   */
  getFirstStep(): Step<State, FirstState, StateByStepName, Decorators> | undefined

  /**
   * Get a step, and its execution context, from its name.
   * Returns `undefined` if no step is matching the given name.
   *
   * @param name
   */
  getStepByName(name: string): WithContext<Step<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators> | undefined

  /**
   * Search the step succeeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): Step<State, FirstState, StateByStepName, Decorators> | undefined

  /**
   * Add a property to the current workflow.
   *
   * @param key
   * @param value
   */
  decorate<K extends string, V>(key: K, value: V): Workflow<State, FirstState, StateByStepName, Decorators & Record<K, V>>

  /**
   * Register a plugin.
   *
   * @param plugin
   */
  register<NewDecorators>(plugin: Plugin<State, FirstState, StateByStepName, Decorators, NewDecorators>): Workflow<State, FirstState, StateByStepName, Decorators & NewDecorators>
  register<NewDecorators>(plugin: RivrPlugin<NewDecorators, undefined, State, FirstState, StateByStepName>): Workflow<State, FirstState, StateByStepName, Decorators & NewDecorators>
  register<NewDecorators, Opts>(plugin: RivrPlugin<NewDecorators, Opts, State, FirstState, StateByStepName>, opts: Opts | ((workflow: ReadyWorkflow<State, FirstState, StateByStepName, Decorators>) => Opts)): Workflow<State, FirstState, StateByStepName, Decorators & NewDecorators>

  /**
   * Iterate over each step.
   * The iterator yields a tuple containing the step, and the context within which the step must be executed.
   */
  steps(): Iterable<[step: Step<State, FirstState, StateByStepName, Decorators>, context: Workflow<State, FirstState, StateByStepName, Decorators>]>

  /**
   * Add a step
   *
   * @param opts
   */
  step<Name extends string>(opts: StepOpts<Name, State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on workflow completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on step error.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepError", handler: OnStepErrorHook<State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on skipped steps.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepSkipped", handler: OnStepSkippedHook<State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on workflow stopped.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onWorkflowStopped", handler: OnWorkflowStoppedHook<State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  /**
   * Hook on step completed.
   *
   * @param hook
   * @param handler
   */
  addHook(hook: "onStepCompleted", handler: OnStepCompletedHook<State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  addHook(hook: "onWorkflowFailed", handler: OnWorkflowFailedHook<State, FirstState, StateByStepName, Decorators>): Workflow<State, FirstState, StateByStepName, Decorators>

  getHook(hook: "onStepCompleted"): WithContext<OnStepCompletedHook<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators>[]
  getHook(hook: "onWorkflowCompleted"): WithContext<OnWorkflowCompletedHook<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators>[]
  getHook(hook: "onStepError"): WithContext<OnStepErrorHook<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators>[]
  getHook(hook: "onStepSkipped"): WithContext<OnStepSkippedHook<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators>[]
  getHook(hook: "onWorkflowStopped"): WithContext<OnWorkflowStoppedHook<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators>[]
  getHook(hook: "onWorkflowFailed"): WithContext<OnWorkflowFailedHook<State, FirstState, StateByStepName, Decorators>, State, FirstState, StateByStepName, Decorators>[]

  /**
   * Execute the dependency graph.
   * This function does nothing if the dependency graph was already executed.
   */
  ready(): Promise<ReadyWorkflow<State, FirstState, StateByStepName, Decorators>>
}

export type ReadyWorkflow<State, FirstState, StateByStepName extends Record<never, never>, Decorators> = Workflow<State, FirstState, StateByStepName, Decorators> & Decorators

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

export type RivrPlugin<Out, Opts, State, FirstState, StateByStepName extends Record<never, never>> = {
  (w: Workflow<State, FirstState, StateByStepName, any>, opts: Opts): Workflow<State, FirstState, StateByStepName, Out>
  opts: RivrPluginOpts<State, FirstState, StateByStepName>
}

export type RivrPluginOpts<State, FirstState, StateByStepName extends Record<never, never>, Deps extends RivrPlugin<any, any, State, FirstState, StateByStepName>[] = []> = {
  deps?: Deps
  /**
   * The plugin's name
   */
  name: string
}

export function rivrPlugin<Out, Opts = undefined, State = any, FirstState = any, StateByStepName extends Record<never, never> = Record<never, never>, Deps extends RivrPlugin<any, any, State, FirstState, StateByStepName>[] = []> (
  plugin: (w: ReadyWorkflow<State, FirstState, StateByStepName, MergeUnionTypes<GetDecorator<UnwrapItem<Deps>, State, FirstState, StateByStepName>>>, opts: Opts) => Workflow<State, FirstState, StateByStepName, Out>,
  opts: RivrPluginOpts<State, FirstState, StateByStepName, Deps>
): RivrPlugin<Out, Opts, State, FirstState, StateByStepName> {
  Object.assign(plugin, {
    opts,
  })

  return plugin as RivrPlugin<Out, Opts, State, FirstState, StateByStepName>
}

type UnwrapItem<T> = T extends (infer U)[] ? U : never
type GetDecorator<T, State, FirstState, StateByStepName extends Record<never, never>> = T extends RivrPlugin<infer U, any, State, FirstState, StateByStepName> ? U : never
