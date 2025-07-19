import {AnyBulkWriteOperation, Collection, Filter, MongoClient, MongoClientOptions} from "mongodb";
import {
  ListWorkflowStateResult,
  SearchableWorkflowStateStorage,
  SearchWorkflowStateOpts,
  NormalizedWorkflowState
} from "rivr";

export class MongoDBWorkflowStateStorage implements SearchableWorkflowStateStorage {
  readonly #url: string
  readonly #clientOpts: MongoClientOptions
  readonly #dbName: string
  readonly #collectionName: string

  #indexesChecked = false
  #mongoClient: MongoClient | undefined

  constructor(url: string, clientOpts: MongoClientOptions, dbName: string, collectionName: string) {
    this.#url = url;
    this.#clientOpts = clientOpts;
    this.#dbName = dbName;
    this.#collectionName = collectionName;
  }

  async disconnect(): Promise<void> {
    await this.#mongoClient?.close(true)
  }

  async search<State>(opts: SearchWorkflowStateOpts = {}): Promise<ListWorkflowStateResult<State>> {
    await this.#ensureIndexesExists()
    const { page = 1, limit = 25, status, names } = opts
    const skip = (page - 1) * limit
    const filters = {
      ...status !== undefined && status.length > 0 && {
        status: { $in: status }
      },
      ...names !== undefined && names.length > 0 && {
        name: { $in: names }
      }
    } satisfies Filter<NormalizedWorkflowState<unknown>>

    const [records, count] = await Promise.all([
      this.#getCollection().find(filters).skip(skip).limit(limit).toArray(),
      this.#getCollection().countDocuments(filters)
    ])

    const states = records.map(({_id, ...state}) => state as NormalizedWorkflowState<State>)

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

  async upsert<State>(states: NormalizedWorkflowState<State>[]): Promise<void> {
    await this.#ensureIndexesExists()
    const writes: AnyBulkWriteOperation<NormalizedWorkflowState<unknown>>[] = states.map(state => ({
      replaceOne: {
        upsert: true,
        filter: {id: state.id},
        replacement: state,
      }
    }))

    await this.#getCollection().bulkWrite(writes)
  }

  async get<State>(id: string): Promise<NormalizedWorkflowState<State> | undefined> {
    await this.#ensureIndexesExists()
    const mRecord = await this.#getCollection().findOne({id})

    if (mRecord === null) {
      return undefined
    }

    const {_id, ...state} = mRecord
    return state as NormalizedWorkflowState<State>
  }

  #getClient(): MongoClient {
    if (this.#mongoClient === undefined) {
      this.#mongoClient = new MongoClient(this.#url, this.#clientOpts)
    }

    return this.#mongoClient
  }

  #getCollection(): Collection<NormalizedWorkflowState<unknown>> {
    return this.#getClient().db(this.#dbName).collection(this.#collectionName)
  }

  async #ensureIndexesExists(): Promise<void> {
    if (this.#indexesChecked) {
      return
    }

    await this.#getCollection().createIndexes([
      /**
       * This index is used by the workflow storage's search method.
       */
      {
        name: "read_path_index",
        background: true,
        key: {
          name: 1,
          status: 1
        }
      },
      /**
       * This index is used by the consumer to update workflow states efficiently.
       */
      {
        name: "write_path_index",
        background: true,
        key: {
          id: 1,
        },
        unique: true
      }
    ])
  }
}
