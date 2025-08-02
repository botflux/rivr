import { describe, test } from "node:test"
import {createWorker, DefaultWorker} from "./default-worker";
import {Engine} from "../engine";
import {
  AdvancedDeadLetterQueue,
  CreateDeadLetter,
  DeadLetter,
  DeadLetterQueue,
  IdAndVersion,
  kDeadLetterQueue,
  ListDeadLettersOpts,
  ListDeadLettersResult,
  ReintegrateManyResult,
  ReintegrateResult
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

class MemoryDeadLetterQueue implements AdvancedDeadLetterQueue<never> {
  [kDeadLetterQueue]: true = true

  dlqs: DeadLetter[] = []
  #now: () => Date

  constructor(now: () => Date) {
    this.#now = now;
  }

  produce(messages: CreateDeadLetter[], opts?: undefined): Promise<DeadLetter[]> {
    const dlqToProduce = messages.map(letter => ({
      ...letter,
      id: letter.id ?? uuidv7(),
      createdAt: this.#now(),
    } as DeadLetter))

    this.dlqs.push(...dlqToProduce)
    return Promise.resolve(dlqToProduce)
  }

  list(opts: ListDeadLettersOpts = {}): Promise<ListDeadLettersResult> {
    return Promise.resolve({
      results: this.dlqs,
      count: this.dlqs.length,
    })
  }

  reintegrateOne(id: string, version: string, producer: Producer<never>): Promise<void> {
      throw new Error("Not implemented at line 114 in default-worker.spec.ts")
  }

  reintegrateMany(ids: string[]): Promise<ReintegrateManyResult> {
      throw new Error("Not implemented at line 117 in default-worker.spec.ts")
  }

  reintegrateFirsts(count: number): Promise<ReintegrateResult> {
    return Promise.resolve({
      reintegratedCount: 0
    })
  }

  disconnect(): Promise<void> {
    return Promise.resolve(undefined)
  }
}

class MemoryEngine implements Engine<never> {
  #now: () => Date

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  createQueue(): Queue<never> {
    return new MemoryQueue()
  }
  createDeadLetterQueue?(): DeadLetterQueue<never> | AdvancedDeadLetterQueue<never> {
    return new MemoryDeadLetterQueue(this.#now)
  }
  createStorage?: (() => WorkflowStateStorage | SearchableWorkflowStateStorage) | undefined;
}

describe('default worker', function () {
  test("should be able to send the unsupported message to the dead letter queue", async (t) => {
    // Given
    const now = new Date()
    const engine = new MemoryEngine(() => now)

    const dlq = assertAdvancedDeadLetterQueue(engine.createDeadLetterQueue!())

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
      const result = await dlq.list()
      return result.results.length > 0
    })

    const list = await dlq.list()
    const results = list.results.map(dl => omit(dl, ["id"]))

    assert.deepStrictEqual({ count: list.count, results }, {
      count: 1,
      results: [
        {
          createdAt: now,
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

function isAdvancedDql (dlq: DeadLetterQueue<never> | AdvancedDeadLetterQueue<never>): dlq is AdvancedDeadLetterQueue<never> {
  return "list" in dlq
}

function assertAdvancedDeadLetterQueue(dlq: DeadLetterQueue<never> | AdvancedDeadLetterQueue<never>): AdvancedDeadLetterQueue<never> {
  if (!isAdvancedDql(dlq)) {
    throw new Error("Not an advanced dead letter queue")
  }

  return dlq
}