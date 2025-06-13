export interface GenericPlugin<T, U, Opts> {
  (instance: T, opts: Opts): U

  /**
   * The plugin's name
   * It is not called name because plugin are function,
   * and `Function.name` returns the actual function name.
   *
   * I didn't want to shadow the function's actual name.
   */
  pluginName: string

  /**
   * This plugin's dependencies list
   */
  dependencies: GenericPlugin<unknown, unknown, Opts>[]
}

export interface CreateGenericPluginOpts<T, U, Opts, Deps extends GenericPlugin<unknown, unknown, any>[]> {
  name: string
  handler: (instance: T, opts: Opts) => U
  deps?: Deps
}

export function createGenericPlugin<T, U, Opts, Deps extends GenericPlugin<unknown, unknown, any>[] = []> (
  opts: CreateGenericPluginOpts<T, U, Opts, Deps>
): GenericPlugin<T, U, Opts> {
  const { name, deps, handler } = opts

  Object.defineProperty(handler, 'pluginName', { value: name })
  Object.defineProperty(handler, 'dependencies', { value: deps })

  return handler as GenericPlugin<T, U, Opts>
}


{
  // manual testing that should be transformed into unit tests

  const a = createGenericPlugin({
    name: "my-plugin",
    handler: (instance: string, opts: string) => instance + opts
  })

  const ab= a("a", "b")
}