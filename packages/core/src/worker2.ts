import {OnErrorHook, Worker} from "./engine";
import {Workflow} from "./types";
import {Consumption, Queue} from "./queue";
import {isOutbox, Outbox,} from "./outbox/types";
import { isState as isOutboxState } from "./outbox/state"
import { handleState as handlerOutboxState } from "./outbox/handler"

export type AsyncFlow = Outbox<unknown, Record<never, never>> | Workflow<unknown, unknown, Record<string, never>, Record<never, never>>

export class Worker2 implements Worker {
  #queues: Queue<unknown>[] = []
  #asyncFlows: AsyncFlow[] = []

  #consumptions: Consumption[] = []
  #errorHooks: OnErrorHook[] = []

  constructor(queues: Queue<unknown>[], asyncFlows: AsyncFlow[]) {
    this.#queues = queues;
    this.#asyncFlows = asyncFlows;
  }

  async start<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<void> {
    const readyFlows = await Promise.all(
      this.#asyncFlows.map(flow => flow.ready())
    )

    for (const queue of this.#queues) {
      const consumption = queue.consume({
        onMessage: async msg => {
          try {
            const { payload } = msg

            if (isOutboxState(payload)) {
              const outbox = readyFlows
                .filter(isOutbox)
                .find(outbox => outbox.name === payload.name)

              if (outbox === undefined) {
                return
              }

              await handlerOutboxState(queue, outbox, payload)
            }
          } catch (error: unknown) {
            this.#executeErrorHooks(error)
          }
        }
      })

      this.#consumptions.push(consumption)
    }

    await Promise.all(this.#consumptions.map(c => c.start()))
  }

  addHook(hook: "onError", handler: OnErrorHook): this {
    this.#errorHooks.push(handler)
    return this
  }

  async stop(): Promise<void> {
    await Promise.all(this.#consumptions.map(c => c.stop()))
  }

  #executeErrorHooks (error: unknown): void {
    for (const hook of this.#errorHooks) {
      hook(error)
    }
  }
}
