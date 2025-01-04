export interface WorkerInterface {
  /**
   * This worker's unique id.
   */
  id: string

  /**
   * Start the worker.
   * Calling this method does nothing given the worker is already started.
   *
   * You can call `stop` to stop the worker, but you can also pass an `AbortSignal`
   * to this method.
   *
   * @param opts
   */
  start(opts?: StartOpts): void

  /**
   * Stop the process.
   * The worker will finish the handling of the current messages.
   */
  stop(): void

  on(event: "error", listener: (e: unknown) => void): void
  once(event: "error", listener: (e: unknown) => void): void
  off(event: "error", listener: (e: unknown) => void): void
}

export type StartOpts = {
  signal?: AbortSignal
}