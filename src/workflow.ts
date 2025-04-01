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
    plugin: RivrPlugin<Decorators, unknown, State>
    context: WorkflowImplementation
    opts: unknown
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

    plugins: RivrPlugin<unknown, unknown, unknown>[]

    autoPluginIndex: number
}

function WorkflowConstructor (this: WorkflowImplementation, name: string) {
    this[kWorkflow] = true
    this[kReady] = false
    this.name = name
    this.graph = []
    this.plugins = []
    this.autoPluginIndex = 0
}

WorkflowConstructor.prototype.step = function step(this: WorkflowImplementation, opts: StepOpts<unknown, unknown>) {
    const {
        maxAttempts = 1,
        optional = false,
        ...requiredFields
    } = opts

    this.graph.push({
        type: "step",
        step: {
            ...requiredFields,
            maxAttempts,
            optional
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

WorkflowConstructor.prototype.register = function register(this: WorkflowImplementation, plugin: RivrPlugin<unknown, unknown, unknown>, opts: unknown) {
    const nested = new (WorkflowConstructor as any)(this.name)
    Object.setPrototypeOf(nested, this)

    const {
        opts: {
            deps = [],
            name = `plugin-auto-${getRootWorkflow(this).autoPluginIndex ++}`
        } = {}
    } = plugin

    Object.defineProperty(plugin, "opts", {
        value: {
            deps,
            name
        }
    })

    this.graph.push({ type: "plugin", plugin, context: nested, opts })
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

    await executePlugins(root)

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

function getUnsatisfiedDeps (root: WorkflowImplementation, deps: RivrPlugin<unknown, unknown, unknown>[]): RivrPlugin<unknown, unknown, unknown>[] {
    const foundDeps = []
    let current = root

    do {
        for (const element of current.graph) {
            if (element.type === "plugin") {
                if (deps.includes(element.plugin)) {
                    foundDeps.push(element.plugin)
                }
            }
        }

        current = Object.getPrototypeOf(current)

    } while (foundDeps.length !== deps.length && kWorkflow in current)

    const diff = diffArrays(
      foundDeps,
      deps,
      (a, b) => a.opts?.name === b.opts?.name
    )

    return diff
}

function diffArrays<T>(a: T[], b: T[], equals: (a: T, b: T) => boolean): T[] {
    if (a.length === 0)
        return b

    if (b.length === 0)
        return a

    return a.filter(itemA => !b.some(itemB => equals(itemA, itemB)))
}

async function executePlugins (root: WorkflowImplementation) {
    for (const element of root.graph) {
        if (element.type === "plugin") {
            const {
                opts
            } = element.plugin

            const unsatisfiedDeps = opts?.deps && opts.deps.length > 0
                ? getUnsatisfiedDeps(root, opts.deps)
                : []

            if (
              opts?.deps &&
              opts.deps.length > 0 &&
              unsatisfiedDeps.length > 0
            ) {
                throw new Error(`Plugin "${opts.name}" needs "${unsatisfiedDeps[0]?.opts?.name}" to be registered`)
            }

            const currentPluginElements = [...element.context.graph]
            element.context.graph = []

            const pluginOpts = typeof element.opts === "function"
                ? element.opts(element.context)
                : element.opts

            element.plugin(element.context, pluginOpts)
            element.context.graph.push(...currentPluginElements)
            element.context[kReady] = true
            await executePlugins(element.context)
        }
    }
    root[kReady] = true
}

export const rivr = {
    workflow<State>(name: string): Workflow<State, Record<string, unknown>> {
        return new (WorkflowConstructor as any)(name)
    }
}
