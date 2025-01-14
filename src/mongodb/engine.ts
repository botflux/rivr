import {MongoClient, MongoClientOptions} from "mongodb"
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
import {MongoDBConnectionPool} from "./connection-pool";
import { setTimeout } from "node:timers/promises"
import {once} from "node:events";

export type CreateOpts = {
    /**
     * Pass the MongoDB client that will be used.
     */
    url: string

    clientOpts?: MongoClientOptions

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
}

export class MongoDBWorkflowEngine implements EngineInterface {
    private readonly pool: MongoDBConnectionPool
    private readonly workers: WorkerInterface[] = []

    private constructor(
        private readonly opts: CreateOpts
    ) {
        this.pool = new MongoDBConnectionPool(() => new MongoClient(opts.url, opts.clientOpts).connect())
        this.opts.signal?.addEventListener("abort", () => this.stop().catch(console.error))
    }

    getWorker<State> (workflow: Workflow<State>): WorkerInterface {
        const { 
            pageSize = 50,
            pollingIntervalMs = 3_000,
            maxAttempts: maxRetry = 3,
            timeBetweenRetries = () => 0,
            replication: { replicated = false, lockDurationMs = pollingIntervalMs * 3 } = {},
        } = this.opts

        const storage = this.createCollectionWrapper<State>(replicated, lockDurationMs)

        const poller = new Poller(
          randomUUID(),
          pollingIntervalMs,
          () => Promise.resolve(storage),
          workflow,
          pageSize,
          maxRetry,
          timeBetweenRetries
        )
        this.workers.push(poller)
        return poller
    }

    getTrigger<State>(workflow: Workflow<State>): TriggerInterface<State> {
        const storage = this.createCollectionWrapper<State>(false, 0)
        return new StorageTrigger(workflow, () => Promise.resolve(storage))
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

    private async createCollectionWrapper<State>(replicated: boolean, lockDurationMs: number): Promise<StorageInterface<State>> {
        const { dbName, collectionName = "workflows" } = this.opts
        const client = await this.pool.getConnection("")
        const collection = client.db(dbName).collection<MongodbRecord<State>>(collectionName)

        return replicated
            ? new ReplicatedMongodbStorage(collection, lockDurationMs)
            : new MongodbStorage(collection)
    }
}