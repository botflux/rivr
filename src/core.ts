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

export type SuccessResult<State> = {
    type: "success"
    newState: State
}
export type FailureResult = {
    type: "failure"
    error: unknown
}
export type HandlerResult<State> = SuccessResult<State> | FailureResult

export type HandlerContext<State> = { 
    state: State
    success: (newState: State) => HandlerResult<State>
}

export type Handler<State> = (ctx: HandlerContext<State>) => State | HandlerResult<State>

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

    isLastStep(name: string): boolean {
        const last = this.#steps[this.#steps.length - 1]

        if (last === undefined) {
            throw new Error("No steps in the workflow")
        }

        return last.name === name
    }

    getNextStep(name: string): StepOpts<State> | undefined {
        const index = this.#steps.findIndex(s => s.name === name)

        if (index === -1) {
            throw new Error(`No step matching '${name}'`)
        }

        const newIndex = index + 1

        if (newIndex >= this.#steps.length) {
            return undefined
        }

        return this.#steps[index + 1]
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