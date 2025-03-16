import { Workflow } from "./core"

export type JobRecord<State> = {
    id: string
    workflow: string
    step: string
    ack: boolean
    state: State
}

export type AckJob<State> = {
    type: "ack"
    record: JobRecord<State>
}
export type InsertJob<State> = {
    type: "insert",
    record: Omit<JobRecord<State>, "id">
}
export type JobWrite<State> = AckJob<State> | InsertJob<State>

export type PullOpts<State> = {
    workflows: Workflow<State>[]
}

export interface Storage<State> {
    pull(opts: PullOpts<State>): Promise<JobRecord<State>[]>
    write(writes: JobWrite<State>[]): Promise<void>
}

export class InfiniteLoop {
    #stop: boolean = false;

    *[Symbol.iterator]() {
        while (!this.#stop) {
            yield
        }
    }

    stop(): void {
        this.#stop = true
    }
}