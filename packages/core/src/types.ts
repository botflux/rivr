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
export type Step = {
  name: string
  handler: Handler<unknown, unknown, unknown, Record<never, never>, Record<never, never>>
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
  step: Step, state: unknown
) => void
export type OnWorkflowStoppedHook<Decorators extends Record<never, never>> = (
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step, state: unknown
) => void
export type OnWorkflowFailedHook<Decorators extends Record<never, never>> = (
  error: unknown,
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step,
  state: unknown
) => void
export type OnStepCompletedHook<Decorators extends Record<never, never>> = (
  workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Decorators>,
  step: Step,
  state: unknown
) => void

export type WithContext<T> = {
  item: T
  context: ReadyWorkflow<unknown, unknown, Record<never, never>, Record<never, never>>
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
  getFirstStep(): Step | undefined

  /**
   * Get a step, and its execution context, from its name.
   * Returns `undefined` if no step is matching the given name.
   *
   * @param name
   */
  getStepByName(name: string): WithContext<Step> | undefined

  /**
   * Search the step succeeding the step matching the given name.
   * `undefined` is returned if there is no next step.
   * An error is thrown if there is no step matching the given name.
   *
   * @param name
   */
  getNextStep(name: string): Step | undefined

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
  steps(): Iterable<WithContext<Step>>

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

  getHook(hook: "onStepCompleted"): WithContext<OnStepCompletedHook<Record<never, never>>>[]
  getHook(hook: "onWorkflowCompleted"): WithContext<OnWorkflowCompletedHook<Record<never, never>>>[]
  getHook(hook: "onStepError"): WithContext<OnStepErrorHook<Record<never, never>>>[]
  getHook(hook: "onStepSkipped"): WithContext<OnStepSkippedHook<Record<never, never>>>[]
  getHook(hook: "onWorkflowStopped"): WithContext<OnWorkflowStoppedHook<Record<never, never>>>[]
  getHook(hook: "onWorkflowFailed"): WithContext<OnWorkflowFailedHook<Record<never, never>>>[]

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

  register<OutDecorators extends Record<never, never>, PluginOpts>(
    plugin: RivrPlugin<Nothing, Nothing, Record<string, never>, OutDecorators, PluginOpts, any>,
    opts: PluginOpts
  ): Workflow<State, FirstState, StateByStepName, Decorators & OutDecorators>

  register<OutDecorators extends Record<never, never>>(
    plugin: RivrPlugin<Nothing, Nothing, Record<string, never>, OutDecorators, void, any>,
  ): Workflow<State, FirstState, StateByStepName, Decorators & OutDecorators>


  register<OutState, OutStateByStepName extends Record<string, never>, OutDecorators extends Record<never, never>, PluginOpts>(
    plugin: RivrPlugin<OutState, State, OutStateByStepName, OutDecorators, PluginOpts, any>,
    opts: PluginOpts
  ): Workflow<OutState, FirstState, StateByStepName & OutStateByStepName, Decorators & OutDecorators>

  register<OutState, OutStateByStepName extends Record<string, never>, OutDecorators extends Record<never, never>>(
    plugin: RivrPlugin<OutState, State, OutStateByStepName, OutDecorators, void, any>,
  ): Workflow<OutState, FirstState, StateByStepName & OutStateByStepName, Decorators & OutDecorators>
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
  OutState,
  FirstPluginState,
  PluginStateByStepName extends Record<string, never>,
  PluginDecorators extends Record<never, never>,
  PluginOpts,
  Deps extends RivrPlugin<any, any, any, any, any, any>[]
> = {
  (w: ReadyWorkflow<any, any, Record<string, never>, DecoratorsFromDeps<Deps>>, opts: PluginOpts): Workflow<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators>
  name: string
  deps: RivrPlugin<any, any, any, any, any, any>[]
}

const kNothing = Symbol("nothing")
type Nothing = { [kNothing]: true }

interface PluginBuilder<Deps extends RivrPlugin<any, any, any, Record<never, never>, any, any>[]> {
  input<T = Nothing> (): ReadyWorkflow<T, T, Record<string, never>, DecoratorsFromDeps<Deps>>
}

export type PluginHandler<
  OutState,
  FirstPluginState,
  PluginStateByStepName extends Record<string, never>,
  PluginDecorators extends Record<never, never>,
  PluginOpts,
  Deps extends RivrPlugin<any, any, any, Record<never, never>, any, any>[]
> = (w: PluginBuilder<Deps>, opts: PluginOpts) => Workflow<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators>

export type RivrPluginOpts<
  OutState,
  FirstPluginState,
  PluginStateByStepName extends Record<string, never>,
  PluginDecorators extends Record<never, never>,
  PluginOpts = void,
  Deps extends RivrPlugin<any, any, any, Record<never, never>, any, any>[] = []
> = {
  name: string
  deps?: Deps
  plugin: PluginHandler<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators, PluginOpts, Deps>
}

export function rivrPlugin<
  OutState,
  FirstPluginState,
  PluginStateByStepName extends Record<string, never>,
  PluginDecorators extends Record<never, never>,
  PluginOpts,
  Deps extends RivrPlugin<any, any, any, Record<never, never>, any, any>[]
> (
  opts: RivrPluginOpts<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators, PluginOpts, Deps>
): RivrPlugin<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators, PluginOpts, any> {
  const plugin = (
    w: ReadyWorkflow<any, any, Record<string, never>, DecoratorsFromDeps<Deps>>,
    pluginOpts: PluginOpts
  ) => opts.plugin({
    input<T>(): ReadyWorkflow<T, T, Record<string, never>, DecoratorsFromDeps<Deps>> {
      return w
    }
  }, pluginOpts)

  Object.defineProperty(plugin, "name", { value: opts.name })
  Object.defineProperty(plugin, "deps", { value: opts.deps })

  // @ts-expect-error TODO: find out why I need this ts-expect-error
  return plugin
}


export type UnwrapItem<T> = T extends (infer U)[] ? U : never
export type GetDecorator<T> = T extends RivrPlugin<any, any, any, infer U, any, any> ? U : never
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

export type EnsureRecord<T> = T extends Record<never, never>
    ? T
    : Record<never, never>

export type DecoratorsFromDeps<Deps extends RivrPlugin<any, any, any, any, any, any>[]> =
  EnsureRecord<MergeUnionTypes<GetDecorator<UnwrapItem<Deps>>>>



