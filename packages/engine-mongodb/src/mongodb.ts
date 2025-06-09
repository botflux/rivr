import {
  ConcreteTrigger, ConsumeOpts,
  Consumption,
  DefaultTriggerOpts,
  Engine,
  ConcreteWorker,
  FindAll,
  InfiniteLoop,
  Queue,
  Step,
  type Storage,
  type Trigger,
  type Worker,
  Workflow,
  WorkflowState,
  type Write,
  CompoundConsumption,
  queue
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
import {Message} from "rivr/dist/queue";

type MongoWorkflowState<State> = WorkflowState<State>

export type WriteOpts = {
  session?: ClientSession
} & DefaultTriggerOpts

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    && error.message.includes("was aborted")
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
      if (!isAbortError(error)) {
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

class MongoQueue implements Storage<WriteOpts>, Queue<WriteOpts> {
  #opts: MongoQueueOpts

  #client: MongoClient | undefined

  constructor(opts: MongoQueueOpts) {
    this.#opts = opts;
  }

  async consume(opts: ConsumeOpts): Promise<Consumption> {
    return new CompoundConsumption([
      new MongoSinglePollConsumption(
        this.#getCollection(),
        {
          lastModified: { $lte: new Date() }
        },
        opts
      ),
      new MongoContinuousPollConsumption(
        this.#getCollection(),
        () => ({
          "toExecute.status": "todo",
          $or: [
            {
              "toExecute.pickAfter": { $lte: new Date() }
            }
          ]
        }),
        opts,
        this.#opts.delayBetweenEmptyPolls
      ),
      new MongoChangeStreamConsumption(
        this.#getCollection(),
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

    await this.#getCollection().bulkWrite(mongoWrites, {
      session,
    })
  }

  async findById<State>(id: string): Promise<WorkflowState<State> | undefined> {
    const mRecord = await this.#getCollection().findOne({id})

    if (mRecord === null)
      return undefined

    const {_id, ...rest} = mRecord
    return rest as WorkflowState<State>
  }

  async findAll<State, FirstState, StateByStepName extends Record<string, never>, Decorators extends Record<never, never>>(opts: FindAll<State, FirstState, StateByStepName, Decorators>): Promise<WorkflowState<unknown>[]> {
    const cursor = this.#getCollection().find({ name: { $in: opts.workflows.map(w => w.name) } })
    const documents = await cursor.toArray()

    return documents.map(({_id, ...state}) => state)
  }

  async disconnect(): Promise<void> {
    await this.#client?.close(true)
  }

  #getClient(): MongoClient {
    if (this.#client === undefined) {
      this.#client = new MongoClient(this.#opts.url, this.#opts.clientOpts)
    }

    return this.#client
  }

  #getCollection(): Collection<MongoWorkflowState<unknown>> {
    return this.#getClient().db(this.#opts.dbName).collection<MongoWorkflowState<unknown>>(this.#opts.collectionName)
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

    const poller = new ConcreteWorker(
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
      collectionName = "workflow-states",
      url,
      signal,
      clientOpts,
    } = this.#opts

    return new MongoQueue({
      dbName,
      delayBetweenEmptyPolls,
      collectionName,
      url,
      signal,
      clientOpts,
    })
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
}

export function createEngine(opts: CreateEngineOpts) {
  return new MongoEngine(opts)
}

export type MongoQueueOpts = {
  url: string
  clientOpts?: MongoClientOptions
  dbName: string
  collectionName: string
  signal?: AbortSignal

  /**
   * The delay between state pulls.
   *
   * Note that this delay is waited only if an incomplete or empty
   * page is pulled.
   *
   * @default {5_000} 5000ms by default
   */
  delayBetweenEmptyPolls: number
}

export function createQueue(opts: CreateEngineOpts) {
  const {
    dbName,
    delayBetweenEmptyPolls = 5_000,
    collectionName = "workflow-states",
    url,
    signal,
    clientOpts,
  } = opts

  return new MongoQueue({
    dbName,
    delayBetweenEmptyPolls,
    collectionName,
    url,
    signal,
    clientOpts,
  })
}

class MongoSinglePollConsumption2 implements queue.Consumption {
  #collection: Collection<Message>
  #filter: Filter<Message>
  #opts: queue.ConsumeOpts
  #abort = new AbortController()

  constructor(
    collection: Collection<Message>,
    filter: Filter<Message>,
    opts: queue.ConsumeOpts
  ) {
    this.#collection = collection
    this.#filter = filter
    this.#opts = opts;
  }

  async start(): Promise<void> {
    this.#startListening()
  }

  async #startListening() {
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

  async stop(): Promise<void> {
    this.#abort.abort()
  }
}

class MongoContinuousPollConsumption2 implements queue.Consumption {
  #collection: Collection<Message>
  #getFilter: () => Filter<Message>
  #opts: queue.ConsumeOpts
  #timeBetweenEmptyPolls: number
  #abort = new AbortController
  #infiniteLoop = new InfiniteLoop()

  constructor(
    collection: Collection<Message>,
    getFilter: () => Filter<Message>,
    opts: queue.ConsumeOpts,
    timeBetweenEmptyPolls: number
  ) {
    this.#collection = collection;
    this.#getFilter = getFilter;
    this.#opts = opts;
    this.#timeBetweenEmptyPolls = timeBetweenEmptyPolls;
  }

  async stop(): Promise<void> {
    this.#infiniteLoop.stop()
    this.#abort.abort()
  }

  async start(): Promise<void> {
    this.#startConsuming()
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
      if (!isAbortError(error)) {
        throw error
      }
    }
  }
}

class MongoChangeStreamConsumption2 implements queue.Consumption {
  #collection: Collection<Message>
  #opts: queue.ConsumeOpts
  #pipeline: Document[]

  #changeStream: ChangeStream<Message, ChangeStreamDocument<Message>> | undefined

  constructor(
    collection: Collection<Message>,
    pipeline: Document[],
    opts: queue.ConsumeOpts
  ) {
    this.#collection = collection;
    this.#pipeline = pipeline;
    this.#opts = opts;

    this.#startListening()
  }

  async stop(): Promise<void> {
    if (!this.#changeStream?.closed) {
      return
    }

    this.#changeStream?.close()
  }

  async start(): Promise<void> {
    this.#startListening()
  }

  async #startListening() {
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

class MongoQueue2 implements queue.Queue<WriteOpts> {
  #opts: MongoQueueOpts

  #client: MongoClient | undefined

  constructor(opts: MongoQueueOpts) {
    this.#opts = opts;
  }

  consume(opts: queue.ConsumeOpts): queue.Consumption {
    return new queue.CompoundConsumption([
      new MongoSinglePollConsumption2(
        this.#getCollection(),
        {
          lastModified: { $lte: new Date() }
        },
        opts
      ),
      new MongoContinuousPollConsumption2(
        this.#getCollection(),
        () => ({ status: "todo" }),
        opts,
        this.#opts.delayBetweenEmptyPolls
      ),
      new MongoChangeStreamConsumption2(
        this.#getCollection(),
        [
          {
            $match: {
              'fullDocument.status': 'todo',
            }
          }
        ],
        opts
      )
    ])
  }

  async produce(messages: queue.Message[], opts?: WriteOpts | undefined): Promise<void> {
    await this.#getCollection().bulkWrite(
      messages.map(message => ({
        updateOne: {
          filter: {
            taskId: message.taskId,
          },
          upsert: true,
          update: {
            $set: message
          }
        }
      })),
      {
        session: opts?.session
      }
    )
  }

  async disconnect(): Promise<void> {
    await this.#client?.close(true)
  }

  #getClient(): MongoClient {
    if (this.#client === undefined) {
      this.#client = new MongoClient(this.#opts.url, this.#opts.clientOpts)
    }

    return this.#client
  }

  #getCollection(): Collection<Message> {
    return this.#getClient().db(this.#opts.dbName).collection<Message>(this.#opts.collectionName)
  }
}

export function createQueue2(opts: MongoQueueOpts) {
  return new MongoQueue2(opts)
}