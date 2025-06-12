export type ReadyTask<State, Decorators extends Record<never, never>> = Task<State, Decorators> & Decorators

export type Success = { type: "success" }
export type Failure = { type: "error", error: unknown }
export type TaskResult = Success | Failure

export interface TaskHandlerOpts<State, Decorators extends Record<never, never>> {
  attempt?: number
  handler: TaskHandlerFn<State, Decorators>
}

export interface TaskHandlerContext<State, Decorators extends Record<never, never>> {
  state: State
  task: ReadyTask<State, Decorators>
  attempt: number
}

export interface TaskHandlerFn<State, Decorators extends Record<never, never>> {
  (opts: TaskHandlerContext<State, Decorators>): void | Promise<void> | TaskResult | Promise<TaskResult>
}

const kTask = Symbol("task")

export interface Task<State, Decorators extends Record<never, never>> {
  [kTask]: true,
  name: string

  /**
   * Add a property to the task instance.
   *
   * @param key
   * @param value
   */
  decorate<Key extends string, Value>(key: Key, value: Value): Task<State, Decorators & Record<Key, Value>>

  /**
   * Register a plugin that requires options.
   *
   * @param plugin
   * @param opts
   */
  register<OutDecorators extends Record<never, never>, Opts>(
    plugin: TaskPlugin<Decorators, OutDecorators, Opts>,
    opts: Opts
  ): Task<State, Decorators & OutDecorators>

  /**
   * Register a plugin without options.
   *
   * @param plugin
   */
  register<OutDecorators extends Record<never, never>>(
    plugin: TaskPlugin<Decorators, OutDecorators, undefined>
  ): Task<State, Decorators & OutDecorators>

  /**
   * Define the outbox's handler.
   *
   * @param handler
   */
  handler(handler: TaskHandlerOpts<State, Decorators>): Task<State, Decorators>

  /**
   * Execute all the register plugins and their sub-plugins.
   */
  ready(): Promise<ReadyTask<State, Decorators>>

  /**
   * Get this outbox's handler.
   */
  getHandler(): Required<TaskHandlerOpts<State, Decorators>>
}

export function isTask (value: unknown): value is Task<unknown, Record<never, never>> {
  return typeof value === "object" && value !== null
    && kTask in value
}

type PluginAndOpts = {
  plugin: TaskPlugin<Record<never, never>, Record<never, never>, unknown>
  opts: unknown
}

export function createTask<State> (name: string): Task<State, Record<never, never>> {
  const plugins: PluginAndOpts[] = []
  let ready = false
  let handler: Required<TaskHandlerOpts<State, Record<never, never>>> | undefined = undefined

  return {
    name,
    [kTask]: true,
    decorate<Key extends string, Value>(key: Key, value: Value): Task<State, Record<never, never> & Record<Key, Value>> {
      Object.defineProperty(this, key, { value })
      return this as unknown as Task<State, Record<Key, Value>>
    },
    register<OutDecorators extends Record<never, never>, Opts>(
      plugin: TaskPlugin<Record<never, never>, OutDecorators, Opts>,
      opts?: Opts | undefined
    ): Task<State, Record<never, never> & OutDecorators> {
      plugins.push({
        plugin: plugin as unknown as TaskPlugin<Record<never, never>, Record<never, never>, unknown>,
        opts
      })

      return this as unknown as Task<State, Record<never, never> & OutDecorators>
    },
    handler(h: TaskHandlerOpts<State, Record<never, never>>): Task<State, Record<never, never>> {
      if (handler !== undefined) {
        throw new Error("Not implemented at line 104 in types.ts")
      }

      handler = {
        attempt: 1,
        ...h,
      }
      return this
    },
    getHandler(): Required<TaskHandlerOpts<State, Record<never, never>>> {
      if (handler === undefined) {
        throw new Error("Not implemented at line 112 in types.ts")
      }

      return handler
    },
    async ready(): Promise<ReadyTask<State, Record<never, never>>> {
      if (ready) {
        return this as unknown as ReadyTask<State, Record<never, never>>
      }

      for (const { plugin, opts } of plugins) {
        plugin(this as ReadyTask<unknown, Record<never, never>>, opts)
      }

      ready = true
      return this as unknown as ReadyTask<State, Record<never, never>>
    }
  }
}

export interface TaskPlugin<InDecorators extends Record<never, never>, OutDecorators extends Record<never, never>, Opts> {
  (instance: ReadyTask<unknown, InDecorators>, opts: Opts): Task<unknown, OutDecorators>
}
