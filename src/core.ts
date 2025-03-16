import EventEmitter from "node:events"

export interface Worker {
    start(workflows: Workflow<any>[]): void
}

export interface Trigger {
    trigger<State>(workflow: Workflow<State>, state: State): Promise<void>
}

export interface Engine {
    createWorker(): Worker
    createTrigger(): Trigger
}

export type HandlerContext<State> = { state: State }
export type Handler<State> = (ctx: HandlerContext<State>) => State

export type StepOpts<State> = {
    name: string
    handler: Handler<State>
}

export class Workflow<State, Ctx extends Record<string, unknown> = Record<string, unknown>> extends EventEmitter {
    name: string

    #steps: StepOpts<State>[] = []

    constructor(name: string) {
        super()
        this.name = name
    }

    step(opts: StepOpts<State>): this {
        this.#steps.push(opts)
        return this
    }

    getStep(name: string): StepOpts<State> | undefined {
        return this.#steps.find(s => s.name === name)
    }

    get steps (): StepOpts<State>[] {
        return this.#steps
    }
}

export const rivr = {
    workflow<State>(name: string): Workflow<State> {
        return new Workflow(name)
    }
}