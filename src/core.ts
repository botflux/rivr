import { Workflow } from "./workflow"

export interface Worker {
    start<State>(workflows: Workflow<State>[]): void
    stop(): Promise<void>
}

export interface Trigger {
    trigger<State>(workflow: Workflow<State>, state: State): Promise<void>
}

export interface Engine {
    createWorker(): Worker
    createTrigger(): Trigger
}