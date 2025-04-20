import { DefaultTriggerOpts, Engine, type Trigger, type Worker, type Storage } from "rivr";
import { ClientSession, MongoClient, MongoClientOptions } from "mongodb";
export type WriteOpts = {
    session?: ClientSession;
} & DefaultTriggerOpts;
export declare class MongoEngine implements Engine<WriteOpts> {
    #private;
    constructor(opts: CreateEngineOpts);
    createWorker(): Worker;
    createTrigger(): Trigger<WriteOpts>;
    createStorage(): Storage<WriteOpts>;
    close(): Promise<void>;
    get client(): MongoClient;
}
export type CreateEngineOpts = {
    url: string;
    clientOpts?: MongoClientOptions;
    dbName: string;
    collectionName?: string;
    signal?: AbortSignal;
    /**
     * The delay between state pulls.
     *
     * Note that this delay is waited only if an incomplete or empty
     * page is pulled.
     *
     * @default {1_000} 1000ms by default
     */
    delayBetweenPulls?: number;
    /**
     * The number of states retrieved for each pull.
     *
     * @default {20}
     */
    countPerPull?: number;
};
export declare function createEngine(opts: CreateEngineOpts): MongoEngine;
