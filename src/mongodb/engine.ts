import {MongoClient} from "mongodb"
import {Workflow} from "../workflow"
import {TriggerInterface} from "../trigger.interface"
import {GetTimeToWait} from "../retry"
import {Poller} from "../poll/poller";
import {MongodbRecord, MongodbStorage} from "./mongodb-storage";
import {StorageInterface} from "../poll/storage.interface";
import {StorageTrigger} from "../poll/trigger";
import {randomUUID} from "node:crypto";
import {ReplicatedMongodbStorage} from "./replicated-mongodb-storage";

export type CreateOpts = {
    /**
     * Pass the MongoDB client that will be used.
     */
    client: MongoClient

    /**
     * The name of the MongoDB database that will be used to store the step states.
     */
    dbName: string

    /**
     * The name of the MongoDB collection storing the step states.
     */
    collectionName?: string

}

export type StartOpts = {
    /**
     * The amount of docuemnts fetch once.
     * 
     * @default 50
     */
    pageSize?: number

    /**
     * The time between each polling given the message pagination is exhausted.
     * 
     * @default 3_000
     */
    pollingIntervalMs?: number

    /**
     * The amount of time a step will be retried in case of an error.
     * 
     * @default 3
     */
    maxAttempts?: number

    /**
     * A function that computes the time to wait based on the current attempt number.
     */
    timeBetweenRetries?: GetTimeToWait

    /**
     * True if multiple poller are started at the same time.
     *
     * @default false
     */
    replicated?: boolean
}

export class MongoDBWorkflowEngine {
    private constructor(
        private readonly opts: CreateOpts
    ) {
    }

    async getPoller<State> (workflow: Workflow<State>, opts: StartOpts): Promise<Poller<State>> {
        const pollerId = randomUUID()

        const { 
            pageSize = 50,
            pollingIntervalMs = 3_000,
            maxAttempts: maxRetry = 3,
            timeBetweenRetries = () => 0,
            replicated = false
        } = opts

        const storage = this.createCollectionWrapper<State>(replicated)

        return new Poller(
          pollerId,
          pollingIntervalMs,
          storage,
          workflow,
          pageSize,
          maxRetry,
          timeBetweenRetries
        )
    }

    async getTrigger<State>(workflow: Workflow<State>): Promise<TriggerInterface<State>> {
        const storage = this.createCollectionWrapper<State>(false)
        // return new MongoDBTrigger<State>(workflow, storage)
        return new StorageTrigger(workflow, storage)
    }

    static create(opts: CreateOpts): MongoDBWorkflowEngine {
        return new MongoDBWorkflowEngine(opts)
    }

    private createCollectionWrapper<State> (replicated: boolean): StorageInterface<State> {
        const { client, dbName, collectionName = "workflows" } = this.opts
        const collection = client.db(dbName).collection<MongodbRecord<State>>(collectionName)

        return replicated
            ? new ReplicatedMongodbStorage(collection)
            : new MongodbStorage(collection)
    }
}