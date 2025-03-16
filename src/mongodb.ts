import { setTimeout } from "node:timers/promises";
import { Engine, HandlerResult, StepOpts, SuccessResult, Trigger, Worker, Workflow } from "./core";
import { AnyBulkWriteOperation, Collection, MongoClient } from "mongodb"
import { InfiniteLoop, InsertJob, JobRecord as JRecord, JobWrite as JWrite, PullOpts, Storage } from "./pull"

type MongoJobRecord<State> = Omit<JRecord<State>, "id">

export class MongoStorage<State> implements Storage<State> {
    #collection: Collection<MongoJobRecord<State>>

    constructor(collection: Collection<MongoJobRecord<State>>) {
        this.#collection = collection
    }

    async pull(opts: PullOpts<State>): Promise<JRecord<State>[]> {
        const { workflows } = opts
        const names = workflows.map(w => w.name)

        const list = await this.#collection
            .find({ 
                workflow: { $in: names },
                ack: false
            })
            .toArray()

        return list.map(({ _id, ...rest }) => ({
            ...rest,
            id: _id.toHexString()
        }))
    }

    async write(writes: JWrite<State>[]): Promise<void> {
        const mongoWrites = writes.map(write => {
            if (write.type === "ack" || write.type === "nack") {
                return {
                    updateOne: {
                        filter: {
                            id: write.record.id
                        },
                        update: {
                            $set: {
                                ack: true
                            }
                        }
                    }
                } satisfies AnyBulkWriteOperation<MongoJobRecord<State>>
            }

            if (write.type === "insert") {
                return {
                    insertOne: {
                        document: write.record
                    }
                } satisfies AnyBulkWriteOperation<MongoJobRecord<State>>
            }

            throw new Error("not implemented")
        })

        await this.#collection.bulkWrite(mongoWrites)
    }
}

export class MongoWorker implements Worker {
    #opts: CreateEngineOpts
    #client: MongoClient
    #loop: InfiniteLoop
    #storage: MongoStorage<unknown>
    #isStopped: boolean = false

    constructor(opts: CreateEngineOpts) {
        this.#opts = opts
        this.#loop = new InfiniteLoop()
        this.#client = new MongoClient(this.#opts.url, {
            directConnection: true
        })
        this.#storage = new MongoStorage(
            this.#client.db(this.#opts.dbName).collection("jobs")
        )
    }

    start(workflows: Workflow<unknown>[]): void {
        console.log("starting worker");
        (async () => {
            try {
                for (const _ of this.#loop) {
                    const jobs = await this.#storage.pull({ workflows })
                    console.log("jobs", jobs.length)

                    for (const job of jobs) {
                        const mWorkflow = workflows.find(w => w.name === job.workflow)
                        
                        if (!mWorkflow)
                            continue

                        const mStep = mWorkflow.getStep(job.step)

                        if (!mStep)
                            continue

                        console.log("handling...", mStep.name)
                        const result = this.#executeHandler(mStep, job.state)
                        const mNextStep = mWorkflow.getNextStep(job.step)
                        
                        if (result.type === "failure") {
                            await this.#storage.write([
                                {
                                    type: "nack",
                                    record: job
                                },
                            ])

                            mWorkflow.emit("stepFailed", { error: result.error })

                            return
                        }

                        await this.#storage.write([
                            {
                                type: "ack",
                                record: job
                            },
                            ...mNextStep !== undefined
                                ? [
                                    {
                                        type: "insert",
                                        record: {
                                            workflow: mWorkflow.name,
                                            step: mNextStep.name,
                                            ack: false,
                                            state: result.newState
                                        }
                                    } satisfies InsertJob<unknown>
                                ]
                                : []
                        ])

                        if (mNextStep === undefined) {
                            mWorkflow.emit("workflowCompleted", { state: result.newState })
                        }
                    }

                    await setTimeout(200)
                }
            } catch (error: unknown) {
                console.log(error)
            } finally {
                this.#isStopped = true
            }
        })()
        console.log("worker started");
    }

    async stop(): Promise<void> {
        this.#loop.stop()
        
        while (!this.#isStopped) {
            await setTimeout(10)
        }

        await this.#client.close(true)
    }

    #executeHandler(step: StepOpts<unknown>, state: unknown): HandlerResult<unknown> {
        try {
            const newStateOrResult = step.handler({
                state,
                success: (newState: unknown) => ({
                    type: "success",
                    newState
                })
            })
    
            if (this.#isSuccessResult(newStateOrResult)) {
                return newStateOrResult
            }
    
            return {
                type: "success",
                newState: newStateOrResult
            }
        } catch(error: unknown) {
            return {
                type: "failure",
                error
            }
        }
    }

    #isSuccessResult(state: unknown): state is SuccessResult<unknown> {
        return typeof state === "object" && 
            state !== null && 
            "type" in state &&
            state.type === "success"
    }
}

export class MongoTrigger implements Trigger {
    #opts: CreateEngineOpts
    #client: MongoClient
    #storage: MongoStorage<unknown>

    constructor(opts: CreateEngineOpts) {
        this.#opts = opts
        this.#client = new MongoClient(this.#opts.url, {
            directConnection: true
        })
        this.#storage = new MongoStorage(this.#client.db(this.#opts.dbName).collection<MongoJobRecord<unknown>>("jobs"))
    }

    async trigger<State>(workflow: Workflow<State>, state: State): Promise<void> {
        const mFirstStep = workflow.steps[0]

        if (mFirstStep === undefined)
            throw new Error("not implemented")

        await this.#storage.write([
            {
                type: "insert",
                record: {
                    state,
                    workflow: workflow.name,
                    step: mFirstStep.name,
                    ack: false
                }
            }
        ])
    }

    async disconnect(): Promise<void> {
        await this.#client.close(true)
    }
}

export class MongoEngine implements Engine {
    #opts: CreateEngineOpts
    #workers: MongoWorker[] = []
    #triggers: MongoTrigger[] = []

    constructor(opts: CreateEngineOpts) {
        this.#opts = opts
        this.#opts.signal?.addEventListener("abort", () => {
            for (const worker of this.#workers) {
                worker.stop().catch(console.error)
            }

            for (const trigger of this.#triggers) {
                trigger.disconnect().catch(console.error)
            }
        })
    }

    createWorker(): Worker {
        const w = new MongoWorker(this.#opts)
        this.#workers.push(w)
        return w
    }

    createTrigger(): Trigger {
        const t = new MongoTrigger(this.#opts)
        this.#triggers.push(t)
        return t
    }
}

export type CreateEngineOpts = {
    url: string
    dbName: string
    signal?: AbortSignal
}

export function createEngine (opts: CreateEngineOpts): Engine {
    return new MongoEngine(opts)
}