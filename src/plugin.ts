import {Workflow} from "./types.ts";

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

export type RivrPlugin<Out, State> = {
  (w: Workflow<State, any>): Workflow<State, Out>
  deps: RivrPlugin<State, unknown>[]
}

export function rivrPlugin<Out, State = any, Deps extends RivrPlugin<any, State>[] = []> (
  plugin: (w: Workflow<State, MergeUnionTypes<GetDecorator<UnwrapItem<Deps>, State>>>) => Workflow<State, Out>,
  deps: Deps
): RivrPlugin<Out, State> {
  Object.assign(plugin, {
    deps
  })

  return plugin as RivrPlugin<Out, State>
}

const plugin1 = rivrPlugin(w => w.decorate("foo", "foo"), [])
const plugin2 = rivrPlugin(w => w.decorate("bar", "bar"), [])

const deps = [ plugin1, plugin2 ]

const plugin3 = rivrPlugin(w => w.decorate("baz", w.bar + w.foo), deps)

type UnwrapItem<T> = T extends (infer U)[] ? U : never
type GetDecorator<T, State> = T extends RivrPlugin<infer U, State> ? U : never

