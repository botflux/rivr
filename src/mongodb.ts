import { type Engine, type Trigger, type Worker } from "./core.ts";
import { Poller, PullTrigger, type Storage, type Task, type Write } from "./pull.ts";
import {
    type AnyBulkWriteOperation, ClientSession,
    type Collection,
    MongoClient,
    MongoClientOptions,
    ObjectId
} from "mongodb"
import {Workflow} from "./types.ts";

type MongoTask<State> = Omit<Task<State>, "id"> & {
    ack: boolean
}

export type WriteOpts = {
    session?: ClientSession
}

class MongoStorage implements Storage<WriteOpts> {
    #client: MongoClient
    #collection: Collection<MongoTask<unknown>>

    constructor(
        client: MongoClient,
        dbName: string,
        collectionName: string
    ) {
        this.#client = client
        this.#collection = this.#client.db(dbName).collection(collectionName)
    }

    async pull<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<Task<State>[]> {
        const names = workflows.map(w => w.name)

        const tasks = await this.#collection.find({ workflow: { $in: names }, ack: false })
            .toArray()

        return tasks.map(({ _id, ack, ...rest }) => ({
            ...rest,
            id: _id.toHexString()
        })) as Task<State>[]
    }

    async write<State>(writes: Write<State>[], opts: WriteOpts = {}): Promise<void> {
        const { session } = opts

        const mongoWrites = writes.map(write => {
            switch(write.type) {
                case "ack": 
                case "nack": return {
                    updateOne: {
                        filter: {
                            _id: ObjectId.createFromHexString(write.task.id)
                        },
                        update: {
                            $set: {
                                ack: true
                            }
                        }
                    }
                } satisfies AnyBulkWriteOperation<MongoTask<State>>

                case "insert": return {
                    insertOne: {
                        document: {
                            ...write.task,
                            ack: false   
                        }
                    }
                } satisfies AnyBulkWriteOperation<MongoTask<State>>

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
            for (const worker of this.#workers) {
                worker.stop().catch(console.error)
            }

            for (const storage of this.#triggerStorage) {
                storage.disconnect().catch(console.error)
            }
        })
    }

    createWorker(): Worker {
        const storage = new MongoStorage(
            this.client,
            this.#opts.dbName,
            "tasks"
        )

        const poller = new Poller(storage)
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
}

export function createEngine(opts: CreateEngineOpts) {
    return new MongoEngine(opts)
}