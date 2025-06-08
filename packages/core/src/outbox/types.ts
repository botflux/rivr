export type ReadyOutbox<State, Decorators extends Record<never, never>> = Outbox<State, Decorators> & Decorators

export interface OutboxHandlerOpts<State, Decorators extends Record<never, never>> {
  state: State
  outbox: ReadyOutbox<State, Decorators>
  attempt: number
}

export interface OutboxHandler<State, Decorators extends Record<never, never>> {
  (opts: OutboxHandlerOpts<State, Decorators>): void | Promise<void>
}

export interface Outbox<State, Decorators extends Record<never, never>> {
  name: string

  /**
   * Add a property to the outbox instance.
   *
   * @param key
   * @param value
   */
  decorate<Key extends string, Value>(key: Key, value: Value): Outbox<State, Decorators & Record<Key, Value>>

  /**
   * Register a plugin that requires options.
   *
   * @param plugin
   */
  register<OutDecorators extends Record<never, never>, Opts>(
    plugin: OutboxPlugin<Decorators, OutDecorators, Opts>
  ): Outbox<State, Decorators & OutDecorators>

  /**
   * Register a plugin without options.
   *
   * @param plugin
   */
  register<OutDecorators extends Record<never, never>>(
    plugin: OutboxPlugin<Decorators, OutDecorators, never>
  ): Outbox<State, Decorators & OutDecorators>

  /**
   * Define the outbox's handler.
   *
   * @param handler
   */
  handler(handler: OutboxHandler<State, Decorators>): Outbox<State, Decorators>

  /**
   * Execute all the register plugins and their sub-plugins.
   */
  ready(): Promise<ReadyOutbox<State, Decorators>>
}

export function createOutbox<State> (name: string): Outbox<State, Record<never, never>> {
  throw new Error("Not implemented at line 56 in types.ts")
}

export interface OutboxPlugin<InDecorators extends Record<never, never>, OutDecorators extends Record<never, never>, Opts> {
  (instance: Outbox<unknown, InDecorators>, opts: Opts): Outbox<unknown, OutDecorators>
}
