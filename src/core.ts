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

export interface Trigger<TriggerOpts extends Record<never, never>> {
    trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State, opts?: TriggerOpts & DefaultTriggerOpts): Promise<void>
}

export interface Engine<TriggerOpts extends Record<never, never>> {
    createWorker(): Worker
    createTrigger(): Trigger<TriggerOpts>
}