import {Workflow} from "./types.ts";

export type OnErrorHook = (error: unknown) => void;

export interface Worker {
    start<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<void>
    addHook(hook: "onError", handler: OnErrorHook): this
    stop(): Promise<void>
}

export type DefaultTriggerOpts = {
    /**
     * The ID of the workflow
     */
    id?: string
}

export interface Trigger<TriggerOpts extends DefaultTriggerOpts> {
    trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State, opts?: TriggerOpts): Promise<void>
}

export interface Engine<TriggerOpts extends DefaultTriggerOpts> {
    createWorker(): Worker
    createTrigger(): Trigger<TriggerOpts>
}