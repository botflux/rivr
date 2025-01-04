export interface WorkerInterface {
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
}

export type StartOpts = {
  signal?: AbortSignal
}