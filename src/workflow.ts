import {
    kWorkflow,
    OnStepCompletedHook,
    OnStepErrorHook,
    OnStepSkippedHook,
    OnWorkflowCompletedHook,
    OnWorkflowFailedHook,
    OnWorkflowStoppedHook,
    Step,
    StepOpts,
    Workflow
} from "./types.ts";
import {RivrPlugin} from "./plugin.ts";

class WorkflowNotReadyError extends Error {
    constructor(name: string) {
        super(`The workflow ${name} is not ready, please call '.ready()'`);
    }
}

export const kReady = Symbol("kReady");

export type StepElement<State, Decorators> = {
    type: "step",
    step: Step<State, Decorators>
    context: WorkflowImplementation
}
export type StepCompletedElement<State, Decorators> = {
    type: "onStepCompleted",
    hook: OnStepCompletedHook<State, Decorators>
    context: WorkflowImplementation
}
export type StepErrorElement<State, Decorators> = {
    type: "onStepError",
    hook: OnStepErrorHook<State, Decorators>
    context: WorkflowImplementation
}
export type StepSkippedElement<State, Decorators> = {
    type: "onStepSkipped",
    hook: OnStepSkippedHook<State, Decorators>
    context: WorkflowImplementation
}
export type WorkflowCompletedElement<State, Decorators> = {
    type: "onWorkflowCompleted",
    hook: OnWorkflowCompletedHook<State, Decorators>
    context: WorkflowImplementation
}
export type WorkflowStoppedElement<State, Decorators> = {
    type: "onWorkflowStopped",
    hook: OnWorkflowStoppedHook<State, Decorators>
    context: WorkflowImplementation
}
export type WorkflowFailedElement<State, Decorators> = {
    type: "onWorkflowFailed",
    hook: OnWorkflowFailedHook<State, Decorators>
    context: WorkflowImplementation
}
export type WorkflowPluginElement<State, Decorators> = {
    type: "plugin",
    plugin: RivrPlugin<Decorators, State>
    context: WorkflowImplementation
}

export type UnreadyExecutionGraph<State, Decorators> =
  | StepElement<State, Decorators>
  | StepCompletedElement<State, Decorators>
  | WorkflowCompletedElement<State, Decorators>
  | StepErrorElement<State, Decorators>
  | StepSkippedElement<State, Decorators>
  | WorkflowStoppedElement<State, Decorators>
  | WorkflowFailedElement<State, Decorators>
  | WorkflowPluginElement<State, Decorators>

interface WorkflowImplementation extends Workflow<unknown, unknown> {
    [kReady]: boolean

    /**
     * A tree containing the steps and sub-workflow in order.
     * Iterating through this tree depth-first would yield the steps in order.
     */
    graph: UnreadyExecutionGraph<unknown, unknown>[]

    plugins: RivrPlugin<unknown, unknown>[]
}

function WorkflowConstructor (this: WorkflowImplementation, name: string) {
    this[kWorkflow] = true
    this[kReady] = false
    this.name = name
    this.graph = []
    this.plugins = []
}

WorkflowConstructor.prototype.step = function step(this: WorkflowImplementation, opts: StepOpts<unknown, unknown>) {
    const {
        maxAttempts = 1,
        ...requiredFields
    } = opts

    this.graph.push({
        type: "step",
        step: {
            ...requiredFields,
            maxAttempts,
        },
        context: this
    })

    return this
}

WorkflowConstructor.prototype.getHook = function* getHook(this: WorkflowImplementation, hook: "onStepCompleted") {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    const root = getRootWorkflow(this)

    for (const element of iterateDepthFirst(root)) {
        if (element.type === hook) {
            yield [ element.hook, element.context ] as const
        }
    }
}

WorkflowConstructor.prototype.addHook = function addHook(this: WorkflowImplementation, hook: string, handler: Function) {
    switch(hook) {
        case "onWorkflowCompleted":
            this.graph.push({
                type: "onWorkflowCompleted",
                hook: handler as OnWorkflowCompletedHook<unknown, unknown>,
                context: this
            })
            break
        case "onStepError":
            this.graph.push({
                type: "onStepError",
                hook: handler as OnStepErrorHook<unknown, unknown>,
                context: this
            })
            break

        case "onStepSkipped":
            this.graph.push({
                type: "onStepSkipped",
                hook: handler as OnStepSkippedHook<unknown, unknown>,
                context: this
            })
            break

        case "onWorkflowStopped":
            this.graph.push({
                type: "onWorkflowStopped",
                hook: handler as OnWorkflowStoppedHook<unknown, unknown>,
                context: this
            })
            break

        case "onStepCompleted":
            this.graph.push({
                type: "onStepCompleted",
                hook: handler as OnStepCompletedHook<unknown, unknown>,
                context: this
            })
            break

        case "onWorkflowFailed":
            this.graph.push({
                type: "onWorkflowFailed",
                hook: handler as OnWorkflowFailedHook<unknown, unknown>,
                context: this
            })
            break

        default:
            throw new Error(`Hook type '${hook}' is not supported`)
    }
    return this
}

WorkflowConstructor.prototype.steps = function *steps (this: WorkflowImplementation): Iterable<[ Step<unknown, unknown>, WorkflowImplementation ]> {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    const root = getRootWorkflow(this)

    for (const step of listStepDepthFirst(root)) {
        yield step
    }
}

WorkflowConstructor.prototype.register = function register(this: WorkflowImplementation, plugin: (workflow: WorkflowImplementation) => WorkflowImplementation) {
    // const deps = "deps" in plugin
    //     ? plugin.deps as RivrPlugin<unknown, unknown>[]
    //     : []
    //
    // if (deps.length > 0) {
    //     const fulfilled: RivrPlugin<unknown, unknown>[] = []
    //
    //     for (const context of iterateFromChild(this)) {
    //         for (const plugin of context.plugins) {
    //             if (deps.includes(plugin)) {
    //                 fulfilled.push(plugin)
    //             }
    //         }
    //     }
    //
    //     if (deps.length !== fulfilled.length) {
    //         throw new Error("A plugin is missing its dependency")
    //     }
    //
    //
    //     // iterate over this instance's deps
    //     // if not all deps fulfilled, then move to the parent
    //     // if root reached and deps not fulfilled, then throw
    // }
    //
    // const newContext = new (WorkflowConstructor as any)(this.name)
    // Object.setPrototypeOf(newContext, this)
    // plugin(newContext)
    const nested = new (WorkflowConstructor as any)(this.name)
    Object.setPrototypeOf(nested, this)

    this.graph.push({ type: "plugin", plugin, context: nested })
    // this.plugins.push(plugin)
    return nested
}

WorkflowConstructor.prototype.decorate = function decorate(this: WorkflowImplementation, key: string, value: unknown) {
    // @ts-expect-error
    this[key] = value
    return this
}

WorkflowConstructor.prototype.getFirstStep = function getFirstStep(this: WorkflowImplementation) {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    for (const [ step ] of this.steps()) {
        return step
    }
}

WorkflowConstructor.prototype.getStep = function getStep(this: WorkflowImplementation, name: string) {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    for (const [ step ] of this.steps()) {
        if (name === step.name)
            return step
    }
}

WorkflowConstructor.prototype.getStepAndExecutionContext = function getStepAndExecutionContext(this: WorkflowImplementation, name: string) {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    for (const [ step, context ] of this.steps()) {
        if (name === step.name)
            return [step, context] as const
    }
}

WorkflowConstructor.prototype.getNextStep = function getNextStep(this: WorkflowImplementation, name: string) {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

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

WorkflowConstructor.prototype.ready = async function ready(this: WorkflowImplementation) {
    const root = getRootWorkflow(this)

    if (root[kReady]) {
        return this
    }

    await prepareGraph(root)

    return this
}

function* iterateDepthFirst(w: WorkflowImplementation): Iterable<StepElement<unknown, unknown> | WorkflowFailedElement<unknown, unknown> | WorkflowStoppedElement<unknown, unknown> | StepSkippedElement<unknown, unknown> | StepErrorElement<unknown, unknown> | WorkflowCompletedElement<unknown, unknown> | StepCompletedElement<unknown, unknown>> {
    for (const element of w.graph) {
        if (element.type === "plugin") {
            for (const nested of iterateDepthFirst(element.context as WorkflowImplementation)) {
                yield nested
            }
        } else {
            yield element
        }
    }
}

export function getRootWorkflow (w: WorkflowImplementation): WorkflowImplementation {
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
        } else if (element.type === "plugin") {
            for (const elem of listStepDepthFirst(element.context as WorkflowImplementation)) {
                yield elem
            }
        }
    }
}

async function prepareGraph (root: WorkflowImplementation) {
    for (const element of root.graph) {
        if (element.type === "plugin") {
            const currentPluginElements = [...element.context.graph]
            element.context.graph = []
            element.plugin(element.context)
            element.context.graph.push(...currentPluginElements)
            element.context[kReady] = true
            await prepareGraph(element.context)
        }
    }
    root[kReady] = true
}
export const rivr = {
    workflow<State>(name: string): Workflow<State, Record<string, unknown>> {
        return new (WorkflowConstructor as any)(name)
    }
}
