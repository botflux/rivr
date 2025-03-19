export type HandlerOpts<State> = {
    state: State
}

export type Handler<State> = (opts: HandlerOpts<State>) => State

export type StepOpts<State> = {
    name: string
    handler: Handler<State>
}

export type OnWorkflowCompletedHook<State> = (workflow: Workflow<State>, state: State) => void

export interface Workflow<State> {
    name: string

    steps: StepOpts<State>[]
    onWorkflowCompleted: OnWorkflowCompletedHook<State>[]

    getFirstStep(): StepOpts<State> | undefined
    getStep(name: string): StepOpts<State> | undefined
    getNextStep(name: string): StepOpts<State> | undefined

    step(opts: StepOpts<State>): Workflow<State>
    addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State>): Workflow<State>
}

function WorkflowConstructor<State> (this: Workflow<State>, name: string) {
    this.name = name
    this.steps = []
    this.onWorkflowCompleted = []
}

WorkflowConstructor.prototype.step = function step(this: Workflow<unknown>, opts: StepOpts<unknown>) {
    this.steps.push(opts)
    return this
}

WorkflowConstructor.prototype.addHook = function addHook(this: Workflow<unknown>, hook: string, handler: OnWorkflowCompletedHook<unknown>) {
    this.onWorkflowCompleted.push(handler)
    return this
}

WorkflowConstructor.prototype.getFirstStep = function getFirstStep(this: Workflow<unknown>) {
    return this.steps[0]
}

WorkflowConstructor.prototype.getStep = function getStep(this: Workflow<unknown>, name: string) {
    return this.steps.find(s => s.name === name)
}

WorkflowConstructor.prototype.getNextStep = function getNextStep(this: Workflow<unknown>, name: string) {
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
    workflow<State>(name: string): Workflow<State> {
        return new (WorkflowConstructor as any)(name)
    }
}

