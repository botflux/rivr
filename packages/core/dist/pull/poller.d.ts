import { DefaultTriggerOpts, OnErrorHook, type Trigger, type Worker } from "../engine";
import { Workflow } from "../types";
import { WorkflowState } from "./state";
export type Insert<State> = {
    type: "insert";
    state: WorkflowState<State>;
};
export type Update<State> = {
    type: "update";
    state: WorkflowState<State>;
};
export type Write<State> = Update<State> | Insert<State>;
export type PullOpts = {
    limit: number;
};
export interface Storage<WriteOpts> {
    pull<State, Decorators>(workflows: Workflow<State, Decorators>[], opts: PullOpts): Promise<WorkflowState<State>[]>;
    write<State>(writes: Write<State>[], opts?: WriteOpts): Promise<void>;
    findById<State>(id: string): Promise<WorkflowState<State> | undefined>;
    disconnect(): Promise<void>;
}
export declare class PullTrigger<TriggerOpts extends DefaultTriggerOpts> implements Trigger<TriggerOpts> {
    #private;
    constructor(storage: Storage<TriggerOpts>);
    trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State, opts?: TriggerOpts): Promise<WorkflowState<State>>;
}
export declare class Poller<TriggerOpts> implements Worker {
    #private;
    constructor(storage: Storage<TriggerOpts>, delayBetweenPulls: number, countPerPull: number);
    start<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<void>;
    addHook(hook: "onError", handler: OnErrorHook): this;
    stop(): Promise<void>;
}
