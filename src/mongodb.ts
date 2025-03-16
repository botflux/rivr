import { setTimeout } from "node:timers/promises";
import { Engine, Trigger, Worker, Workflow } from "./core";
import { MongoClient } from "mongodb"
import { EventEmitter } from "node:stream";
import { once } from "node:events";

function stoppableIterator () {
    let stopped = false

    return {
        iterator: function* () {
            while (!stopped)
                yield 0
        },
        stop() {
            stopped = true
        }
    }
}

type JobRecord<S> = {
    state: S
    workflow: string
    step: string
}

export class MongoWorker implements Worker {
    #opts: CreateEngineOpts
    #client: MongoClient | undefined
    #stop: () => void
    #iterator: Generator<number, any, any>
    #emitted = new EventEmitter()

    constructor(opts: CreateEngineOpts) {
        this.#opts = opts
        const { iterator, stop } = stoppableIterator()
        this.#stop = stop
        this.#iterator = iterator()
    }

    start(workflows: Workflow<unknown>[]): void {
        // for (const w of workflows) {
        //     w.emit("workflowCompleted")
        // }

        console.log("starting worker");
        (async () => {
            try {
                for (const _ of this.#iterator) {
                    const jobs = await this.#listJobs(workflows)
                    console.log("jobs", jobs.length)

                    for (const job of jobs) {
                        const mWorkflow = workflows.find(w => w.name === job.workflow)
                        
                        if (!mWorkflow)
                            continue

                        const mStep = mWorkflow.getStep(job.step)

                        if (!mStep)
                            continue

                        console.log("handling...", mStep.name)
                        const newState = mStep.handler({ state: job.state })
                        
                        mWorkflow.emit("workflowCompleted", { state: newState })
                        console.log("emitted")
                    }

                    await setTimeout(200)
                }
            } catch (error: unknown) {
                console.log(error)
            } finally {
                this.#emitted.emit("done")
            }
        })()
        console.log("worker started");
    }

    async stop(): Promise<void> {
        const done = once(this.#emitted, "done")
        this.#stop()
        await done
        await this.#client?.close(true)
    }

    async #listJobs(workflows: Workflow<unknown>[]) {
        const client = this.#getClient()
        const collection = client.db(this.#opts.dbName).collection<JobRecord<unknown>>("jobs")
        const workflowNames = workflows.map(workflow => workflow.name)

        const records = await collection
            .find({ workflow: { $in: workflowNames } })
            .toArray()

        return records
    }

    #getClient(): MongoClient {
        if (this.#client !== undefined)
            return this.#client

        this.#client = new MongoClient(this.#opts.url, {
            directConnection: true
        })
        return this.#client
    }
}

export class MongoTrigger implements Trigger {
    #opts: CreateEngineOpts
    #client: MongoClient | undefined

    constructor(opts: CreateEngineOpts) {
        this.#opts = opts
    }

    async trigger<State>(workflow: Workflow<State>, state: State): Promise<void> {
        const client = this.#getClient()
        const collection = client.db(this.#opts.dbName).collection<JobRecord<State>>("jobs")

        const mFirstStep = workflow.steps[0]

        if (mFirstStep === undefined)
            throw new Error("not implemented")

        await collection.insertOne({
            state,
            workflow: workflow.name,
            step: mFirstStep.name
        })
    }

    async disconnect(): Promise<void> {
        await this.#client?.close(true)
    }

    #getClient(): MongoClient {
        if (this.#client) {
            return this.#client
        }

        this.#client = new MongoClient(this.#opts.url, {
            directConnection: true
        })
        return this.#client
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