import {createGenericPlugin, GenericPlugin} from "./generic";
import {Extendable, Prettify, ReadyExtendable} from "../extension";
import {MergeUnionTypes} from "../../workflow/types";

/**
 * Create a plugin that can be used on any implementation of `Extendable`
 * such as `Task` and `Workflow`.
 *
 * @param opts
 */
export function createPlugin<OutDecorators extends Record<never, never>, Opts, Deps extends Plugin<any, any>[] = []>(
  opts: CreatePluginOpts<OutDecorators, Opts, Deps>
): Plugin<Extendable<Omit<OutDecorators, keyof DecoratorsFromDeps<Deps>>>, Opts> {
  return createGenericPlugin({
    ...opts,
    deps: []
  }) as unknown as Plugin<Extendable<OutDecorators>, Opts>
}

export interface CreatePluginOpts<OutDecorators extends Record<never, never>, Opts, Deps extends Plugin<any, any>[]> {
  name: string
  handler: (instance: ReadyExtendable<Prettify<DecoratorsFromDeps<Deps>>>, opts: Opts) => Extendable<OutDecorators>
  deps?: Deps
}

export type Plugin<U, Opts> = GenericPlugin<Extendable<Record<never, never>>, U, Opts>

export type UnwrapArray<T extends unknown[]> = T extends (infer U)[]
  ? U
  : never

export type UnwrapDecorators<T extends Plugin<Extendable<Record<never, never>>, any>> = T extends Plugin<Extendable<infer OutDecorators>, any>
  ? OutDecorators
  : never

export type EnsureRecord<T> = T extends Record<never, never>
  ? T
  : Record<never, never>

export type DecoratorsFromDeps<Deps extends Plugin<any, any>[]> = EnsureRecord<MergeUnionTypes<UnwrapDecorators<UnwrapArray<Deps>>>>

{
  const p = createPlugin({
    name: "foo",
    handler: (instance, opts: string) => instance.decorate("foo", opts)
  })

  const p1 = createPlugin({
    name: "p1",
    deps: [ p ],
    handler: (instance, opts: string) => instance.decorate("p1", instance.foo)
  })

  const p2 = createPlugin({
    name: "p2",
    deps: [ p1 ],
    handler: (instance, opts) => instance.decorate("p2", instance.p1)
  })


}