export type HandlerOpts<State, Decorators> = {
    state: State
    workflow: Workflow<State, Decorators>
}

export type Handler<State, Decorators> = (opts: HandlerOpts<State, Decorators>) => State

export type StepOpts<State, Decorators> = {
    name: string
    handler: Handler<State, Decorators>
}

export type OnWorkflowCompletedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, state: State) => void

export type Workflow<State, Decorators> = {
    name: string

    steps: StepOpts<State, Decorators>[]
    onWorkflowCompleted: OnWorkflowCompletedHook<State, Decorators>[]

    getFirstStep(): StepOpts<State, Decorators> | undefined
    getStep(name: string): StepOpts<State, Decorators> | undefined
    getNextStep(name: string): StepOpts<State, Decorators> | undefined

    decorate<K extends string, V>(key: K, value: V): Workflow<State, Decorators & Record<K, V>>

    step(opts: StepOpts<State, Decorators>): Workflow<State, Decorators>
    addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, Decorators>): Workflow<State, Decorators>
} & Decorators

function WorkflowConstructor<State, Decorators> (this: Workflow<State, Decorators>, name: string) {
    this.name = name
    this.steps = []
    this.onWorkflowCompleted = []
}

WorkflowConstructor.prototype.step = function step(this: Workflow<unknown, unknown>, opts: StepOpts<unknown, unknown>) {
    this.steps.push(opts)
    return this
}

WorkflowConstructor.prototype.addHook = function addHook(this: Workflow<unknown, unknown>, hook: string, handler: OnWorkflowCompletedHook<unknown, unknown>) {
    this.onWorkflowCompleted.push(handler)
    return this
}

WorkflowConstructor.prototype.decorate = function decorate(this: Workflow<unknown, unknown>, key: string, value: unknown) {
    // @ts-expect-error
    this[key] = value
    return this
}

WorkflowConstructor.prototype.getFirstStep = function getFirstStep(this: Workflow<unknown, unknown>) {
    return this.steps[0]
}

WorkflowConstructor.prototype.getStep = function getStep(this: Workflow<unknown, unknown>, name: string) {
    return this.steps.find(s => s.name === name)
}

WorkflowConstructor.prototype.getNextStep = function getNextStep(this: Workflow<unknown, unknown>, name: string) {
    const stepIndex = this.steps.findIndex(s => s.name === name)
    
    if (stepIndex === -1) {
        throw new Error(`Cannot find the next step of '${name}' because there is no step named '${name}'`)
    }

    const newIndex = stepIndex + 1

    if (newIndex >= this.steps.length) {
        return undefined
    }

    return this.steps[newIndex]
}

export const rivr = {
    workflow<State>(name: string): Workflow<State, Record<string, unknown>> {
        return new (WorkflowConstructor as any)(name)
    }
}

