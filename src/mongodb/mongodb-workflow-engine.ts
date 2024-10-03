import { MongoClient, OptionalId } from "mongodb"
import { Workflow } from "../workflow"
import { setTimeout, setInterval } from "node:timers/promises"
import { TriggerInterface } from "../trigger.interface"
import { MongoDBTrigger } from "./mongodb-trigger"
import { StepState } from "./step-state"
import { StepStateCollection } from "./step-state-collection"

export type CreateOpts = {
    /**
     * Pass the MongoDB client that will be used.
     */
    client: MongoClient

    /**
     * The time between each polling given the message pagination is exhausted.
     * 
     * @default 3_000
     */
    pollingIntervalMs?: number

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
}

export type StartOpts = {
    signal?: AbortSignal
}

export class MongoDBWorkflowEngine {
    private constructor(
        private readonly opts: CreateOpts
    ) {
    }

    start<State> (workflow: Workflow<State>, opts: StartOpts = {}): Promise<void> {
        let resolve: (() => void) | undefined
        let reject: ((reason?: any) => void) | undefined

        const p = new Promise<void>((res, rej) => {
            resolve = res
            reject = rej
        })

        resolve?.()

        ;(async () => {
            const { client, dbName, pollingIntervalMs, collectionName = "workflow", pageSize = 50 } = this.opts
            let stop = false

            opts.signal?.addEventListener("abort", () => stop = true)

            await client.connect()

            const db = client.db(dbName)
            const collection = new StepStateCollection(db.collection<StepState<unknown>>(collectionName))


            try {
                for await (const _ of setInterval(0, { signal: opts?.signal })) {
                    const documents = await collection.pull(workflow, workflow.getSteps(), pageSize)

                    for (const document of documents) {
                        console.log("Fetching doc", document)

                        if (stop) {
                            break
                        }

                        const mStep = workflow.getStepByName(document.recipient!)
                        
                        if (!mStep) {
                            continue
                        }

                        const newState = (await mStep.handler(document.state)) ?? document.state

                        const newDocument: OptionalId<StepState<State>> = {
                            createdAt: new Date(),
                            belongsTo: workflow.name,
                            recipient: workflow.getNextStep(mStep)?.name,
                            state: newState,
                            acknowledged: false
                        }

                        await collection.publishAndAcknowledge(newDocument, document)
                    }

                    const isPaginationExhausted = documents.length < pageSize

                    // if pagination exhausted, then do not wait the interval
                    if (isPaginationExhausted) {
                        await setTimeout(pollingIntervalMs)
                    }
                }
            } catch (e) {
                reject?.(e)
            }
        })()

        return p
    }

    async getTrigger<State>(workflow: Workflow<State>): Promise<TriggerInterface<State>> {

        const { client, dbName, collectionName = "workflow" } = this.opts

        await client.connect()

        const db = client.db(dbName)
        const collection = new StepStateCollection(db.collection<StepState<unknown>>(collectionName))

        return new MongoDBTrigger(workflow, collection)
    }

    static create(opts: CreateOpts): MongoDBWorkflowEngine {
        return new MongoDBWorkflowEngine(opts)
    }
}