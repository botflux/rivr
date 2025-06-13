/**
 * Stolen from Matt Pocock's [prettify article](https://www.totaltypescript.com/concepts/the-prettify-helper)
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export interface Extendable<Decorators extends Record<never, never>> {
  decorate<Key extends string, Value>(key: Key, value: Value): Extendable<Prettify<Decorators & Record<Key, Value>>>
}

export type ReadyExtendable<Decorators extends Record<never, never>> = Extendable<Decorators> & Decorators

