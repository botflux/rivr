import {ReadyWorkflow, Workflow} from "./types.ts";

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
  opts?: RivrPluginOpts<State>
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

