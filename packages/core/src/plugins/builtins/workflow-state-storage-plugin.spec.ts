import {describe, test, TestContext} from "node:test";
import {ConsumeOpts, Consumption, Message, Queue} from "../../queue";
import {EventEmitter, on} from "node:events"
import {ListWorkflowStateOpts, ListWorkflowStateResult, WorkflowStateStorage} from "../../workflow/state/storage";
import {WorkflowState} from "../../workflow/state/state";
import {rivr} from "../../workflow/workflow";
import {workflowStateStoragePlugin} from "./workflow-state-storage-plugin";
import {createWorker} from "../../worker";
import {trigger} from "../../workflow/trigger";
import {setTimeout} from "node:timers/promises";
import {omit} from "../../utils/omit";

class MemoryConsumption implements Consumption {
  readonly #emitter: EventEmitter
  readonly #consumeOpts: ConsumeOpts
  readonly #controller = new AbortController()

  constructor(emitter: EventEmitter, consumeOpts: ConsumeOpts) {
    this.#emitter = emitter;
    this.#consumeOpts = consumeOpts;
  }

  async start(): Promise<void> {
    this.#startConsuming()
  }

  async stop(): Promise<void> {
    this.#controller.abort()
  }

  async #startConsuming() {
    try {
      for await (const events of on(this.#emitter, "message", {signal: this.#controller.signal})) {
        for (const event of events) {
          await this.#consumeOpts.onMessage(event)
        }
      }
    } catch (e) {
      if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string" && e.message.includes("abort")) {
        return
      }

      throw e
    }
  }
}

class MemoryQueue implements Queue<never> {
  readonly #emitter = new EventEmitter()

  async produce(messages: Message[], opts?: undefined): Promise<void> {
    for (const message of messages) {
      this.#emitter.emit("message", message)
    }
  }

  supportsDelayedMessages(): boolean {
    return false
  }

  async disconnect(): Promise<void> {
  }

  consume(opts: ConsumeOpts): Consumption {
    return new MemoryConsumption(this.#emitter, opts)
  }
}

class MemoryStorage implements WorkflowStateStorage {
  readonly #states = new Map<string, WorkflowState<unknown>>()

    async upsert<State>(states: WorkflowState<State>[]): Promise<void> {
      for (const state of states) {
        this.#states.set(state.id, state)
      }
    }
    async get<State>(id: string): Promise<WorkflowState<State> | undefined> {
      return this.#states.get(id) as WorkflowState<State> | undefined
    }
    list<State>(opts?: ListWorkflowStateOpts): Promise<ListWorkflowStateResult<State>> {
      throw new Error("Method not implemented.");
    }
}

describe('workflow state storage plugin', function () {
  test("should be able to ", async (t: TestContext) => {
    // Given
    const storage = new MemoryStorage()

    const workflow = rivr.workflow<number>("my-workflow")
      .register(workflowStateStoragePlugin, { storage })
      .step({
        name: "add-1",
        handler: ctx => ctx.state + 1
      })

    const queue = new MemoryQueue()
    const worker = createWorker({ primary: queue, workflows: [ workflow ] })

    t.after(async () => {
      await worker.stop()
      await queue.disconnect()
    })

    await worker.start()

    // When
    const { id } = await trigger(
      queue,
      workflow,
      4,
    )

    // Then
    await waitForPredicate(async () => await storage.get(id) !== undefined)
    t.assert.deepStrictEqual(omit((await storage.get(id))!, [ "lastModified" ]), {
      id,
      name: "my-workflow",
      result: 5,
      status: 'successful',
      steps: [
        {
          attempts: [
            {
              id: 1,
              status: "successful",
            },
          ],
          name: 'add-1'
        }
      ],
      toExecute: {
        areRetryExhausted: false,
        attempt: 1,
        state: 5,
        status: 'done',
        step: 'add-1'
      }
    })
  })
})

async function waitForPredicate(fn: () => boolean | Promise<boolean>, ms = 5_000) {
  let now = new Date().getTime()
  while (!await fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}

