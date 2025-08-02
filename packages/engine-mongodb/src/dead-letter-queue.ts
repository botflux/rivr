import {
  AdvancedDeadLetterQueue,
  CreateDeadLetter,
  DeadLetter,
  kDeadLetterQueue,
  ListDeadLettersOpts,
  ListDeadLettersResult,
  Producer, Queue,
  ReintegrateManyResult
} from "rivr";
import {Collection, Filter, MongoClient, MongoClientOptions} from "mongodb";
import {uuidv7} from "uuidv7";
import {MongoDBWriteOpts} from "./engine";

export type MongoDBDeadLetterQueueOpts = {
  url: string
  clientOpts: MongoClientOptions
  dbName: string
  collectionName: string
  normalQueue: Queue<MongoDBWriteOpts>
}

type MongoDeadLetter = DeadLetter & {
  acquiredBy: string
  consideredDeadAfter: Date
  status: "idle" | "acquired"
}

export class MongoDBDeadLetterQueue implements AdvancedDeadLetterQueue<never> {
  [kDeadLetterQueue]: true = true;
  #mongoClient: MongoClient | undefined;
  #producer: Producer<MongoDBWriteOpts> | undefined;
  #opts: MongoDBDeadLetterQueueOpts

  constructor(opts: MongoDBDeadLetterQueueOpts) {
    this.#opts = opts;
  }

  async list(opts: ListDeadLettersOpts = {}): Promise<ListDeadLettersResult> {
    const {
      pageSize = 25,
      page: pageStr = "1",
      reasons,
      messageTypes
    } = opts

    const page = parseInt(pageStr)
    const offset = (page - 1) * pageSize

    const filters = {
      ...reasons !== undefined && {
        reason: { $in: reasons }
      },
      ...messageTypes !== undefined && {
        "messsage.type": { $in: messageTypes }
      }
    } satisfies Filter<MongoDeadLetter>

    const [ documents, count ] = await Promise.all([
      this.#getCollection().find(filters).sort({ createdAt: -1 }).skip(offset).limit(pageSize).toArray(),
      this.#getCollection().countDocuments(filters)
    ])

    return {
      count,
      results: documents.map(({ _id, status, ...rest }) => rest)
    }
  }

  async reintegrateMany(ids: string[]): Promise<ReintegrateManyResult> {
    const client = this.#getClient()
    const collection = this.#getCollection()

    const resultAndIds = await Promise.all(ids.map(async id => {
      const mDeadLetter = await collection.findOneAndUpdate({
        id,
        $or: [
          {
            status: "idle"
          },
          {
            status: "acquired",
            consideredDeadAfter: { $lte: new Date() }
          }
        ]
      }, {
        $set: {
          status: "acquired",
          consideredDeadAfter: new Date(new Date().getTime() + 10_000),
        }
      })

      if (mDeadLetter === null) {
        return [ "missingIds", id ] as const
      }

      await client.withSession(async session => {
        await this.#getProducer().produce([
          mDeadLetter.message
        ], { session, client })

        await collection.deleteOne({ id }, { session })
      })

      return [ "reintegratedIds", id ] as const
    }))

    return resultAndIds.reduce(
      (acc, [key, id]) => ({
        ...acc,
        [key]: [...acc[key], id]
      }), {
        missingIds: [],
        reintegratedIds: []
      })
  }

  async produce(messages: CreateDeadLetter[]): Promise<DeadLetter[]> {
    const messagesToCreate = messages.map(message => ({
      ...message,
      id: message.id ?? uuidv7(),
      createdAt: new Date(),
    } as DeadLetter))

    // Copy dead letters otherwise MongoDB adds a _id field.
    const mongoDbMessages = messagesToCreate.map(m => ({
      ...m,
      status: "idle",
    } as MongoDeadLetter))

    await this.#getCollection().insertMany(mongoDbMessages)

    return messagesToCreate
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true);
    await this.#producer?.disconnect();
    await this.#opts.normalQueue.disconnect();
  }

  #getProducer(): Producer<MongoDBWriteOpts> {
    if (this.#producer === undefined) {
      this.#producer = this.#opts.normalQueue.createProducer()
    }

    return this.#producer
  }

  #getClient(): MongoClient {
    if (this.#mongoClient === undefined) {
      this.#mongoClient = new MongoClient(this.#opts.url, this.#opts.clientOpts)
    }

    return this.#mongoClient
  }

  #getCollection(): Collection<MongoDeadLetter> {
    return this.#getClient().db(this.#opts.dbName).collection(this.#opts.collectionName);
  }
}
