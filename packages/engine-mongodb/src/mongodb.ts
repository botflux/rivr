import {
  ListWorkflowStateOpts,
  ListWorkflowStateResult,
  SearchableWorkflowStateStorage,
  SearchWorkflowStateOpts,
  WorkflowState
} from "rivr";
import {AnyBulkWriteOperation, Collection, MongoClient, MongoClientOptions} from "mongodb";

class MongoDBWorkflowStateStorage implements SearchableWorkflowStateStorage {
  readonly #url: string
  readonly #clientOpts: MongoClientOptions
  readonly #dbName: string
  readonly #collectionName: string

  #mongoClient: MongoClient | undefined

  constructor(url: string, clientOpts: MongoClientOptions, dbName: string, collectionName: string) {
    this.#url = url;
    this.#clientOpts = clientOpts;
    this.#dbName = dbName;
    this.#collectionName = collectionName;
  }

  async search<State>(opts: SearchWorkflowStateOpts = {}): Promise<ListWorkflowStateResult<State>> {
    const { page = 1, limit = 25 } = opts
    const skip = (page - 1) * limit

    const [records, count] = await Promise.all([
      this.#getCollection().find().skip(skip).limit(limit).toArray(),
      this.#getCollection().countDocuments()
    ])

    const states = records.map(({ _id, ...state }) => state as WorkflowState<State>)

    const hasPreviousPage = page !== 1
    const hasNextPage = states.length === limit

    return {
      ...hasNextPage && {
        nextPage: page + 1
      },
      ...hasPreviousPage && {
        previousPage: page - 1
      },
      results: states,
      totalCount: count
    }
  }

  async upsert<State>(states: WorkflowState<State>[]): Promise<void> {
    const writes: AnyBulkWriteOperation<WorkflowState<unknown>>[] = states.map(state => ({
      replaceOne: {
        upsert: true,
        filter: { id: state.id },
        replacement: state,
      }
    }))

    await this.#getCollection().bulkWrite(writes)
  }

  async get<State>(id: string): Promise<WorkflowState<State> | undefined> {
    const mRecord = await this.#getCollection().findOne({ id })

    if (mRecord === null) {
      return undefined
    }

    const { _id, ...state } = mRecord
    return state as WorkflowState<State>
  }

  async list<State>(opts?: ListWorkflowStateOpts): Promise<ListWorkflowStateResult<State>> {
    return await this.search(opts)
  }

  #getClient(): MongoClient {
    if (this.#mongoClient === undefined) {
      this.#mongoClient = new MongoClient(this.#url, this.#clientOpts)
    }

    return this.#mongoClient
  }

  #getCollection(): Collection<WorkflowState<unknown>> {
    return this.#getClient().db(this.#dbName).collection(this.#collectionName)
  }
}

export type CreateStorageOpts = {
  url: string
  clientOpts?: MongoClientOptions
  dbName: string
  /**
   * @default {"rivr-workflow-states"}
   */
  collectionName?: string
}

export function createStorage (opts: CreateStorageOpts): SearchableWorkflowStateStorage {
  const { collectionName = "rivr-workflow-states", dbName, url, clientOpts = {} } = opts

  return new MongoDBWorkflowStateStorage(
    url,
    clientOpts,
    dbName,
    collectionName
  )
}