import {
  ConcreteTrigger,
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
  type Collection,
  Filter,
  MongoClient,
  MongoClientOptions
} from "mongodb"

type MongoWorkflowState<State> = WorkflowState<State>

export type WriteOpts = {
  session?: ClientSession
} & DefaultTriggerOpts

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    error instanceof DOMException && error.name === "AbortError"
}

class MongoContinuousPollConsumption implements Consumption {
  #collection: Collection<WorkflowState<unknown>>
  #createFilter: () => Filter<WorkflowState<unknown>>
  #timeBetweenEmptyPolls: number = 0
  #abort = new AbortController()
  #infiniteLoop = new InfiniteLoop()

  constructor(
    collection: Collection<WorkflowState<unknown>>,
    filter: () => Filter<WorkflowState<unknown>>,
    timeBetweenEmptyPolls: number
  ) {
    this.#collection = collection;
    this.#createFilter = filter;
    this.#timeBetweenEmptyPolls = timeBetweenEmptyPolls;
  }

  async stop(): Promise<void> {
    this.#infiniteLoop.stop()
    this.#abort.abort()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WorkflowState<unknown>> {
    try {
      for (const _ of this.#infiniteLoop) {
        const cursor = this.#collection.find(this.#createFilter(), {
          signal: this.#abort.signal
        })

        for await (const { _id, ...state } of cursor) {
          yield state
        }
      }
    } catch (error: unknown) {
      if (!isAbortError(error)) {
        throw error
      }
    }
  }
}

class MongoSinglePollConsumption implements Consumption {
  #collection: Collection<WorkflowState<unknown>>
  #filter: Filter<WorkflowState<unknown>>
  #abort = new AbortController()

  constructor(collection: Collection<WorkflowState<unknown>>, filter: Filter<WorkflowState<unknown>>) {
    this.#collection = collection;
    this.#filter = filter;
  }

  async stop(): Promise<void> {
    this.#abort.abort()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WorkflowState<unknown>> {
    const cursor = this.#collection.find(this.#filter, {
      signal: this.#abort.signal
    })

    for await (const { _id, ...state } of cursor) {
      yield state
    }
  }
}

class MongoChangeStreamConsumption implements Consumption {
  #collection: Collection<WorkflowState<unknown>>
  #workflows: Workflow<unknown, unknown, Record<string, never>, Record<never, never>>[]

  #changeStream: ChangeStream<WorkflowState<unknown>, ChangeStreamDocument<WorkflowState<unknown>>> | undefined

  constructor(
    collection: Collection<WorkflowState<unknown>>,
    workflows: Workflow<unknown, unknown, Record<string, never>, Record<never, never>>[]
  ) {
    this.#collection = collection
    this.#workflows = workflows
  }

  async stop(): Promise<void> {
    if (this.#changeStream !== undefined && this.#changeStream.closed) {
      return
    }

    await this.#changeStream?.close()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WorkflowState<unknown>> {
    if (this.#changeStream !== undefined) {
      throw new Error("Consumption was already started, please created another consumption.")
    }

    const changeStream = this.#collection.watch([
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
    ], {
      fullDocument: "updateLookup"
    })

    this.#changeStream = changeStream

    try {
      for await (const change of changeStream) {
        if (change.operationType === "insert") {
          yield change.fullDocument
        }

        if (change.operationType === "replace" && change.fullDocument !== undefined) {
          yield change.fullDocument
        }
      }
    } catch (error: unknown) {
      if (!this.#isWatchStreamClosed(error)) {
        throw error
      }
    }
  }

  #buildAggregationPipeline(workflows: Workflow<unknown, unknown, Record<string, never>, Record<never, never>>[]) {
    const steps = workflows
      .map(workflow => Array.from(workflow.steps()))
      .flat()
      .map(({item, context}) => [
        `${context.name}-${item.maxAttempts}`,
        {
          step: item,
          workflow: context
        }
      ] as const)
      .reduce(
        (acc, [id, {step, workflow}]) => {
          const existing = acc.get(id)

          if (!existing) {
            acc.set(id, {steps: [step], workflow: workflow.name, maxAttempts: step.maxAttempts})
            return acc
          }

          return acc.set(id, {...existing, steps: [...existing.steps, step]})
        },
        new Map<string, { workflow: string, maxAttempts: number, steps: Step[] }>()
      )

    const filter = Array.from(steps.entries())
      .map(([, {maxAttempts, workflow, steps}]) => ({
        $and: [
          {
            "fullDocument.name": workflow,
            "fullDocument.toExecute.step": {$in: steps.map(step => step.name)},
            "fullDocument.toExecute.status": "todo"
          },
          // {
          //   $or: [
          //     {
          //       "fullDocument.toExecute.status": "todo",
          //       "fullDocument.toExecute.attempt": {$lte: maxAttempts},
          //       "fullDocument.toExecute.pickAfter": {$exists: false}
          //     },
          //     // {
          //     //   "fullDocument.toExecute.status": "todo",
          //     //   "fullDocument.toExecute.attempt": {$lte: maxAttempts},
          //     //   // "fullDocument.toExecute.pickAfter": {$lte: "$$NOW"}
          //     //   $expr: {
          //     //     $lt: ["fullDocument.toExecute.pickAfter", "$$NOW"]
          //     //   }
          //     // }
          //   ]
          // }
        ]
      })) satisfies Filter<MongoWorkflowState<unknown>>[]

    console.log(JSON.stringify([
      {
        $match: {
          $or: filter
        }
      }
    ]))

    return [
      {
        $match: {
          $or: filter
        }
      }
    ]
  }

  #isWatchStreamClosed(error: unknown): boolean {
    return typeof error === "object" && error !== null && "message" in error &&
      typeof error.message === "string" && error.message.includes("is closed")
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

  async createConsumptions<State, Decorators extends Record<never, never>, FirstState, StateByStepName extends Record<string, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<Consumption[]> {
    return [
      new MongoChangeStreamConsumption(
        this.#collection,
        workflows as Workflow<unknown, unknown, Record<string, never>, Record<never, never>>[]
      ),
      new MongoSinglePollConsumption(
        this.#collection,
        {
          lastModified: { $lte: new Date() }
        }
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
        this.#timeBetweenEmptyPolls
      )
    ]
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