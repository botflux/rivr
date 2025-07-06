import {Consumer, ConsumerOpts, ConsumptionHooks, Message, Producer, Queue, StopReason} from "rivr";
import {ClientSession, Collection, Filter, MongoClient, MongoClientOptions, WithId} from "mongodb";
import {setTimeout} from "node:timers/promises"
import {Hooks} from "rivr/dist/hooks/hooks";
import {randomUUID} from "node:crypto";

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

class PollingConsumer implements Consumer {
  #consumeOpts: ConsumerOpts
  #getCollection: () => Collection<MongoMessage>
  #opts: MongoDBQueueOpts

  #consumptionId = randomUUID()
  #abort = new AbortController()
  #infiniteLoop = new InfiniteLoop()
  #hooks = new Hooks<ConsumptionHooks>()
  #state: "started" | "stopped" = "stopped"

  constructor(consumeOpts: ConsumerOpts, getCollection: () => Collection<MongoMessage>, opts: MongoDBQueueOpts) {
    this.#consumeOpts = consumeOpts;
    this.#getCollection = getCollection;
    this.#opts = opts;
  }

  async start(): Promise<void> {
    if (this.#state === "started") {
      return
    }

    this.#startConsuming()
    this.#hooks.executeHook("onStart", [])
    this.#state = "started";
  }

  async stop(): Promise<void> {
    if (this.#state === "stopped") {
      return
    }

    this.#infiniteLoop.stop()
    this.#abort.abort()
    this.#hooks.executeHook("onStop", [ "manually_stopped" ])
    this.#state = "stopped"
  }

  async #startConsuming() {
    for (const _ of this.#infiniteLoop) {
      try {
        const messages = await this.#pullMessages(this.#opts.countPerPoll)

        for (const message of messages) {
          const { _id, status, consideredDeadAfter, pulledAt, pulledBy, version, ...rest } = message
          try {
            await this.#consumeOpts.onMessage(rest)
            await this.#getCollection().findOneAndUpdate({
              id: message.id,
              version
            }, {
              $set: { status: "done", version: version + 1 }
            })
          } catch (error: unknown) {
            await this.#getCollection().updateOne({
              id: message.id,
              version
            }, {
              $set: { status: "todo", version: version + 1 },
              $unset: { pulledAt: "", pulledBy: "", consideredDeadAfter: "" }
            })
            this.#hooks.executeHook("onError", [ error ])
          }
        }

        if (messages.length < this.#opts.countPerPoll) {
          await this.#wait(this.#opts.delayBetweenEmptyPolls)
        }
      } catch (error: unknown) {
        this.#hooks.executeHook("onError", [error])
      }
    }
  }

  async #pullMessages(limit: number) {
    const messages: WithId<MongoMessage>[] = []

    do {
      const mMessage = await this.#getCollection().findOneAndUpdate({
        $and: [
          {
            status: {$in: ["doing", "todo"]},
          },
          {
            $or: [
              {
                consideredDeadAfter: {$exists: false},
              },
              {
                consideredDeadAfter: {$lte: new Date()}
              }
            ]
          },
          {
            $or: [
              {
                pickAfter: {$exists: false},
              },
              {
                pickAfter: {$lte: new Date()}
              }
            ]
          }
        ],
      }, {
        $set: {
          pulledBy: this.#consumptionId,
          pulledAt: new Date(),
          consideredDeadAfter: new Date(new Date().getTime() + this.#opts.deadMessageTimeout),
          status: "doing"
        }
      })

      if (mMessage === null) {
        return messages
      }

      messages.push(mMessage)
    } while(limit)

    return messages
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

type MongoMessage = Message & {
  status: "todo" | "doing" | "done",
  pulledBy?: string,
  pulledAt?: Date,
  consideredDeadAfter?: Date
  version: number
}

class MongoDBProducer implements Producer<MongoDBWriteOpts> {
  #collection: Collection<MongoMessage>

  constructor(collection: Collection<MongoMessage>) {
    this.#collection = collection;
  }

  async produce(messages: Message[], opts: MongoDBWriteOpts = {}): Promise<void> {
    const { session } = opts

    await this.#collection.insertMany(messages.map(message => ({ ...message, status: "todo", version: 1 })), { session })
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

  createProducer(): Producer<MongoDBWriteOpts> {
    return new MongoDBProducer(
      this.#getCollection()
    )
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true)
  }

  createConsumer(opts: ConsumerOpts): Consumer {
    return new PollingConsumer(
      opts,
      () => this.#getCollection(),
      this.#opts,
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
   * This timeout is relevant when you have competing consumers.
   * This is the time after which a consumer considers a message
   * handled by another consumer as timed-out.
   *
   * In other word, this is the time after which the message is re-routed
   * to another consumer if the consumer has failed.
   *
   * @default {600_000} 10 minutes
   */
  deadMessageTimeout?: number
}

export function createQueue (opts: CreateMongoDBQueueOpts): Queue<never> {
  const {
    collectionName = "rivr-messages",
    delayBetweenEmptyPolls = 5_000,
    countPerPoll = 100,
    clientOpts = {},
    deadMessageTimeout = 600_000,
    ...rest
  } = opts

  return new MongoDBQueue({
    ...rest,
    collectionName,
    delayBetweenEmptyPolls,
    clientOpts,
    countPerPoll,
    deadMessageTimeout
  })
}