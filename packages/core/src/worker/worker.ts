export type OnError = (error: unknown) => void

export interface Worker {
  /**
   * Start the worker
   */
  start(): Promise<void>

  /**
   * Stop the worker
   */
  stop(): Promise<void>

  /**
   * Register an error hook.
   *
   * @param hook
   * @param fn
   */
  addHook(hook: "error", fn: OnError): void
}

