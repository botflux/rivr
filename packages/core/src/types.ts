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
  workflow: ReadyWorkflow<State, Decorators>
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
  optional: boolean
  delayBetweenAttempts: number | ((attempt: number) => number)
}

export type StepOpts<Name extends string, State, Decorators> = {
  name: Name
  handler: Handler<State, Decorators>
  maxAttempts?: number
  delayBetweenAttempts?: number | ((attempt: number) => number)

  /**
   * True if this step can fail without blocking the workflow.
   */
  optional?: boolean
}

export type OnWorkflowCompletedHook<State, Decorators> = (workflow: ReadyWorkflow<State, Decorators>, state: State) => void
export type OnStepErrorHook<State, Decorators> = (error: unknown, workflow: ReadyWorkflow<State, Decorators>, state: State) => void
export type OnStepSkippedHook<State, Decorators> = (workflow: ReadyWorkflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void
export type OnWorkflowStoppedHook<State, Decorators> = (workflow: ReadyWorkflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void
export type OnWorkflowFailedHook<State, Decorators> = (error: unknown, workflow: ReadyWorkflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void
export type OnStepCompletedHook<State, Decorators> = (workflow: ReadyWorkflow<State, Decorators>, step: Step<State, Decorators>, state: State) => void

export type Plugin<State, Decorators, NewDecorators> = (workflow: Workflow<State, Decorators>) => Workflow<State, NewDecorators>

export type WithContext<T, State, Decorators> = [ item: T, context: ReadyWorkflow<State, Decorators> ]

export type Workflow<State, Decorators> = {
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
   * Get a step, and its execution context, from its name.
   * Returns `undefined` if no step is matching the given name.
   *
   * @param name
   */
  getStepByName(name: string): WithContext<Step<State, Decorators>, State, Decorators> | undefined

  /**
   * Search the step succeeding the step matching the given name.
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
  register<NewDecorators>(plugin: RivrPlugin<NewDecorators, undefined, State>): Workflow<State, Decorators & NewDecorators>
  register<NewDecorators, Opts>(plugin: RivrPlugin<NewDecorators, Opts, State>, opts: Opts | ((workflow: ReadyWorkflow<State, Decorators>) => Opts)): Workflow<State, Decorators & NewDecorators>

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
  step<Name extends string>(opts: StepOpts<Name, State, Decorators>): Workflow<State, Decorators>

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
  ready(): Promise<ReadyWorkflow<State, Decorators>>
}

export type ReadyWorkflow<State, Decorators> = Workflow<State, Decorators> & Decorators

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

export type RivrPlugin<Out, Opts, State> = {
  (w: Workflow<State, any>, opts: Opts): Workflow<State, Out>
  opts: RivrPluginOpts<State>
}

export type RivrPluginOpts<State, Deps extends RivrPlugin<any, any, State>[] = []> = {
  deps?: Deps
  /**
   * The plugin's name
   */
  name: string
}

export function rivrPlugin<Out, Opts = undefined, State = any, Deps extends RivrPlugin<any, any, State>[] = []> (
  plugin: (w: ReadyWorkflow<State, MergeUnionTypes<GetDecorator<UnwrapItem<Deps>, State>>>, opts: Opts) => Workflow<State, Out>,
  opts: RivrPluginOpts<State, Deps>
): RivrPlugin<Out, Opts, State> {
  Object.assign(plugin, {
    opts,
  })

  return plugin as RivrPlugin<Out, Opts, State>
}

type UnwrapItem<T> = T extends (infer U)[] ? U : never
type GetDecorator<T, State> = T extends RivrPlugin<infer U, any, State> ? U : never
