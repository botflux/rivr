export type ReadyOutbox<State, Decorators extends Record<never, never>> = Outbox<State, Decorators> & Decorators

export type Success = { type: "success" }
export type Failure = { type: "error", error: unknown }
export type OutboxResult = Success | Failure

export interface OutboxHandlerOpts<State, Decorators extends Record<never, never>> {
  attempt?: number
  handler: OutboxHandlerFn<State, Decorators>
}

export interface OutboxHandlerContext<State, Decorators extends Record<never, never>> {
  state: State
  outbox: ReadyOutbox<State, Decorators>
  attempt: number
}

export interface OutboxHandlerFn<State, Decorators extends Record<never, never>> {
  (opts: OutboxHandlerContext<State, Decorators>): void | Promise<void> | OutboxResult | Promise<OutboxResult>
}

const kOutbox = Symbol("outbox")

export interface Outbox<State, Decorators extends Record<never, never>> {
  [kOutbox]: true,
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
   * @param opts
   */
  register<OutDecorators extends Record<never, never>, Opts>(
    plugin: OutboxPlugin<Decorators, OutDecorators, Opts>,
    opts: Opts
  ): Outbox<State, Decorators & OutDecorators>

  /**
   * Register a plugin without options.
   *
   * @param plugin
   */
  register<OutDecorators extends Record<never, never>>(
    plugin: OutboxPlugin<Decorators, OutDecorators, undefined>
  ): Outbox<State, Decorators & OutDecorators>

  /**
   * Define the outbox's handler.
   *
   * @param handler
   */
  handler(handler: OutboxHandlerOpts<State, Decorators>): Outbox<State, Decorators>

  /**
   * Execute all the register plugins and their sub-plugins.
   */
  ready(): Promise<ReadyOutbox<State, Decorators>>

  /**
   * Get this outbox's handler.
   */
  getHandler(): Required<OutboxHandlerOpts<State, Decorators>>
}

export function isOutbox (value: unknown): value is Outbox<unknown, Record<never, never>> {
  return typeof value === "object" && value !== null
    && kOutbox in value
}

type PluginAndOpts = {
  plugin: OutboxPlugin<Record<never, never>, Record<never, never>, unknown>
  opts: unknown
}

export function createOutbox<State> (name: string): Outbox<State, Record<never, never>> {
  const plugins: PluginAndOpts[] = []
  let ready = false
  let handler: Required<OutboxHandlerOpts<State, Record<never, never>>> | undefined = undefined

  return {
    name,
    [kOutbox]: true,
    decorate<Key extends string, Value>(key: Key, value: Value): Outbox<State, Record<never, never> & Record<Key, Value>> {
      Object.defineProperty(this, key, { value })
      return this as unknown as Outbox<State, Record<Key, Value>>
    },
    register<OutDecorators extends Record<never, never>, Opts>(
      plugin: OutboxPlugin<Record<never, never>, OutDecorators, Opts>,
      opts?: Opts | undefined
    ): Outbox<State, Record<never, never> & OutDecorators> {
      plugins.push({
        plugin: plugin as unknown as OutboxPlugin<Record<never, never>, Record<never, never>, unknown>,
        opts
      })

      return this as unknown as Outbox<State, Record<never, never> & OutDecorators>
    },
    handler(h: OutboxHandlerOpts<State, Record<never, never>>): Outbox<State, Record<never, never>> {
      if (handler !== undefined) {
        throw new Error("Not implemented at line 104 in types.ts")
      }

      handler = {
        attempt: 1,
        ...h,
      }
      return this
    },
    getHandler(): Required<OutboxHandlerOpts<State, Record<never, never>>> {
      if (handler === undefined) {
        throw new Error("Not implemented at line 112 in types.ts")
      }

      return handler
    },
    async ready(): Promise<ReadyOutbox<State, Record<never, never>>> {
      if (ready) {
        return this as unknown as ReadyOutbox<State, Record<never, never>>
      }

      for (const { plugin, opts } of plugins) {
        plugin(this as ReadyOutbox<unknown, Record<never, never>>, opts)
      }

      ready = true
      return this as unknown as ReadyOutbox<State, Record<never, never>>
    }
  }
}

export interface OutboxPlugin<InDecorators extends Record<never, never>, OutDecorators extends Record<never, never>, Opts> {
  (instance: ReadyOutbox<unknown, InDecorators>, opts: Opts): Outbox<unknown, OutDecorators>
}
