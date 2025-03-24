import {Workflow} from "./types.ts";

export type OnErrorHook = (error: unknown) => void;

export interface Worker {
    start<State, Decorators>(workflows: Workflow<State, Decorators>[]): void
    addHook(hook: "onError", handler: OnErrorHook): this
    stop(): Promise<void>
}

export interface Trigger<TriggerOpts> {
    trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State, opts?: TriggerOpts): Promise<void>
}

export interface Engine<TriggerOpts> {
    createWorker(): Worker
    createTrigger(): Trigger<TriggerOpts>
}