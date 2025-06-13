import {Extendable, ReadyExtendable} from "./extension/extension";
import {MergeUnionTypes, UnwrapItem} from "./workflow/types";

/**
 * This plugin abstraction is not coupled with rivr flows
 * such as tasks or workflows.
 */
export interface Plugin<T, U, Opts, Deps extends Plugin<unknown, unknown, any, any>[]> {
  /**
   * The actual plugin body.
   * Note that the instance is generic in order to work
   * on tasks and workflows at the same time.
   *
   * @param instance
   * @param opts
   */
  (instance: T, opts: Opts): U

  /**
   * The plugin's name
   */
  name: string

  /**
   * A list of dependencies that this plugin
   * depends on.
   */
  dependencies: Deps
}

export type CreatePlugin<T, U, Opts, Deps extends Plugin<unknown, unknown, any, any>[]> = {
  name: string,
  handler: (instance: T, opts: Opts) => U
  deps?: Deps
}

export function createPlugin<T, U, Opts, Deps extends Plugin<any, any, any, any>[]>(
  opts: CreatePlugin<T, U, Opts, Deps>,
): Plugin<T, U, Opts, Deps> {
  const { name, deps = [], handler } = opts
  Object.defineProperty(handler, 'name', { value: name })
  Object.defineProperty(handler, 'dependencies', { value: deps })
  return handler as unknown as Plugin<T, U, Opts, Deps>
}

const kNothing = Symbol("kNothing")
export type Nothing = { [kNothing]: true }

export interface CreateGenericPlugin<
  InDecorators extends Record<never, never>,
  OutDecorators extends Record<never, never>,
  Opts,
  Deps extends Plugin<any, Extendable<Record<never, never>>, any, any>[]
> extends CreatePlugin<ReadyExtendable<InDecorators>, Extendable<OutDecorators>, Opts, Deps> {}

export type DecoratorsFromPlugins<Deps extends Plugin<any, Extendable<Record<never, never>>, any, any>> =
  Deps extends Plugin<any, Extendable<infer Decorators>, any, any>
    ? Decorators
    : never

export type EnsureRecord<T> = T extends Record<never, never>
    ? T
    : Record<never, never>

export type DecoratorsFromDeps<Deps extends Plugin<any, Extendable<Record<never, never>>, any, any>[]> = EnsureRecord<MergeUnionTypes<DecoratorsFromPlugins<UnwrapItem<Deps>>>>

export function createGenericPlugin<
  OutDecorators extends Record<never, never>,
  Opts,
  Deps extends Plugin<any, Extendable<Record<never, never>>, any, any>[]
>(
  opts: CreateGenericPlugin<DecoratorsFromDeps<Deps>, OutDecorators, Opts, Deps>
): Plugin<DecoratorsFromDeps<Deps>, Extendable<Omit<OutDecorators, keyof DecoratorsFromDeps<Deps>>>, Opts, Deps> {
  return createPlugin(opts) as Plugin<DecoratorsFromDeps<Deps>, Extendable<Omit<OutDecorators, keyof DecoratorsFromDeps<Deps>>>, Opts, Deps>
}

const a = createGenericPlugin({
  name: "a",
  handler: instance => instance.decorate("a", 10)
})

const b = createGenericPlugin({
  name: "b",
  deps: [ a ],
  handler: instance => {
    return instance.decorate("b", 1 + instance.a)
    // return instance
  }
})

const c = createGenericPlugin({
  name: "c",
  handler: instance => {
    return instance.decorate("c", 4)
  }
})

const d = createGenericPlugin({
  name: "d",
  deps: [ b, c ],
  handler: instance => instance.decorate("d", instance.c + instance.b)
})
