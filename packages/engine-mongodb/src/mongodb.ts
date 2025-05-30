import {
  ConcreteTrigger, ConsumeOpts,
  Consumption,
  DefaultTriggerOpts,
  Engine,
  Executor,
  FindAll,
  InfiniteLoop,
  Queue,
  Step,
  type Storage,
  type Trigger,
  type Worker,
  Workflow,
  WorkflowState,
  type Write
} from "rivr";
import {
  type AnyBulkWriteOperation,
  ChangeStream,
  ChangeStreamDocument,
  ClientSession,
  type Collection, Document,
  Filter,
  MongoClient,
  MongoClientOptions
} from "mongodb"
import {setTimeout} from "node:timers/promises"

type MongoWorkflowState<State> = WorkflowState<State>

export type WriteOpts = {
  session?: ClientSession
} & DefaultTriggerOpts

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    error instanceof DOMException && error.name === "AbortError"
}

class MongoSinglePollConsumption implements Consumption {
  #collection: Collection<WorkflowState<unknown>>
  #filter: Filter<WorkflowState<unknown>>
  #opts: ConsumeOpts
  #abort = new AbortController()

  constructor(
    collection: Collection<WorkflowState<unknown>>,
    filter: Filter<WorkflowState<unknown>>,
    opts: ConsumeOpts
  ) {
    this.#collection = collection
    this.#filter = filter
    this.#opts = opts;

    this.#startConsuming()
  }

  async stop(): Promise<void> {
    this.#abort.abort()
  }

  async #startConsuming(): Promise<void> {
    try {
      const cursor = this.#collection.find(this.#filter, {
        signal: this.#abort.signal
      })

      for await (const { _id, ...state } of cursor) {
        try {
          await this.#opts.onMessage(state)
        } catch (error: unknown) {
          console.error(error)
        }
      }
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        throw error
      }
    }
  }
}

class MongoContinuousPollConsumption implements Consumption {
  #collection: Collection<WorkflowState<unknown>>
  #getFilter: () => Filter<WorkflowState<unknown>>
  #opts: ConsumeOpts
  #timeBetweenEmptyPolls: number
  #abort = new AbortController
  #infiniteLoop = new InfiniteLoop()

  constructor(
    collection: Collection<WorkflowState<unknown>>,
    getFilter: () => Filter<WorkflowState<unknown>>,
    opts: ConsumeOpts,
    timeBetweenEmptyPolls: number
  ) {
    this.#collection = collection;
    this.#getFilter = getFilter;
    this.#opts = opts;
    this.#timeBetweenEmptyPolls = timeBetweenEmptyPolls;

    this.#startConsuming()
  }

  async stop(): Promise<void> {
    this.#infiniteLoop.stop()
    this.#abort.abort()
  }

  async #startConsuming() {
    try {
      for (const _ of this.#infiniteLoop) {
        const cursor = this.#collection.find(this.#getFilter(), {
          signal: this.#abort.signal
        })

        let count = 0

        for await (const { _id, ...state } of cursor) {
          count ++

          try {
            await this.#opts.onMessage(state)
          } catch (error: unknown) {
            console.error(error)
          }
        }

        if (count === 0) {
          await setTimeout(this.#timeBetweenEmptyPolls, 0, { signal: this.#abort.signal })
        }
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error
      }
    }
  }
}

class MongoChangeStreamConsumption implements Consumption {
  #collection: Collection<WorkflowState<unknown>>
  #opts: ConsumeOpts
  #pipeline: Document[]

  #changeStream: ChangeStream<WorkflowState<unknown>, ChangeStreamDocument<WorkflowState<unknown>>> | undefined

  constructor(
    collection: Collection<WorkflowState<unknown>>,
    pipeline: Document[],
    opts: ConsumeOpts
  ) {
    this.#collection = collection;
    this.#pipeline = pipeline;
    this.#opts = opts;

    this.#startConsuming()
  }

  async stop(): Promise<void> {
    if (!this.#changeStream?.closed) {
      return
    }

    this.#changeStream?.close()
  }

  async #startConsuming() {
    try {
      const stream = this.#collection.watch(this.#pipeline, {
        fullDocument: "updateLookup"
      })

      this.#changeStream = stream

      for await (const change of stream) {
        if (change.operationType === "insert" || (change.operationType === "replace" && change.fullDocument !== undefined)) {
          try {
            await this.#opts.onMessage(change.fullDocument)
          } catch (error: unknown) {
            console.error(error)
          }
        }
      }

    } catch (error: unknown) {
     if (!this.#isWatchStreamClosed(error))
       throw error
    }
  }

  #isWatchStreamClosed(error: unknown): boolean {
    return typeof error === "object" && error !== null && "message" in error &&
      typeof error.message === "string" && (error.message.includes("is closed") || error.message === "Executor error during getMore :: caused by :: operation was interrupted")
  }
}

class CompoundConsumption implements Consumption {
  #consumptions: Consumption[]

  constructor(consumptions: Consumption[]) {
    this.#consumptions = consumptions;
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.#consumptions.map(c => c.stop()))
  }
}

class MongoStorage implements Storage<WriteOpts>, Queue<WriteOpts> {
  #client: MongoClient
  #collection: Collection<MongoWorkflowState<unknown>>
  #timeBetweenEmptyPolls: number

  constructor(
    client: MongoClient,
    dbName: string,
    collectionName: string,
    timeBetweenEmptyPolls: number
  ) {
    this.#client = client
    this.#collection = this.#client.db(dbName).collection(collectionName)
    this.#timeBetweenEmptyPolls = timeBetweenEmptyPolls
  }

  async consume(opts: ConsumeOpts): Promise<Consumption> {
    return new CompoundConsumption([
      new MongoSinglePollConsumption(
        this.#collection,
        {
          lastModified: { $lte: new Date() }
        },
        opts
      ),
      new MongoContinuousPollConsumption(
        this.#collection,
        () => ({
          "toExecute.status": "todo",
          $or: [
            {
              "toExecute.pickAfter": { $lte: new Date() }
            }
          ]
        }),
        opts,
        this.#timeBetweenEmptyPolls
      ),
      new MongoChangeStreamConsumption(
        this.#collection,
        [
          {
            $match: {
              'fullDocument.toExecute.status': 'todo',
              $or: [
                {
                  'fullDocument.toExecute.pickAfter': { $exists: false }
                },
              ]
            }
          }
        ],
        opts
      )
    ])
  }

  async write<State>(writes: Write<State>[], opts: WriteOpts = {}): Promise<void> {
    const {session} = opts

    const mongoWrites = writes.map(write => {
      switch (write.type) {
        case "insert": {
          return {
            updateOne: {
              update: {
                $setOnInsert: write.state
              },
              filter: {
                id: write.state.id
              },
              upsert: true,
            },
          } satisfies AnyBulkWriteOperation<MongoWorkflowState<State>>
        }

        case "update": {
          return {
            replaceOne: {
              filter: {
                id: write.state.id
              },
              replacement: write.state
            }
          } satisfies AnyBulkWriteOperation<MongoWorkflowState<State>>
        }

        default:
          throw new Error(`Write is not supported`)
      }
    })

    await this.#collection.bulkWrite(mongoWrites, {
      session,
    })
  }

  async findById<State>(id: string): Promise<WorkflowState<State> | undefined> {
    const mRecord = await this.#collection.findOne({id})

    if (mRecord === null)
      return undefined

    const {_id, ...rest} = mRecord
    return rest as WorkflowState<State>
  }

  async findAll<State, FirstState, StateByStepName extends Record<string, never>, Decorators extends Record<never, never>>(opts: FindAll<State, FirstState, StateByStepName, Decorators>): Promise<WorkflowState<unknown>[]> {
    const cursor = this.#collection.find({ name: { $in: opts.workflows.map(w => w.name) } })
    const documents = await cursor.toArray()

    return documents.map(({_id, ...state}) => state)
  }

  async disconnect(): Promise<void> {
    await this.#client.close(true)
  }
}

export class MongoEngine implements Engine<WriteOpts> {
  #client: MongoClient | undefined
  #opts: CreateEngineOpts
  #workers: Worker[] = []
  #triggerStorage: Storage<WriteOpts>[] = []

  constructor(opts: CreateEngineOpts) {
    this.#opts = opts
    this.#opts.signal?.addEventListener("abort", () => {
      this.close().catch(console.error)
    })
  }

  createWorker(): Worker {
    const storage = this.#createStorage()

    const poller = new Executor(
      storage,
    )

    this.#workers.push(poller)

    return poller
  }

  createTrigger(): Trigger<WriteOpts> {
    const {
      dbName,
    } = this.#opts

    const storage = this.#createStorage()

    this.#triggerStorage.push(storage)

    return new ConcreteTrigger(storage)
  }

  createStorage(): Storage<WriteOpts> {
    const storage = this.#createStorage()
    this.#triggerStorage.push(storage)
    return storage
  }

  async close(): Promise<void> {
    for (const worker of this.#workers) {
      await worker.stop()
    }

    for (const storage of this.#triggerStorage) {
      await storage.disconnect()
    }
  }

  get client(): MongoClient {
    if (this.#client === undefined) {
      this.#client = new MongoClient(this.#opts.url, this.#opts.clientOpts)
    }

    return this.#client
  }

  #createStorage() {
    const {
      dbName,
      delayBetweenEmptyPolls = 5_000,
      collectionName = "workflow-states"
    } = this.#opts

    return new MongoStorage(
      this.client,
      dbName,
      collectionName,
      delayBetweenEmptyPolls
    )
  }
}

export type CreateEngineOpts = {
  url: string
  clientOpts?: MongoClientOptions
  dbName: string
  collectionName?: string
  signal?: AbortSignal

  /**
   * The delay between state pulls.
   *
   * Note that this delay is waited only if an incomplete or empty
   * page is pulled.
   *
   * @default {5_000} 5000ms by default
   */
  delayBetweenEmptyPolls?: number

  /**
   * The number of states retrieved for each pull.
   *
   * @default {20}
   */
  countPerPull?: number

  /**
   * Use change stream-based worker instead of
   * the normal poller-based worker.
   *
   * @default {false}
   */
  useChangeStream?: boolean
}

export function createEngine(opts: CreateEngineOpts) {
  return new MongoEngine(opts)
}