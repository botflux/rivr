import { Engine, Trigger, Worker, Workflow } from "./core";
import { AnyBulkWriteOperation, Collection, MongoClient } from "mongodb"
import { JobRecord as JRecord, JobWrite as JWrite, Poller, PullOpts, Storage } from "./pull"

type MongoJobRecord<State> = Omit<JRecord<State>, "id">

export class MongoStorage<State> implements Storage<State> {
    #client: MongoClient
    #collection: Collection<MongoJobRecord<State>>

    constructor(
        client: MongoClient,
        collection: Collection<MongoJobRecord<State>>
    ) {
        this.#client = client
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

    async disconnect(): Promise<void> {
        this.#client.close(true)
    }
}

export class MongoTrigger implements Trigger {
    #opts: CreateEngineOpts
    #storage: MongoStorage<unknown>

    constructor(opts: CreateEngineOpts) {
        this.#opts = opts
        const client = new MongoClient(this.#opts.url, {
            directConnection: true
        })
        this.#storage = new MongoStorage(
            client,
            client.db(this.#opts.dbName).collection<MongoJobRecord<unknown>>("jobs")
        )
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
        await this.#storage.disconnect()
    }
}

export class MongoEngine implements Engine {
    #opts: CreateEngineOpts
    #workers: Poller[] = []
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
        const client = new MongoClient(this.#opts.url, {
            directConnection: true
        })

        const w = new Poller(
            new MongoStorage(
                client,
                client.db(this.#opts.dbName).collection("jobs")
            )
        )
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