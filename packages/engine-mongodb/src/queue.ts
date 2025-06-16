import {ConsumeOpts, Consumption, Message, Queue} from "rivr";
import {ClientSession, Collection, Filter, MongoClient, MongoClientOptions} from "mongodb";
import { setTimeout } from "node:timers/promises"

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

class PollingConsumption implements Consumption {
  #consumeOpts: ConsumeOpts
  #getCollection: () => Collection<MongoMessage>
  #opts: MongoDBQueueOpts
  #getFilter: () => Filter<MongoMessage>
  #abort = new AbortController()
  #infiniteLoop = new InfiniteLoop()

  constructor(consumeOpts: ConsumeOpts, getCollection: () => Collection<MongoMessage>, opts: MongoDBQueueOpts, getFilter: () => Filter<MongoMessage>) {
    this.#consumeOpts = consumeOpts;
    this.#getCollection = getCollection;
    this.#opts = opts;
    this.#getFilter = getFilter;
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
        const records = await this.#getCollection()
          .find(this.#getFilter())
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
}

class ChangeStreamConsumption implements Consumption {
  start(): Promise<void> {
      throw new Error("Method not implemented.");
  }
  stop(): Promise<void> {
      throw new Error("Method not implemented.");
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

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true)
  }

  consume(opts: ConsumeOpts): Consumption {
    return new PollingConsumption(
      opts,
      () => this.#getCollection(),
      this.#opts,
      () => ({
        status: "todo",
        $or: [
          {
            pickAfter: { $exists: false }
          },
          {
            pickAfter: { $lte: new Date() }
          }
        ]
      })
    )
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
   * @default {true}
   */
  enableChangeStream?: boolean
}

export function createQueue (opts: CreateMongoDBQueueOpts): Queue<never> {
  const {
    collectionName = "rivr-messages",
    enableChangeStream = true,
    delayBetweenEmptyPolls = 5_000,
    countPerPoll = 100,
    clientOpts = {},
    ...rest
  } = opts

  return new MongoDBQueue({
    ...rest,
    collectionName,
    enableChangeStream,
    delayBetweenEmptyPolls,
    clientOpts,
    countPerPoll
  })
}