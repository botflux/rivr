import {
    kWorkflow,
    OnStepCompletedHook,
    OnStepErrorHook,
    OnStepSkippedHook,
    OnWorkflowCompletedHook,
    OnWorkflowStoppedHook,
    StepCompletedElement,
    StepElement,
    StepErrorElement,
    Step,
    StepSkippedElement,
    Workflow,
    WorkflowCompletedElement,
    WorkflowStoppedElement,
    StepOpts,
    OnWorkflowFailedHook,
    WorkflowFailedElement,
    ExecutionGraph
} from "./types.ts";

interface WorkflowImplementation extends Workflow<unknown, unknown> {
    /**
     * A tree containing the steps and sub-workflow in order.
     * Iterating through this tree depth-first would yield the steps in order.
     */
    graph: ExecutionGraph<unknown, unknown>[]
}

function WorkflowConstructor (this: WorkflowImplementation, name: string) {
    this[kWorkflow] = true
    this.name = name
    this.graph = []
}

WorkflowConstructor.prototype.step = function step(this: WorkflowImplementation, opts: StepOpts<unknown, unknown>) {
    const {
        maxAttempts = 1,
        ...requiredFields
    } = opts

    this.graph.push({ type: "step", step: { ...requiredFields, maxAttempts } })
    return this
}

function* iterateDepthFirst(w: WorkflowImplementation): Iterable<StepElement<unknown, unknown> | WorkflowFailedElement<unknown, unknown> | WorkflowStoppedElement<unknown, unknown> | StepSkippedElement<unknown, unknown> | StepErrorElement<unknown, unknown> | WorkflowCompletedElement<unknown, unknown> | StepCompletedElement<unknown, unknown>> {
    for (const element of w.graph) {
        if (element.type === "context") {
            for (const nested of iterateDepthFirst(element.context as WorkflowImplementation)) {
                yield nested
            }
        } else {
            yield element
        }
    }
}

WorkflowConstructor.prototype.getHook = function* getHook(this: WorkflowImplementation, hook: "onStepCompleted") {
    const root = getRootWorkflow(this)

    for (const element of iterateDepthFirst(root)) {
        if (element.type === hook) {
            yield element.hook
        }
    }
}

WorkflowConstructor.prototype.addHook = function addHook(this: WorkflowImplementation, hook: string, handler: Function) {
    switch(hook) {
        case "onWorkflowCompleted":
            this.graph.push({ type: "onWorkflowCompleted", hook: handler as OnWorkflowCompletedHook<unknown, unknown> })
            break
        case "onStepError":
            this.graph.push({ type: "onStepError", hook: handler as OnStepErrorHook<unknown, unknown> })
            break

        case "onStepSkipped":
            this.graph.push({ type: "onStepSkipped", hook: handler as OnStepSkippedHook<unknown, unknown> })
            break

        case "onWorkflowStopped":
            this.graph.push({ type: "onWorkflowStopped", hook: handler as OnWorkflowStoppedHook<unknown, unknown> })
            break

        case "onStepCompleted":
            this.graph.push({ type: "onStepCompleted", hook: handler as OnStepCompletedHook<unknown, unknown> })
            break

        case "onWorkflowFailed":
            this.graph.push({ type: "onWorkflowFailed", hook: handler as OnWorkflowFailedHook<unknown, unknown> })
            break

        default:
            throw new Error(`Hook type '${hook}' is not supported`)
    }
    return this
}

function getRootWorkflow (w: WorkflowImplementation): WorkflowImplementation {
    const proto = Object.getPrototypeOf(w)
    const isRoot = !(kWorkflow in proto)

    if (isRoot) {
        return w
    }

    return getRootWorkflow(proto)
}

function* listStepDepthFirst(w: WorkflowImplementation): Iterable<[ step: Step<unknown, unknown>, context: WorkflowImplementation ]> {
    for (const element of w.graph) {
        if (element.type === "step") {
            yield [element.step, w]
        } else if (element.type === "context") {
            for (const elem of listStepDepthFirst(element.context as WorkflowImplementation)) {
                yield elem
            }
        }
    }
}

WorkflowConstructor.prototype.steps = function *steps (this: WorkflowImplementation): Iterable<[ Step<unknown, unknown>, WorkflowImplementation ]> {
    const root = getRootWorkflow(this)

    for (const step of listStepDepthFirst(root)) {
        yield step
    }
}

WorkflowConstructor.prototype.register = function register(this: WorkflowImplementation, plugin: (workflow: WorkflowImplementation) => WorkflowImplementation) {
    const newContext = new (WorkflowConstructor as any)(this.name)
    Object.setPrototypeOf(newContext, this)
    plugin(newContext)
    this.graph.push({ type: "context", context: newContext })
    return newContext
}

WorkflowConstructor.prototype.decorate = function decorate(this: WorkflowImplementation, key: string, value: unknown) {
    // @ts-expect-error
    this[key] = value
    return this
}

WorkflowConstructor.prototype.getFirstStep = function getFirstStep(this: WorkflowImplementation) {
    for (const [ step ] of this.steps()) {
        return step
    }
}

WorkflowConstructor.prototype.getStep = function getStep(this: WorkflowImplementation, name: string) {
    for (const [ step ] of this.steps()) {
        if (name === step.name)
            return step
    }
}

WorkflowConstructor.prototype.getNextStep = function getNextStep(this: WorkflowImplementation, name: string) {
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
}

export const rivr = {
    workflow<State>(name: string): Workflow<State, Record<string, unknown>> {
        return new (WorkflowConstructor as any)(name)
    }
}
