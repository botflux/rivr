export type BaseHooks = Record<string, (...args: any[]) => void>

export class Hooks<H extends BaseHooks> {
  #hooks = new Map<keyof H, H[keyof H][]>()

  addHook<K extends keyof H>(name: K, fn: H[K]): this {
    this.#hooks.set(
      name,
      [ ...this.#hooks.get(name) ?? [], fn ]
    )
    return this
  }

  /**
   * Execute the hooks.
   *
   * @param name
   * @param params
   * @private
   */
  executeHook<K extends keyof H>(name: K, params: Parameters<H[K]>): void {
    const hooks = this.#hooks.get(name) ?? []

    for (const handler of hooks) {
      handler(...params)
    }
  }
}