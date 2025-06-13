import {createGenericPlugin, CreateGenericPluginOpts, GenericPlugin} from "./generic";
import {Extendable, ReadyExtendable} from "../extension";
import {MergeUnionTypes, UnwrapItem} from "../../workflow/types";

export interface CreatePluginOpts<
  InDecorators extends Record<never, never>,
  OutDecorators extends Record<never, never>,
  Opts,
  Deps extends GenericPlugin<any, Extendable<Record<never, never>>, any, any>[]
> extends CreateGenericPluginOpts<ReadyExtendable<InDecorators>, Extendable<OutDecorators>, Opts, Deps> {}

export type DecoratorsFromPlugins<Deps extends GenericPlugin<any, Extendable<Record<never, never>>, any, any>> =
  Deps extends GenericPlugin<any, Extendable<infer Decorators>, any, any>
    ? Decorators
    : never

export type EnsureRecord<T> = T extends Record<never, never>
  ? T
  : Record<never, never>

/**
 * This type transformed the dependency list `GenericPlugin<any, Extendable<Record<never, never>>, any, any>[]`
 * into a decorated object.
 *
 * For example, if you have the following plugins:
 * ```typescript
 * type Plugins = [
 *   GenericPlugins<any, Extendable<{ foo: string }>, any, any>,
 *   GenericPlugins<any, Extendable<{ bar: string }>, any, any>
 * ]
 * ```
 *
 * Then, this type will transform it into this type:
 * ```
 * type Result = { foo: string, bar: string }
 * ```
 *
 * The complete operation are:
 *
 * 1. Transform the tuple to a union (`UnwrapItem`)
 *
 * ```typescript
 * type Plugins = [
 *   GenericPlugins<any, Extendable<{ foo: string }>, any, any>,
 *   GenericPlugins<any, Extendable<{ bar: string }>, any, any>
 * ]
 *
 * // becomes
 * type Result = GenericPlugins<any, Extendable<{ foo: string }>, any, any> | GenericPlugins<any, Extendable<{ bar: string }>, any, any>
 * ```
 *
 * 2. Extract the decorators (`DecoratorsFromPlugins`)
 *
 * ```typescript
 * type Input = GenericPlugins<any, Extendable<{ foo: string }>, any, any> | GenericPlugins<any, Extendable<{ bar: string }>, any, any>
 * // becomes
 * type Result = { foo: string } | { bar: string }
 * ```
 *
 * 3. Transform the union into a merged type (`MergeUnionTypes`)
 *
 * ```typescript
 * type Input = { foo: string } | { bar: string }
 * // becomes
 * type Result = { foo: string } & { bar: string }
 * ```
 *
 * 4. Default to `Record<never, never>` (`EnsureRecord`)
 *
 * This is needed when no dependencies were passed.
 *
 * ```typescript
 * type Input = { foo: string } & { bar: string }
 * // stays
 * type Result = { foo: string } & { bar: string }
 *
 * // but
 * type Input = never
 * // becomes
 * type Input = Record<never, never>
 * ```
 */
export type DecoratorsFromDeps<Deps extends GenericPlugin<any, Extendable<Record<never, never>>, any, any>[]> = EnsureRecord<MergeUnionTypes<DecoratorsFromPlugins<UnwrapItem<Deps>>>>

/**
 * Create a plugin that works both with `Workflows` and `Task` at the same time.
 * In fact, the plugin can work with any structure implementing `Extendable`.
 *
 * @param opts
 */
export function createPlugin<
  OutDecorators extends Record<never, never>,
  Opts,
  Deps extends GenericPlugin<any, Extendable<Record<never, never>>, any, any>[]
>(
  opts: CreatePluginOpts<DecoratorsFromDeps<Deps>, OutDecorators, Opts, Deps>
): GenericPlugin<DecoratorsFromDeps<Deps>, Extendable<Omit<OutDecorators, keyof DecoratorsFromDeps<Deps>>>, Opts, Deps> {
  return createGenericPlugin(opts) as GenericPlugin<DecoratorsFromDeps<Deps>, Extendable<Omit<OutDecorators, keyof DecoratorsFromDeps<Deps>>>, Opts, Deps>
}