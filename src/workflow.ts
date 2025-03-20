export type Success<State> = {
    type: "success"
    state: State
}

export type Failure = {
    type: "failure"
    error: unknown
}

export type StepResult<State> = 
    | Success<State>
    | Failure

export type HandlerOpts<State, Decorators> = {
    state: State
    workflow: Workflow<State, Decorators>
    ok: (state: State) => Success<State>
    err: (error: unknown) => Failure
}

export type Handler<State, Decorators> = (opts: HandlerOpts<State, Decorators>) => State

export type StepOpts<State, Decorators> = {
    name: string
    handler: Handler<State, Decorators>
}

export type OnWorkflowCompletedHook<State, Decorators> = (workflow: Workflow<State, Decorators>, state: State) => void
export type OnStepErrorHook<State, Decorators> = (error: unknown, workflow: Workflow<State, Decorators>, state: State) => void

export type Plugin<State, Decorators, NewDecorators> = (workflow: Workflow<State, Decorators>) => Workflow<State, NewDecorators>

export type ExecutionGraph<State, Decorators> = 
    | { type: "step", step: StepOpts<State, Decorators> }
    | { type: "context", context: Workflow<State, Decorators> }

const kWorkflow = Symbol("kWorkflow")

export type Workflow<State, Decorators> = {
    /**
     * A flag to discriminates if an object is a workflow.
     */
    [kWorkflow]: true

    /**
     * The name of the workflow.
     */
    name: string

    /**
     * A tree containing the steps and sub-workflow in order.
     * Iterating through this tree depth-first would yield the steps in order.
     */
    graph: ExecutionGraph<State, Decorators>[]

    /**
     * Hooks to execute once a workflow is completed.
     */
    onWorkflowCompleted: OnWorkflowCompletedHook<State, Decorators>[]

    /**
     * Hooks to execute for each step error.
     */
    onStepError: OnStepErrorHook<State, Decorators>[]

    /**
     * Get this workflow's first step.
     * Returns `undefined` if the workflow is empty.
     */
    getFirstStep(): StepOpts<State, Decorators> | undefined

    /**
     * Search a step by its name.
     * Returns `undefined` if there is no step matching the given name.
     * 
     * @param name 
     */
    getStep(name: string): StepOpts<State, Decorators> | undefined

    /**
     * Search the step succeding the step matching the given name.
     * `undefined` is returned if there is no next step.
     * An error is thrown if there is no step matching the given name.
     * 
     * @param name 
     */
    getNextStep(name: string): StepOpts<State, Decorators> | undefined

    /**
     * Add a property to the current workflow.
     * 
     * @param key 
     * @param value 
     */
    decorate<K extends string, V>(key: K, value: V): Workflow<State, Decorators & Record<K, V>>

    /**
     * Register a plugin.
     * 
     * @param plugin
     */
    register<NewDecorators>(plugin: Plugin<State, Decorators, NewDecorators>): Workflow<State, NewDecorators>

    /**
     * Iterate over each step.
     * The iterator yields a tuple containing the step, and the context within which the step must be executed.
     */
    steps(): Iterable<[ step: StepOpts<State, Decorators>, context: Workflow<State, Decorators> ]>

    /**
     * Add a step
     * 
     * @param opts
     */
    step(opts: StepOpts<State, Decorators>): Workflow<State, Decorators>

    /**
     * Hook on workflow completed.
     * 
     * @param hook 
     * @param handler 
     */
    addHook(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, Decorators>): Workflow<State, Decorators>

    /**
     * Hook on step error.
     * 
     * @param hook 
     * @param handler 
     */
    addHook(hook: "onStepError", handler: OnStepErrorHook<State, Decorators>): Workflow<State, Decorators>
} & Decorators

function WorkflowConstructor<State, Decorators> (this: Workflow<State, Decorators>, name: string) {
    this[kWorkflow] = true
    this.name = name
    this.onWorkflowCompleted = []
    this.onStepError = []
    this.graph = []
}

WorkflowConstructor.prototype.step = function step(this: Workflow<unknown, unknown>, opts: StepOpts<unknown, unknown>) {
    this.graph.push({ type: "step", step: opts })
    return this
}

WorkflowConstructor.prototype.addHook = function addHook(this: Workflow<unknown, unknown>, hook: string, handler: Function) {
    switch(hook) {
        case "onWorkflowCompleted":
            this.onWorkflowCompleted.push(handler as OnWorkflowCompletedHook<unknown, unknown>)
            break
        case "onStepError":
            this.onStepError.push(handler as OnStepErrorHook<unknown, unknown>)
            break

        default:
            throw new Error(`Hook type '${hook}' is not supported`)
    }
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
