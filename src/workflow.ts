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

export type Plugin<State, Decorators, NewDecorators> = (workflow: Workflow<State, Decorators>) => Workflow<State, NewDecorators>

export type ExecutionGraph<State, Decorators> = 
    | { type: "step", step: StepOpts<State, Decorators> }
    | { type: "context", context: Workflow<State, Decorators> }

const kWorkflow = Symbol("kWorkflow")

export type Workflow<State, Decorators> = {
    [kWorkflow]: true

    name: string

    graph: ExecutionGraph<State, Decorators>[]

    onWorkflowCompleted: OnWorkflowCompletedHook<State, Decorators>[]

    getFirstStep(): StepOpts<State, Decorators> | undefined
    getStep(name: string): StepOpts<State, Decorators> | undefined
    getNextStep(name: string): StepOpts<State, Decorators> | undefined

    decorate<K extends string, V>(key: K, value: V): Workflow<State, Decorators & Record<K, V>>

    register<NewDecorators>(plugin: Plugin<State, Decorators, NewDecorators>): Workflow<State, NewDecorators>

    steps(): Iterable<[ step: StepOpts<State, Decorators>, context: Workflow<State, Decorators> ]>

    step(opts: StepOpts<State, Decorators>): Workflow<State, Decorators>
    addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, Decorators>): Workflow<State, Decorators>
} & Decorators

function WorkflowConstructor<State, Decorators> (this: Workflow<State, Decorators>, name: string) {
    this[kWorkflow] = true
    this.name = name
    this.onWorkflowCompleted = []
    this.graph = []
}

WorkflowConstructor.prototype.step = function step(this: Workflow<unknown, unknown>, opts: StepOpts<unknown, unknown>) {
    this.graph.push({ type: "step", step: opts })
    return this
}

WorkflowConstructor.prototype.addHook = function addHook(this: Workflow<unknown, unknown>, hook: string, handler: OnWorkflowCompletedHook<unknown, unknown>) {
    this.onWorkflowCompleted.push(handler)
    return this
}

function getRootWorkflow (w: Workflow<unknown, unknown>): Workflow<unknown, unknown> {
    const proto = Object.getPrototypeOf(w)
    const isRoot = !(kWorkflow in proto)

    if (isRoot) {
        return w
    }

    return getRootWorkflow(proto)
}

function* listStepDepthFirst(w: Workflow<unknown, unknown>): Iterable<[ step: StepOpts<unknown, unknown>, context: Workflow<unknown, unknown> ]> {
    for (const element of w.graph) {
        if (element.type === "step") {
            yield [element.step, w]
        } else {
            for (const elem of listStepDepthFirst(element.context)) {
                yield elem
            }
        }
    }
}

WorkflowConstructor.prototype.steps = function *steps (this: Workflow<unknown, unknown>) {
    const root = getRootWorkflow(this)

    for (const step of listStepDepthFirst(root)) {
        yield step
    }
}

WorkflowConstructor.prototype.register = function register(this: Workflow<unknown, unknown>, plugin: (workflow: Workflow<unknown, unknown>) => Workflow<unknown, unknown>) {
    const newContext = new (WorkflowConstructor as any)(this.name)
    Object.setPrototypeOf(newContext, this)
    plugin(newContext)
    this.graph.push({ type: "context", context: newContext })
    return newContext
}

WorkflowConstructor.prototype.decorate = function decorate(this: Workflow<unknown, unknown>, key: string, value: unknown) {
    // @ts-expect-error
    this[key] = value
    return this
}

WorkflowConstructor.prototype.getFirstStep = function getFirstStep(this: Workflow<unknown, unknown>) {
    for (const [ step ] of this.steps()) {
        return step
    }
}

WorkflowConstructor.prototype.getStep = function getStep(this: Workflow<unknown, unknown>, name: string) {
    for (const [ step ] of this.steps()) {
        if (name === step.name)
            return step
    }
}

WorkflowConstructor.prototype.getNextStep = function getNextStep(this: Workflow<unknown, unknown>, name: string) {
    let found = false

    for (const [ step ] of this.steps()) {
        if (name === step.name) {
            found = true
            continue
        }

        if (found) {
            return step
        }
    }

    if (!found) {
        throw new Error(`Cannot find the next step of '${name}' because there is no step named '${name}'`)
    }

    // const stepIndex = this.steps.findIndex(s => s.name === name)
    //
    // if (stepIndex === -1) {
    //     throw new Error(`Cannot find the next step of '${name}' because there is no step named '${name}'`)
    // }
    //
    // const newIndex = stepIndex + 1
    // 
    // if (newIndex >= this.steps.length) {
    //     return undefined
    // }
    // 
    // return this.steps[newIndex]
}

export const rivr = {
    workflow<State>(name: string): Workflow<State, Record<string, unknown>> {
        return new (WorkflowConstructor as any)(name)
    }
}

