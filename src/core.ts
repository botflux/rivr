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
export type SkipResult = {
    type: "skip"
}
export type StopResult = {
    type: "stop"
}
export type HandlerResult<State> = SuccessResult<State> | FailureResult | SkipResult | StopResult

export type HandlerContext<State, W extends Workflow<State>> = { 
    state: State
    workflow: W
    success: (newState: State) => HandlerResult<State>
    fail: (error: unknown) => HandlerResult<State>
    skip: () => HandlerResult<State>
    stop: () => HandlerResult<State>
}

export type Handler<State, W extends Workflow<State>> = (ctx: HandlerContext<State, W>) => State | HandlerResult<State>

export type StepOpts<State, W extends Workflow<State>> = {
    name: string
    handler: Handler<State, W>
}

export class Workflow<State, Ctx extends Record<string, unknown> = Record<string, unknown>> extends EventEmitter {
    name: string

    #steps: StepOpts<State, Workflow<State>>[] = []

    constructor(name: string) {
        super()
        this.name = name
    }

    step(opts: StepOpts<State, this>): this {
        this.#steps.push(opts as StepOpts<State, Workflow<State>>)
        return this
    }

    decorate<K extends string, V>(key: K, value: V): Workflow<State, Ctx> & Record<K, V> {
        // @ts-expect-error
        Workflow.prototype[key] = undefined
        // @ts-expect-error
        this[key] = value
        return this as unknown as Workflow<State, Ctx> & Record<K, V>
    }

    getStep(name: string): StepOpts<State, this> | undefined {
        return this.#steps.find(s => s.name === name)
    }

    isLastStep(name: string): boolean {
        const last = this.#steps[this.#steps.length - 1]

        if (last === undefined) {
            throw new Error("No steps in the workflow")
        }

        return last.name === name
    }

    getNextStep(name: string, offset = 1): StepOpts<State, this> | undefined {
        const index = this.#steps.findIndex(s => s.name === name)

        if (index === -1) {
            throw new Error(`No step matching '${name}'`)
        }

        const newIndex = index + offset

        if (newIndex >= this.#steps.length) {
            return undefined
        }

        return this.#steps[newIndex]
    }

    get steps (): StepOpts<State, this>[] {
        return this.#steps
    }
}

export const rivr = {
    workflow<State>(name: string): Workflow<State> {
        return new Workflow(name)
    }
}