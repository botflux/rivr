import {Consumption, Message, Queue} from "./queue";
import {Task} from "./task/types";
import {createTaskHandler} from "./task/handler";

export interface Worker {
  start(): Promise<void>
  stop(): Promise<void>
}

export type WorkerHandler = (
  primary: Queue<unknown>,
  message: Message
) => Promise<boolean>

export class DefaultWorker implements Worker {
  #primary: Queue<unknown>
  #secondaries: Queue<unknown>[]
  #handlers: WorkerHandler[]

  #consumptions: Consumption[] = []

  constructor(primary: Queue<unknown>, secondaries: Queue<unknown>[], handlers: WorkerHandler[]) {
    this.#primary = primary;
    this.#secondaries = secondaries;
    this.#handlers = handlers;
  }

  async start(): Promise<void> {
    this.#consumptions = [ this.#primary, ...this.#secondaries ].map(q => q.consume({
      onMessage: async (msg)=> {
        for (const handler of this.#handlers) {
          if (await handler(this.#primary, msg)) {
            break
          }
        }
      }
    }))

    await Promise.all(this.#consumptions.map(c => c.start()))
  }

  async stop(): Promise<void> {
    await Promise.all(this.#consumptions.map(c => c.stop()))
    await Promise.all([ this.#primary, ...this.#secondaries ].map(q => q.disconnect()))
  }
}

export type CreateDefaultWorker = {
  /**
   * The main queue in which async processes will produce in.
   */
  primary: Queue<unknown>

  /**
   * Additional queues that the worker will consume, but never produce in.
   */
  secondaries?: Queue<unknown>[]

  /**
   * Outboxes to handle
   */
  tasks: Task<any, any>[]
}

export function createWorker(opts: CreateDefaultWorker): Worker {
  const { primary, secondaries = [], tasks } = opts

  return new DefaultWorker(
    primary,
    secondaries,
    [
      createTaskHandler(tasks as Task<unknown, Record<never, never>>[])
    ]
  )
}