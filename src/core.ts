import {Workflow} from "./types.ts";

export type OnErrorHook = (error: unknown) => void;

export interface Worker {
    start<State, Decorators>(workflows: Workflow<State, Decorators>[]): void
    addHook(hook: "onError", handler: OnErrorHook): this
    stop(): Promise<void>
}

export interface Trigger {
    trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State): Promise<void>
}

export interface Engine {
    createWorker(): Worker
    createTrigger(): Trigger
}