import {Consumer, ConsumerOpts, ConsumptionHooks, Message, Producer, Queue, StopReason} from "rivr";
import {
  ChangeStream,
  ChangeStreamDocument,
  ClientSession,
  Collection,
  Filter,
  MongoClient,
  MongoClientOptions
} from "mongodb";
import {setTimeout} from "node:timers/promises"
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

class PollingConsumption implements Consumer {
  #consumeOpts: ConsumerOpts
  #getCollection: () => Collection<MongoMessage>
  #opts: MongoDBQueueOpts

  #abort = new AbortController()
  #infiniteLoop = new InfiniteLoop()
  #hooks = new Hooks<ConsumptionHooks>()

  constructor(consumeOpts: ConsumerOpts, getCollection: () => Collection<MongoMessage>, opts: MongoDBQueueOpts) {
    this.#consumeOpts = consumeOpts;
    this.#getCollection = getCollection;
    this.#opts = opts;
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

type MongoDBQueueOpts = Required<CreateMongoDBQueueOpts>

export type MongoDBWriteOpts = {
  session?: ClientSession
}

type MongoMessage = Message & { status: "todo" | "done" }

class MongoDBProducer implements Producer<MongoDBWriteOpts> {
  #collection: Collection<MongoMessage>

  constructor(collection: Collection<MongoMessage>) {
    this.#collection = collection;
  }

  async produce(messages: Message[], opts: MongoDBWriteOpts = {}): Promise<void> {
    const { session } = opts

    await this.#collection.insertMany(messages.map(message => ({ ...message, status: "todo" })), { session })
  }

  supportsDelayedMessages(): boolean {
      return true
  }

  async disconnect(): Promise<void> {}
}

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

  createProducer(): Producer<MongoDBWriteOpts> {
    return new MongoDBProducer(
      this.#getCollection()
    )
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true)
  }

  createConsumers(opts: ConsumerOpts): Consumer[] {
    const polling = new PollingConsumption(
      opts,
      () => this.#getCollection(),
      this.#opts,
    )

    return [ polling ]
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