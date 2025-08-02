import {Consumer, ConsumerOpts, ConsumptionHooks, CreateMessage, Message, Producer, Queue, StopReason} from "rivr";
import {Collection, MongoClient, MongoClientOptions, WithId} from "mongodb";
import {setTimeout} from "node:timers/promises"
import {Hooks} from "rivr/dist/hooks/hooks";
import {uuidv7} from "uuidv7";
import {MongoDBWriteOpts} from "./engine";

class InfiniteLoop {
  #stopped = false;

  * [Symbol.iterator]() {
    while (!this.#stopped) {
      yield undefined
    }
  }

  stop() {
    this.#stopped = true
  }
}

async function createQueueCollectionIndexes(collection: Collection<MongoMessage>) {
  await collection.createIndexes([
    {
      name: "find_message_to_handle",
      key: {
        status: 1,
        consideredDeadAfter: -1,
        pickAfter: -1
      }
    },
    {
      name: "update_handled_message",
      key: {
        id: -1,
        version: -1
      }
    }
  ], {
    background: true
  })
}

class PollingConsumer implements Consumer {
  #consumeOpts: ConsumerOpts
  #getCollection: () => Collection<MongoMessage>
  #opts: MongoDBQueueOpts

  #consumptionId = uuidv7()
  #abort = new AbortController()
  #infiniteLoop = new InfiniteLoop()
  #hooks = new Hooks<ConsumptionHooks>()
  #state: "started" | "stopped" = "stopped"
  #indexCreated = false

  constructor(consumeOpts: ConsumerOpts, getCollection: () => Collection<MongoMessage>, opts: MongoDBQueueOpts) {
    this.#consumeOpts = consumeOpts;
    this.#getCollection = getCollection;
    this.#opts = opts;
  }

  async start(): Promise<void> {
    if (this.#state === "started") {
      return
    }
    await this.#ensureIndexes()

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
    this.#hooks.executeHook("onStop", ["manually_stopped"])
    this.#state = "stopped"
  }

  async #startConsuming() {
    for (const _ of this.#infiniteLoop) {
      try {
        const messages = await this.#pullMessages(this.#opts.countPerPoll)

        for (const message of messages) {
          const {_id, status, consideredDeadAfter, pulledAt, pulledBy, version, ...rest} = message
          try {
            await this.#consumeOpts.onMessage(rest)
            await this.#getCollection().findOneAndUpdate({
              id: message.id,
              version
            }, {
              $set: {status: "done", version: version + 1}
            })
          } catch (error: unknown) {
            await this.#getCollection().updateOne({
              id: message.id,
              version
            }, {
              $set: {status: "todo", version: version + 1},
              $unset: {pulledAt: "", pulledBy: "", consideredDeadAfter: ""}
            })
            this.#hooks.executeHook("onError", [error])
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
    } while (limit)

    return messages
  }

  async #wait(ms: number) {
    try {
      await setTimeout(ms, {signal: this.#abort.signal})
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

  async #ensureIndexes() {
    if (this.#indexCreated) {
      return
    }

    this.#indexCreated = true
    await createQueueCollectionIndexes(this.#getCollection())
  }
}

type MongoMessage = Message & {
  status: "todo" | "doing" | "done",
  pulledBy?: string,
  pulledAt?: Date,
  consideredDeadAfter?: Date
  version: number
}

class MongoDBProducer implements Producer<MongoDBWriteOpts> {
  #getCollection: (client?: MongoClient) => Collection<MongoMessage>
  #indexCreated = false

  constructor(getCollection: (client?: MongoClient) => Collection<MongoMessage>) {
    this.#getCollection = getCollection;
  }

  async produce(messages: CreateMessage[], opts: MongoDBWriteOpts = {}): Promise<Message[]> {
    await this.#ensureIndexes()

    const {session} = opts
    const messagesToCreate = messages.map(message => ({
      ...message,
      id: message.id ?? uuidv7(),
    }))

    const rawMessages = messagesToCreate.map(({pickAfter, ...message}) => ({
      ...message,
      status: "todo",
      version: 1,
      // The query executed by `#pullMessages` *REQUIRES* `pickAfter` to be non-existant,
      // but rivr's core sometimes returns an explicit undefined for `pickAfter`, which
      // break the filter.
      // To avoid any issue, `pickAfter` is cleaned manually here.
      ...pickAfter !== undefined && {pickAfter}
    } as MongoMessage))

    await this.#getCollection(opts.client).insertMany(rawMessages, {session})
    return messagesToCreate
  }

  supportsDelayedMessages(): boolean {
    return true
  }

  async disconnect(): Promise<void> {
  }

  async #ensureIndexes() {
    if (this.#indexCreated) {
      return
    }

    this.#indexCreated = true
    await createQueueCollectionIndexes(this.#getCollection())
  }
}

export type MongoDBQueueOpts = {
  url: string
  clientOpts: MongoClientOptions
  dbName: string
  collectionName: string
  countPerPoll: number
  delayBetweenEmptyPolls: number
  deadMessageTimeout: number
}

export class MongoDBQueue implements Queue<MongoDBWriteOpts> {
  readonly #opts: MongoDBQueueOpts
  #mongoClient: MongoClient | undefined

  constructor(
    opts: MongoDBQueueOpts
  ) {
    this.#opts = opts;
  }

  createProducer(): Producer<MongoDBWriteOpts> {
    return new MongoDBProducer(
      this.#getCollection.bind(this)
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

  #getCollection(client?: MongoClient): Collection<MongoMessage> {
    const c = client ?? this.#getClient()

    return c.db(this.#opts.dbName).collection(this.#opts.collectionName);
  }
}

