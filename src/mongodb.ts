import {DefaultTriggerOpts, type Engine, type Trigger, type Worker} from "./engine.ts";
import {Poller, PullOpts, PullTrigger, type Storage, type Write} from "./pull/poller.ts";
import {
    type AnyBulkWriteOperation, ClientSession,
    type Collection, Filter,
    MongoClient,
    MongoClientOptions
} from "mongodb"
import {Step, Workflow} from "./types.ts";
import {WorkflowState} from "./pull/state.ts";

type MongoWorkflowState<State> = WorkflowState<State>

export type WriteOpts = {
    session?: ClientSession
} & DefaultTriggerOpts

class MongoStorage implements Storage<WriteOpts> {
    #client: MongoClient
    #collection: Collection<MongoWorkflowState<unknown>>

    constructor(
        client: MongoClient,
        dbName: string,
        collectionName: string
    ) {
        this.#client = client
        this.#collection = this.#client.db(dbName).collection(collectionName)
    }

    #getPullFilter<State, Decorators>(workflows: Workflow<State, Decorators>[]): Filter<MongoWorkflowState<unknown>> {
        const steps = workflows
          .map(workflow => Array.from(workflow.steps()))
          .flat()
          .map(([ step, workflow ]) => [
            `${workflow.name}-${step.maxAttempts}`,
              {
                  step,
                  workflow
              }
          ] as const)
          .reduce(
            (acc, [ id, { step, workflow } ]) => {
                const existing = acc.get(id)

                if (!existing) {
                    acc.set(id, { steps: [ step ], workflow: workflow.name, maxAttempts: step.maxAttempts })
                    return acc
                }

                return acc.set(id, { ...existing, steps: [ ...existing.steps, step ] })
            },
            new Map<string, { workflow: string, maxAttempts: number, steps: Step<State, Decorators>[] }>()
          )

        const filter = Array.from(steps.entries())
          .map(([ , { maxAttempts, workflow, steps }]) => ({
              $and: [
                  {
                      name: workflow,
                      "toExecute.step": { $in: steps.map(step => step.name) },
                  },
                  {
                      $or: [
                          {
                              "toExecute.status": "todo",
                              "toExecute.attempt": { $lte: maxAttempts },
                              "toExecute.pickAfter": { $exists: false }
                          },
                          {
                              "toExecute.status": "todo",
                              "toExecute.attempt": { $lte: maxAttempts },
                              "toExecute.pickAfter": { $lte: new Date() }
                          }
                      ]
                  }
              ]
          })) satisfies Filter<MongoWorkflowState<State>>[]

        return {
            $or: filter
        }
    }

    async pull<State, Decorators>(workflows: Workflow<State, Decorators>[], opts: PullOpts): Promise<WorkflowState<State>[]> {
        const filter = this.#getPullFilter(workflows)

        const tasks = await this.#collection.find(filter)
            .limit(opts.limit)
            .toArray()

        return tasks.map(({ _id, ...rest }) => ({
            ...rest,
        } as WorkflowState<State>))
    }

    async write<State>(writes: Write<State>[], opts: WriteOpts = {}): Promise<void> {
        const { session } = opts

        const mongoWrites = writes.map(write => {
            switch(write.type) {
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

                default: throw new Error(`Write is not supported`)
            }
        })

        await this.#collection.bulkWrite(mongoWrites, {
            session,
        })
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
        const {
            dbName,
            delayBetweenPulls = 1_000,
            countPerPull = 20
        } = this.#opts

        const storage = new MongoStorage(
            this.client,
            dbName,
            "tasks",
        )

        const poller = new Poller(
          storage,
          delayBetweenPulls,
          countPerPull
        )
        this.#workers.push(poller)

        return poller
    }

    createTrigger(): Trigger<WriteOpts> {
        const storage = new MongoStorage(
            this.client,
            this.#opts.dbName,
            "tasks"
        )

        this.#triggerStorage.push(storage)

        return new PullTrigger(storage)
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
}

export type CreateEngineOpts = {
    url: string
    clientOpts?: MongoClientOptions
    dbName: string
    signal?: AbortSignal

    /**
     * The delay between state pulls.
     *
     * Note that this delay is waited only if an incomplete or empty
     * page is pulled.
     *
     * @default {1_000} 1000ms by default
     */
    delayBetweenPulls?: number

    /**
     * The number of states retrieved for each pull.
     *
     * @default {20}
     */
    countPerPull?: number
}

export function createEngine(opts: CreateEngineOpts) {
    return new MongoEngine(opts)
}