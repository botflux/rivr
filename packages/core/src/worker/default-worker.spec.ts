import { describe, test } from "node:test"
import {createWorker, DefaultWorker} from "./default-worker";
import {Engine} from "../engine";
import {
  CreateDeadLetter,
  DeadLetter,
  DeadLetterQueue,
  kDeadLetterQueue,
  ListDeadLettersResult
} from "../dead-letter-queue";
import {Consumer, ConsumerOpts, ConsumptionHooks, CreateMessage, Message, Producer, Queue, StopReason} from "../queue";
import {WorkflowStateStorage, SearchableWorkflowStateStorage} from "../workflow/state/storage";
import EventEmitter from "node:events";
import {uuidv7} from "uuidv7";
import {Hooks} from "../hooks/hooks";
import {setTimeout} from "node:timers/promises";
import * as assert from "node:assert";
import {omit} from "../utils/omit";

class MemoryProducer implements Producer<never> {
  #emitter = new EventEmitter()

  constructor(emitter: EventEmitter) {
    this.#emitter = emitter
  }

  produce(messages: CreateMessage[], opts?: undefined): Promise<Message[]> {
    const messagesToProduce = messages.map(message => ({
      ...message,
      id: uuidv7()
    }))

    this.#emitter.emit("message", messagesToProduce)

    return Promise.resolve(messagesToProduce)
  }

  supportsDelayedMessages(): boolean {
    return true
  }

  disconnect(): Promise<void> {
    return Promise.resolve()
  }
}

class MemoryConsumer implements Consumer {
  #hooks = new Hooks<ConsumptionHooks>()
  #consumeOpts: ConsumerOpts
  #emitter: EventEmitter

  constructor(consumeOpts: ConsumerOpts, emitter: EventEmitter) {
    this.#consumeOpts = consumeOpts;
    this.#emitter = emitter
  }

  start(): Promise<void> {
    this.#emitter.on("message", this.#onMessage)
    return Promise.resolve(undefined)
  }

  stop(): Promise<void> {
    this.#emitter.off("message", this.#onMessage)
    return Promise.resolve(undefined)
  }

  addHook(hook: "onStart", handler: () => void): this;
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this;
  addHook(hook: "onError", handler: (error: unknown) => void): this;
  addHook(hook: string, handler: unknown): this {
    this.#hooks.addHook(hook as keyof ConsumptionHooks, handler as ConsumptionHooks[keyof ConsumptionHooks])
    return this
  }

  #onMessage = (messages: Message[]) => {
    for (const message of messages) {
      this.#consumeOpts.onMessage(message)
        .then(() => {
        })
        .catch(error => {
          this.#hooks.executeHook("onError", [error])
        })
    }
  }
}

class MemoryQueue implements Queue<never> {
  #emitter = new EventEmitter()

  createConsumer(opts: ConsumerOpts): Consumer {
    return new MemoryConsumer(opts, this.#emitter)
  }

  createProducer(): Producer<never> {
    return new MemoryProducer(this.#emitter)
  }

  disconnect(): Promise<void> {
    return Promise.resolve(undefined);
  }

}

class MemoryDeadLetterQueue implements DeadLetterQueue<never> {
  [kDeadLetterQueue]: true = true

  dlqs: DeadLetter[] = []

  produce(messages: CreateDeadLetter[], opts?: undefined): Promise<DeadLetter[]> {
    const dlqToProduce = messages.map(letter => ({ ...letter, id: letter.id ?? uuidv7() } as DeadLetter))

    this.dlqs.push(...dlqToProduce)
    return Promise.resolve(dlqToProduce)
  }

  list(count: number): Promise<ListDeadLettersResult> {
    return Promise.resolve({
      results: this.dlqs.slice(0, count),
      count: this.dlqs.length,
    })
  }

  disconnect(): Promise<void> {
    return Promise.resolve(undefined)
  }
}

class MemoryEngine implements Engine<never> {
  createQueue(): Queue<never> {
    return new MemoryQueue()
  }
  createDeadLetterQueue?(): DeadLetterQueue<never> {
    return new MemoryDeadLetterQueue()
  }
  createStorage?: (() => WorkflowStateStorage | SearchableWorkflowStateStorage) | undefined;
}

describe('default worker', function () {
  test("should be able to send the unsupported message to the dead letter queue", async (t) => {
    // Given
    const engine = new MemoryEngine()

    const dlq = engine.createDeadLetterQueue!()

    t.after(async () => {
      await dlq.disconnect()
    })

    const queue = engine.createQueue()

    const worker = createWorker({
      primary: queue,
      workflows: [],
      deadLetterQueue: dlq
    })

    t.after(async () => {
      await worker.stop()
    })

    await worker.start()

    const producer = queue.createProducer()

    t.after(async () => {
      await producer.disconnect()
    })

    // When
    const [message] = await producer.produce([
      {
        createdAt: new Date(),
        type: "unknown_message",
        payload: { msg: "hello world" },
      }
    ])

    // Then
    await waitForPredicate(async () => {
      const result = await dlq.list(10)
      return result.results.length > 0
    })

    const list = await dlq.list(10)
    const results = list.results.map(dl => omit(dl, ["id"]))

    assert.deepStrictEqual({ count: list.count, results }, {
      count: 1,
      results: [
        {
          message,
          reason: "unsupported_message_type",
        }
      ]
    })
  })
})

async function waitForPredicate(fn: () => Promise<boolean> | boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!await fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}