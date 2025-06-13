/**
 * This is a generic abstraction to represent a plugin.
 * This abstraction is not coupled to rivr constructs such as the `Task` or the `Workflow`.
 *
 * Why defining such an abstraction?
 *
 * This abstraction was made to support the following requirements:
 * - the user should be able to define plugins that works with both `Task`, `Workflow` or any new async flow
 *   was not develop yet, even user-defined one.
 * - the user should be able to define plugins that works with specific flows like `Workflow`.
 *   This enables the user to define `steps` within a plugin. In this scenario, the plugin should
 *   only be registerable by a workflow and not a task.
 *
 * So, this abstraction was to support the following features:
 * - shared plugins between workflows, task and user-defined flow
 * - allow step definition to be workflow specific, or specific to a user-defined flow
 */
export interface GenericPlugin<T, U, Opts, Deps extends GenericPlugin<unknown, unknown, any, any>[]> {
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

export type CreateGenericPluginOpts<T, U, Opts, Deps extends GenericPlugin<unknown, unknown, any, any>[]> = {
  name: string,
  handler: (instance: T, opts: Opts) => U
  deps?: Deps
}

export function createGenericPlugin<T, U, Opts, Deps extends GenericPlugin<any, any, any, any>[]>(
  opts: CreateGenericPluginOpts<T, U, Opts, Deps>,
): GenericPlugin<T, U, Opts, Deps> {
  const { name, deps = [], handler } = opts
  Object.defineProperty(handler, 'name', { value: name })
  Object.defineProperty(handler, 'dependencies', { value: deps })
  return handler as unknown as GenericPlugin<T, U, Opts, Deps>
}