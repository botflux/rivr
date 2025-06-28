import {ConsumeOpts, Consumption, ConsumptionHooks, Message, Queue, StopReason} from "rivr";
import {
  ChangeStream,
  ChangeStreamDocument,
  ClientSession,
  Collection,
  Filter,
  MongoClient,
  MongoClientOptions
} from "mongodb";
import { setTimeout } from "node:timers/promises"
import {Hooks} from "rivr/dist/hooks/hooks";

class InfiniteLoop {
  #stopped = false;

  *[Symbol.iterator] () {
    while (!this.#stopped) {
      yield undefined
    }
  }

  stop() {
    this.#stopped = true
  }
}

class CompoundConsumption implements Consumption {
  #consumptions: Consumption[]

  constructor(consumptions: Consumption[]) {
    this.#consumptions = consumptions;
  }

  async start(): Promise<void> {
    await Promise.all(this.#consumptions.map(c => c.start()))
  }

  async stop(): Promise<void> {
    await Promise.all(this.#consumptions.map(c => c.stop()))
  }

  addHook(hook: "onError", handler: (error: unknown) => void): this
  addHook(hook: "onStart", handler: () => void): this
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this
  addHook(hook: string, handler: (...params: any[]) => void): this {
    return this
  }
}

class PollingConsumption implements Consumption {
  #consumeOpts: ConsumeOpts
  #getCollection: () => Collection<MongoMessage>
  #opts: MongoDBQueueOpts
  #onlyModifiedBefore?: () => Date

  #abort = new AbortController()
  #infiniteLoop = new InfiniteLoop()
  #hooks = new Hooks<ConsumptionHooks>()

  constructor(consumeOpts: ConsumeOpts, getCollection: () => Collection<MongoMessage>, opts: MongoDBQueueOpts, onlyModifiedBefore?: () => Date) {
    this.#consumeOpts = consumeOpts;
    this.#getCollection = getCollection;
    this.#opts = opts;
    this.#onlyModifiedBefore = onlyModifiedBefore;
  }

  async start(): Promise<void> {
    this.#startConsuming()
  }

  async stop(): Promise<void> {
    this.#infiniteLoop.stop()
    this.#abort.abort()
  }

  async #startConsuming() {
    try {
      for (const _ of this.#infiniteLoop) {
        const filter: Filter<MongoMessage> = {
          status: "todo",
          $or: [
            {
              pickAfter: { $exists: false },
              ...this.#onlyModifiedBefore !== undefined && {
                createdAt: { $lt: this.#onlyModifiedBefore() }
              }
            },
            {
              pickAfter: { $lte: new Date() }
            }
          ],
        }

        const records = await this.#getCollection()
          .find(filter)
          .limit(this.#opts.countPerPoll)
          .toArray()

        const messages = records.map(({ _id, pickAfter, status, ...message }) => message)

        for (const message of messages) {
          try {
            await this.#consumeOpts.onMessage(message)
            await this.#getCollection().updateOne({ id: message.id }, { $set: { status: "done" } })
          } catch (error: unknown) {
            console.error("error while executing the onMessage callback", error)
          }
        }

        if (messages.length < this.#opts.countPerPoll) {
          await this.#wait(this.#opts.delayBetweenEmptyPolls)
        }
      }
    } catch (error: unknown) {
      console.warn("error while consuming mongodb", error)
    }
  }

  async #wait(ms: number) {
    try {
      await setTimeout(ms, { signal: this.#abort.signal })
    } catch (error: unknown) {
      // TODO check if abort error
      throw error
    }
  }

  addHook(hook: "onError", handler: (error: unknown) => void): this
  addHook(hook: "onStart", handler: () => void): this
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this
  addHook(hook: string, handler: (...params: any[]) => void): this {
    this.#hooks.addHook(hook as keyof ConsumptionHooks, handler)
    return this
  }
}

class ChangeStreamConsumption implements Consumption {
  #consumeOpts: ConsumeOpts
  #getCollection: () => Collection<MongoMessage>
  #changeStream: ChangeStream<MongoMessage, ChangeStreamDocument<MongoMessage>> | undefined
  #hooks = new Hooks<ConsumptionHooks>()

  constructor(consumeOpts: ConsumeOpts, getCollection: () => Collection<MongoMessage>) {
    this.#consumeOpts = consumeOpts;
    this.#getCollection = getCollection;
  }

  async start(): Promise<void> {
    this.#startConsuming()
  }

  async stop(): Promise<void> {
    await this.#changeStream?.close()
  }

  addHook(hook: "onError", handler: (error: unknown) => void): this
  addHook(hook: "onStart", handler: () => void): this
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this
  addHook(hook: string, handler: (...params: any[]) => void): this {
    this.#hooks.addHook(hook as keyof ConsumptionHooks, handler)
    return this
  }

  async #startConsuming() {
    const filter: Filter<ChangeStreamDocument<MongoMessage>> = {
      "fullDocument.status": "todo",
      "fullDocument.pickAfter": { $exists: false }
    }

    this.#changeStream = this.#getCollection().watch([ { $match: filter } ])

    try {
      for await (const change of this.#changeStream) {
        if (change.operationType === "insert") {
          const { status, ...rest } = change.fullDocument

          try {
            await this.#consumeOpts.onMessage(rest)
            await this.#getCollection().updateOne({ id: rest.id }, { $set: { status: "done" } })
          } catch (error: unknown) {
            console.log("error while handling a message with mongodb change stream", error)
          }
        }
      }
    } catch (error: unknown) {
      if (!this.#isChangeStreamClosedError(error)) {
        throw error
      }
    }
  }

  #isChangeStreamClosedError(error: unknown) {
    return typeof error === "object" && error !== null
      && "message" in error && error.message === "ChangeStream is closed"
  }
}

type MongoDBQueueOpts = Required<CreateMongoDBQueueOpts>

export type MongoDBWriteOpts = {
  session?: ClientSession
}

type MongoMessage = Message & { status: "todo" | "done" }

class MongoDBQueue implements Queue<MongoDBWriteOpts> {
  readonly #opts: MongoDBQueueOpts
  #mongoClient: MongoClient | undefined

  constructor(opts: MongoDBQueueOpts) {
    this.#opts = opts;
  }

  async produce(messages: Message[], opts: MongoDBWriteOpts = {}): Promise<void> {
    const { session } = opts

    await this.#getCollection().insertMany(messages.map(message => ({ ...message, status: "todo" })), { session })
  }

  supportsDelayedMessages(): boolean {
    return true
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true)
  }

  consume(opts: ConsumeOpts): Consumption {
    let latestChangeStreamMessageCreationDate = new Date()

    const polling = new PollingConsumption(
      opts,
      () => this.#getCollection(),
      this.#opts,
      this.#opts.enableChangeStream ? () => latestChangeStreamMessageCreationDate : undefined
    )

    const changeStream = new ChangeStreamConsumption(
      {
        onMessage: async msg => {
          latestChangeStreamMessageCreationDate = msg.createdAt
          await opts.onMessage(msg)
        }
      },
      () => this.#getCollection()
    )

    return this.#opts.enableChangeStream
      ? new CompoundConsumption([
        polling,
        changeStream
      ])
      : polling
  }

  #getClient(): MongoClient {
    if (this.#mongoClient === undefined) {
      this.#mongoClient = new MongoClient(this.#opts.url, this.#opts.clientOpts)
    }

    return this.#mongoClient
  }

  #getCollection(): Collection<MongoMessage> {
    return this.#getClient().db(this.#opts.dbName).collection(this.#opts.collectionName);
  }
}

export type CreateMongoDBQueueOpts = {
  url: string
  clientOpts?: MongoClientOptions
  dbName: string
  /**
   * @default {"rivr-messages"}
   */
  collectionName?: string

  /**
   * @default {5_000}
   */
  delayBetweenEmptyPolls?: number

  /**
   * @default {100}
   */
  countPerPoll?: number

  /**
   * Enable a change stream consumption.
   *
   * Note that this option does not disable the poller.
   * The change stream will pick most of the messages, but
   * not the failed messages nor the delayed messages.
   *
   * The poller is consuming messages older that the `latestChangeStreamMessageCreationDate - pollOffsetMs`
   * when the change stream is enabled to not handle the message twice.
   *
   * Note that the offset is not applied when the change stream is disabled.
   * In this configuration, the poller polls all the messages.
   *
   * @default {true}
   */
  enableChangeStream?: boolean

  /**
   * Filter the message created before `latestChangeStreamMessageCreationDate - pollOffsetMs`.
   * This option is used when `enableChangeStream` is `true`.
   *
   * When `enableChangeStream` is `false`, the poller will
   * ignore this option, and it will pull all the messages.
   *
   * @default {300_000}
   */
  pollOffsetMs?: number
}

export function createQueue (opts: CreateMongoDBQueueOpts): Queue<never> {
  const {
    collectionName = "rivr-messages",
    enableChangeStream = true,
    delayBetweenEmptyPolls = 5_000,
    countPerPoll = 100,
    clientOpts = {},
    pollOffsetMs = 300_000,
    ...rest
  } = opts

  return new MongoDBQueue({
    ...rest,
    collectionName,
    enableChangeStream,
    delayBetweenEmptyPolls,
    clientOpts,
    countPerPoll,
    pollOffsetMs
  })
}