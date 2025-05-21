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

  register<OutDecorators extends Record<never, never>>(
    plugin: RivrPlugin<Nothing, Nothing, Record<string, never>, OutDecorators>
  ): Workflow<State, FirstState, StateByStepName, Decorators & OutDecorators>

  register<OutState, OutStateByStepName extends Record<string, never>, OutDecorators extends Record<never, never>>(
    plugin: RivrPlugin<OutState, State, OutStateByStepName, OutDecorators>
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
> = {
  (w: ReadyWorkflow<any, any, Record<string, never>, Record<never, never>>): Workflow<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators>
  name: string
}

const kNothing = Symbol("nothing")
type Nothing = { [kNothing]: true }

interface PluginBuilder {
  input<T = Nothing> (): ReadyWorkflow<T, T, Record<string, never>, Record<never, never>>
}

export type RivrPluginOpts<
  OutState,
  FirstPluginState,
  PluginStateByStepName extends Record<string, never>,
  PluginDecorators extends Record<never, never>,
> = {
  name: string
  plugin: (w: PluginBuilder) => Workflow<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators>
}

export function rivrPlugin<
  OutState,
  FirstPluginState,
  PluginStateByStepName extends Record<string, never>,
  PluginDecorators extends Record<never, never>
> (
  opts: RivrPluginOpts<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators>
): RivrPlugin<OutState, FirstPluginState, PluginStateByStepName, PluginDecorators> {
  const plugin = (w: ReadyWorkflow<any, any, Record<string, never>, Record<never, never>>) => opts.plugin({
    input<T>(): ReadyWorkflow<T, T, Record<string, never>, Record<never, never>> {
      return w
    }
  })

  Object.defineProperty(plugin, "name", { value: opts.name })
  return plugin
}


export type UnwrapItem<T> = T extends (infer U)[] ? U : never
export type GetDecorator<T> = T extends RivrPlugin<any, any, any, infer U> ? U : never
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
    : never

export type DecoratorsFromDeps<Deps extends RivrPlugin<any, any, any, any>[]> =
  EnsureRecord<MergeUnionTypes<GetDecorator<UnwrapItem<Deps>>>>

const plugin1 = rivrPlugin({
  name: "my-plugin",
  plugin: p => p.input().decorate("foo", 1)
})

const plugin2 = rivrPlugin({
  name: "plugin-2",
  plugin: p => p.input().decorate("bar", 2)
})

const plugin3 = rivrPlugin({
  name: "plugin-3",
  deps: [ plugin1, plugin2 ],
  plugin: p => {
    const w = p.input()


    return w.decorate("foobar", w.foo + w.bar)
  }
})

type D = DecoratorsFromDeps<[ typeof plugin1, typeof plugin2 ]>

const d: D = {
  bar: 2,
  foo: 1
}