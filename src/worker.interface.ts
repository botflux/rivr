import EventEmitter from "node:events";

export interface WorkerInterface extends EventEmitter<{ error: [ unknown ], stopped: [] }> {
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

  on(event: "error", listener: (e: unknown) => void): this
  once(event: "error", listener: (e: unknown) => void): this
  off(event: "error", listener: (e: unknown) => void): this

  on(event: "stopped", listener: (e: unknown) => void): this
  once(event: "stopped", listener: (e: unknown) => void): this
  off(event: "stopped", listener: (e: unknown) => void): this
}

export type StartOpts = {
  signal?: AbortSignal
}