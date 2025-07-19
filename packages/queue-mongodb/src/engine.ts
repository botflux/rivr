import {ClientSession, MongoClientOptions} from "mongodb";
import {Engine, Queue} from "rivr";
import {MongoDBQueue} from "./queue";
import {createStorage, MongoDBWorkflowStateStorage} from "./storage";

export type MongoDBEngineOpts = Required<Omit<CreateEngineOpts, "storage" | "queue">> & {
  storage: Required<CreateStorageOpts>
  queue: Required<CreateQueueOpts>
}
export type MongoDBWriteOpts = {
  session?: ClientSession
}

class MongoDBEngine implements Engine<MongoDBWriteOpts> {
  #opts: MongoDBEngineOpts

  constructor(opts: MongoDBEngineOpts) {
    this.#opts = opts;
  }

  createQueue(): Queue<MongoDBWriteOpts> {
    return new MongoDBQueue(this.#opts)
  }

  createStorage() {
    return new MongoDBWorkflowStateStorage(
      this.#opts.url,
      this.#opts.clientOpts,
      this.#opts.dbName,
      this.#opts.storage.collectionName
    )
  }
}

export type CreateQueueOpts = {

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
export type CreateStorageOpts = {
  /**
   * @default {"rivr-workflow-states"}
   */
  collectionName?: string
}
export type CreateEngineOpts = {
  url: string
  clientOpts?: MongoClientOptions
  dbName: string

  queue?: CreateQueueOpts
  storage?: CreateStorageOpts
}

export function createEngine(opts: CreateEngineOpts): Engine<MongoDBWriteOpts> {
  const {
    clientOpts = {},
    queue: {
      collectionName: queueCollectionName = "rivr-messages",
      delayBetweenEmptyPolls = 5_000,
      countPerPoll = 10,
      deadMessageTimeout = 600_000
    } = {},
    storage: {
      collectionName: storageCollectionName = "rivr-workflow-states",
    } = {},
    ...rest
  } = opts

  return new MongoDBEngine({
    ...rest,
    clientOpts,
    queue: {collectionName: queueCollectionName, delayBetweenEmptyPolls, countPerPoll, deadMessageTimeout},
    storage: {collectionName: storageCollectionName}
  })
}