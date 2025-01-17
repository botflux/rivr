import {Collection, MongoClient, MongoClientOptions, Db} from "mongodb"
import {Workflow} from "../workflow"
import {TriggerInterface} from "../trigger.interface"
import {GetTimeToWait} from "../retry"
import {Poller} from "../poll/poller";
import {MongodbRecord, MongodbStorage} from "./mongodb-storage";
import {StorageInterface} from "../poll/storage.interface";
import {StorageTrigger} from "../poll/trigger";
import {randomUUID} from "node:crypto";
import {ReplicatedMongodbStorage} from "./replicated-mongodb-storage";
import {EngineInterface} from "../engine.interface";
import {WorkerInterface} from "../worker.interface";
import {MongoDBConnectionPool, NoOpPool} from "./connection-pool";
import { setTimeout } from "node:timers/promises"
import {once} from "node:events";
import {ConnectionPool} from "../connection-pool";

export type CreateOpts = {
    /**
     * The name of the MongoDB database that will be used to store the step states.
     */
    dbName: string

    /**
     * The name of the MongoDB collection storing the step states.
     */
    collectionName?: string

    /**
     * The amount of docuemnts fetch once.
     *
     * @default 50
     */
    pageSize?: number

    /**
     * The time between (in ms) each polling given the message pagination is exhausted.
     *
     * @default 3_000
     */
    pollingIntervalMs?: number

    /**
     * The amount of time a step will be tried in case of an error.
     * This number includes the first try of a message (e.g. '3' means 'first try + 2 retries').
     *
     * @default 3
     */
    maxAttempts?: number

    /**
     * A function that computes the time to wait based on the current attempt number.
     */
    timeBetweenRetries?: GetTimeToWait

    /**
     * Enable this option to start multiple worker handling the
     * same workflow steps.
     *
     * In more practical term, workers will lock documents while reading
     * them, in order to not process the same operation twice.
     *
     * MongoDB has no built-in mechanism to lock a document, so this package
     * performs multiple `findOneAndUpdate` calls per poll to append the poller's id
     * to documents.
     *
     * If replication is disabled, the engine performs one `find` call per poll, which is
     * more efficient.
     */
    replication?: {
        /**
         * Enable replication
         *
         * @default false
         */
        replicated?: boolean

        /**
         * The duration of the lock.
         * After this duration the job will be taken by another poller.
         *
         * @default pollingIntervalMs * 3_000
         */
        lockDurationMs?: number
    }

    /**
     * The id of the given poller.
     * This value must be unique.
     *
     * @default {crypto.randomUUID()}
     */
    pollerId?: string

    signal?: AbortSignal
} & ({
    /**
     * Pass the MongoDB client that will be used.
     */
    url: string

    clientOpts?: MongoClientOptions
} | {
    client: MongoClient
})

export type WorkerMetadata = {
    /**
     * The client used to read and write step states.
     */
    client: MongoClient

    /**
     * The database in which step states are stored.
     */
    db: Db
}

export class MongoDBWorkflowEngine implements EngineInterface<WorkerMetadata> {
    private readonly pool: ConnectionPool<MongoClient>
    private readonly workers: WorkerInterface[] = []

    private constructor(
        private readonly opts: CreateOpts
    ) {
        this.pool = "client" in opts
            ? new NoOpPool(opts.client)
            : new MongoDBConnectionPool(() => new MongoClient(opts.url, opts.clientOpts).connect())
        this.opts.signal?.addEventListener("abort", () => this.stop().catch(console.error))
    }

    getWorker<State> (workflows: Workflow<State, WorkerMetadata>[]): WorkerInterface {
        const { 
            pageSize = 50,
            pollingIntervalMs = 3_000,
            maxAttempts: maxRetry = 3,
            timeBetweenRetries = () => 0,
            replication: { replicated = false, lockDurationMs = pollingIntervalMs * 3 } = {},
        } = this.opts

        const pollerId = randomUUID()

        const poller = new Poller<State, WorkerMetadata>(
          pollerId,
          pollingIntervalMs,
          async () => {
              const client = await this.pool.getConnection("default")
              return [
                  this.getWorkerStorage(client, replicated, lockDurationMs),
                  {
                      client,
                      db: client.db(this.opts.dbName)
                  } satisfies WorkerMetadata
              ]
          },
          workflows,
          pageSize,
          maxRetry,
          timeBetweenRetries
        )
        this.workers.push(poller)
        return poller
    }

    getTrigger<State>(workflow: Workflow<State, WorkerMetadata>): TriggerInterface<State> {
        return new StorageTrigger(workflow, async () => this.getTriggerStorage(await this.pool.getConnection("default")))
    }

    async stop(): Promise<void> {
        for (const worker of this.workers) {
            worker.stop()
            await Promise.race([
              once(worker, "stopped"),
              setTimeout(5_000)
            ])
        }
        await this.pool.clear()
    }

    static create(opts: CreateOpts): MongoDBWorkflowEngine {
        return new MongoDBWorkflowEngine(opts)
    }

    /**
     * Build the worker's storage implementation.
     * A special implementation using `findOneAndUpdate` to fetch
     * documents will be used if replication is enabled.
     *
     * @param client
     * @param replicated
     * @param lockDurationMs
     * @private
     */
    private getWorkerStorage<State>(client: MongoClient, replicated: boolean, lockDurationMs: number): StorageInterface<State, WorkerMetadata> {
        const collection = this.getCollection<State>(client)

        return replicated
          ? new ReplicatedMongodbStorage(collection, lockDurationMs)
          : new MongodbStorage(collection)
    }

    /**
     * Build the trigger's storage implementation.
     *
     * @param client
     * @private
     */
    private getTriggerStorage<State>(client: MongoClient): StorageInterface<State, WorkerMetadata> {
        return new MongodbStorage(this.getCollection(client))
    }

    private getCollection<State> (client: MongoClient): Collection<MongodbRecord<State>> {
        const { dbName, collectionName = "workflows" } = this.opts
        return client.db(dbName).collection<MongodbRecord<State>>(collectionName)
    }
}