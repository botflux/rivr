"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoEngine = void 0;
exports.createEngine = createEngine;
const rivr_1 = require("rivr");
const mongodb_1 = require("mongodb");
class MongoStorage {
    #client;
    #collection;
    constructor(client, dbName, collectionName) {
        this.#client = client;
        this.#collection = this.#client.db(dbName).collection(collectionName);
    }
    #getPullFilter(workflows) {
        const steps = workflows
            .map(workflow => Array.from(workflow.steps()))
            .flat()
            .map(([step, workflow]) => [
            `${workflow.name}-${step.maxAttempts}`,
            {
                step,
                workflow
            }
        ])
            .reduce((acc, [id, { step, workflow }]) => {
            const existing = acc.get(id);
            if (!existing) {
                acc.set(id, { steps: [step], workflow: workflow.name, maxAttempts: step.maxAttempts });
                return acc;
            }
            return acc.set(id, { ...existing, steps: [...existing.steps, step] });
        }, new Map());
        const filter = Array.from(steps.entries())
            .map(([, { maxAttempts, workflow, steps }]) => ({
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
        }));
        return {
            $or: filter
        };
    }
    async pull(workflows, opts) {
        const filter = this.#getPullFilter(workflows);
        const tasks = await this.#collection.find(filter)
            .limit(opts.limit)
            .toArray();
        return tasks.map(({ _id, ...rest }) => ({
            ...rest,
        }));
    }
    async write(writes, opts = {}) {
        const { session } = opts;
        const mongoWrites = writes.map(write => {
            switch (write.type) {
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
                    };
                }
                case "update": {
                    return {
                        replaceOne: {
                            filter: {
                                id: write.state.id
                            },
                            replacement: write.state
                        }
                    };
                }
                default: throw new Error(`Write is not supported`);
            }
        });
        await this.#collection.bulkWrite(mongoWrites, {
            session,
        });
    }
    async findById(id) {
        const mRecord = await this.#collection.findOne({ id });
        if (mRecord === null)
            return undefined;
        const { _id, ...rest } = mRecord;
        return rest;
    }
    async disconnect() {
        await this.#client.close(true);
    }
}
class MongoEngine {
    #client;
    #opts;
    #workers = [];
    #triggerStorage = [];
    constructor(opts) {
        this.#opts = opts;
        this.#opts.signal?.addEventListener("abort", () => {
            this.close().catch(console.error);
        });
    }
    createWorker() {
        const { dbName, delayBetweenPulls = 1_000, countPerPull = 20 } = this.#opts;
        const storage = new MongoStorage(this.client, dbName, this.#collectionName);
        const poller = new rivr_1.Poller(storage, delayBetweenPulls, countPerPull);
        this.#workers.push(poller);
        return poller;
    }
    createTrigger() {
        const storage = new MongoStorage(this.client, this.#opts.dbName, this.#collectionName);
        this.#triggerStorage.push(storage);
        return new rivr_1.PullTrigger(storage);
    }
    createStorage() {
        const storage = new MongoStorage(this.client, this.#opts.dbName, this.#collectionName);
        this.#triggerStorage.push(storage);
        return storage;
    }
    async close() {
        for (const worker of this.#workers) {
            await worker.stop();
        }
        for (const storage of this.#triggerStorage) {
            await storage.disconnect();
        }
    }
    get client() {
        if (this.#client === undefined) {
            this.#client = new mongodb_1.MongoClient(this.#opts.url, this.#opts.clientOpts);
        }
        return this.#client;
    }
    get #collectionName() {
        return this.#opts.collectionName ?? "workflow-states";
    }
}
exports.MongoEngine = MongoEngine;
function createEngine(opts) {
    return new MongoEngine(opts);
}
