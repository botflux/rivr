import { type Workflow } from "./workflow.ts"

export interface Worker {
    start<State, Decorators>(workflows: Workflow<State, Decorators>[]): void
    stop(): Promise<void>
}

export interface Trigger {
    trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State): Promise<void>
}

export interface Engine {
    createWorker(): Worker
    createTrigger(): Trigger
}