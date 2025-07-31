import {
  CreateDeadLetter,
  CreateMessage, DeadLetter,
  DeadLetterQueue,
  kDeadLetterQueue, ReintegrateResult,
  Message,
  Producer, AdvancedDeadLetterQueue,
  IdAndVersion,
  ListDeadLettersOpts,
  ListDeadLettersResult,
  ReintegrateManyResult
} from "rivr";
import {Collection, Filter, MongoClient, MongoClientOptions} from "mongodb";
import {uuidv7} from "uuidv7";

export type MongoDBDeadLetterQueueOpts = {
  url: string
  clientOpts: MongoClientOptions
  dbName: string
  collectionName: string
}

type MongoDeadLetter = DeadLetter & {
  status: "todo" | "doing" | "done",
  version: number
}

export class MongoDBDeadLetterQueue implements AdvancedDeadLetterQueue<never> {
  [kDeadLetterQueue]: true = true;
  #mongoClient: MongoClient | undefined;
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
      results: documents.map(({ _id, status, version, ...rest }) => rest)
    }
  }

  reintegrateOne(id: string, version: string, producer: Producer<never>): Promise<void> {
      throw new Error("Method not implemented.");
  }
  reintegrateMany(ids: IdAndVersion[], producer: Producer<never>): Promise<ReintegrateManyResult> {
      throw new Error("Method not implemented.");
  }
  reintegrateFirsts(count: number | "all", producer: Producer<never>): Promise<ReintegrateResult> {
      throw new Error("Method not implemented.");
  }

  async produce(messages: CreateDeadLetter[], opts?: undefined): Promise<DeadLetter[]> {
    const messagesToCreate = messages.map(message => ({
      ...message,
      id: message.id ?? uuidv7(),
      createdAt: new Date()
    } as DeadLetter))

    const rawMessages = messagesToCreate.map(message => ({
      ...message,
      status: "todo",
      version: 1,
    } as MongoDeadLetter))

    await this.#getCollection().insertMany(rawMessages)

    return messagesToCreate
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true);
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
