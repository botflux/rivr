import {
  CreateDeadLetter,
  CreateMessage, DeadLetter,
  DeadLetterQueue,
  kDeadLetterQueue, ListDeadLettersResult,
  Message,
  Producer
} from "rivr";
import {Collection, MongoClient, MongoClientOptions} from "mongodb";
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

export class MongoDBDeadLetterQueue implements DeadLetterQueue<never> {
  [kDeadLetterQueue]: true = true;
  #mongoClient: MongoClient | undefined;
  #opts: MongoDBDeadLetterQueueOpts

  constructor(opts: MongoDBDeadLetterQueueOpts) {
    this.#opts = opts;
  }

  async produce(messages: CreateDeadLetter[], opts?: undefined): Promise<DeadLetter[]> {
    const messagesToCreate = messages.map(message => ({
      ...message,
      id: message.id ?? uuidv7(),
    }))

    const rawMessages = messagesToCreate.map(({pickAfter, ...message}) => ({
      ...message,
      status: "todo",
      version: 1,
      ...pickAfter !== undefined && {pickAfter}
    } as MongoDeadLetter))

    await this.#getCollection().insertMany(rawMessages)

    return messagesToCreate
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true);
  }

  async list(limit: number): Promise<ListDeadLettersResult> {
    const [ documents, count ] = await Promise.all([
      this.#getCollection().find().limit(limit).toArray(),
      this.#getCollection().countDocuments()
    ])

    return {
      count,
      results: documents.map(({ _id, status, version, ...rest }) => rest)
    }
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
