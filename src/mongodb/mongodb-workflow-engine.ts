import { MongoClient, OptionalId } from "mongodb"
import { Workflow } from "../workflow"
import { setTimeout, setInterval } from "node:timers/promises"
import { TriggerInterface } from "../trigger.interface"
import { MongoDBTrigger } from "./mongodb-trigger"
import { StepState } from "./step-state"
import { StepStateCollection } from "./step-state-collection"
import { MongoDBPoller } from "./poller"
import { GetTimeToWait } from "../retry"

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
    signal?: AbortSignal

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
}

export class MongoDBWorkflowEngine {
    private constructor(
        private readonly opts: CreateOpts
    ) {
    }

    async start<State> (workflow: Workflow<State>, opts: StartOpts = {}): Promise<void> {
        const { 
            signal, 
            pageSize = 50, 
            pollingIntervalMs = 3_000, 
            maxAttempts: maxRetry = 3,
            timeBetweenRetries = () => 0
        } = opts

        const collectionWrapper = this.createCollectionWrapper()

        await new MongoDBPoller(
            workflow as Workflow<unknown>,
            collectionWrapper, 
            pageSize, 
            pollingIntervalMs,
            maxRetry,
            timeBetweenRetries,
            signal,
        ).start()
    }

    async getTrigger<State>(workflow: Workflow<State>): Promise<TriggerInterface<State>> {
        const collection = this.createCollectionWrapper()
    
        return new MongoDBTrigger(workflow, collection)
    }

    static create(opts: CreateOpts): MongoDBWorkflowEngine {
        return new MongoDBWorkflowEngine(opts)
    }

    private createCollectionWrapper (): StepStateCollection {
        const { client, dbName, collectionName = "workflows" } = this.opts
        return new StepStateCollection(client.db(dbName).collection(collectionName))
    }
}