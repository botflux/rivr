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

const kReady = Symbol("kReady");
const kPluginAutoId = Symbol("kPluginAutoId");
const kGraph = Symbol("kGraph");
const kRegisteredDecorators = Symbol("kRegisteredDecorators")

type StepElement<State, Decorators> = {
    type: "step",
    step: Step<State, Decorators>
    context: WorkflowImpl
}
type StepCompletedElement<State, Decorators> = {
    type: "onStepCompleted",
    hook: OnStepCompletedHook<State, Decorators>
    context: WorkflowImpl
}
type StepErrorElement<State, Decorators> = {
    type: "onStepError",
    hook: OnStepErrorHook<State, Decorators>
    context: WorkflowImpl
}
type StepSkippedElement<State, Decorators> = {
    type: "onStepSkipped",
    hook: OnStepSkippedHook<State, Decorators>
    context: WorkflowImpl
}
type WorkflowCompletedElement<State, Decorators> = {
    type: "onWorkflowCompleted",
    hook: OnWorkflowCompletedHook<State, Decorators>
    context: WorkflowImpl
}
type WorkflowStoppedElement<State, Decorators> = {
    type: "onWorkflowStopped",
    hook: OnWorkflowStoppedHook<State, Decorators>
    context: WorkflowImpl
}
type WorkflowFailedElement<State, Decorators> = {
    type: "onWorkflowFailed",
    hook: OnWorkflowFailedHook<State, Decorators>
    context: WorkflowImpl
}
type WorkflowPluginElement<State, Decorators> = {
    type: "plugin",
    plugin: RivrPlugin<Decorators, unknown, State>
    context: WorkflowImpl
    opts: unknown
}

type GraphElement<State, Decorators> =
  | StepElement<State, Decorators>
  | StepCompletedElement<State, Decorators>
  | WorkflowCompletedElement<State, Decorators>
  | StepErrorElement<State, Decorators>
  | StepSkippedElement<State, Decorators>
  | WorkflowStoppedElement<State, Decorators>
  | WorkflowFailedElement<State, Decorators>
  | WorkflowPluginElement<State, Decorators>

type GraphWithoutPlugin<State, Decorators> = Exclude<GraphElement<State, Decorators>, WorkflowPluginElement<State, Decorators>>

interface WorkflowImpl extends Workflow<unknown, unknown> {
    [kReady]: boolean
    /**
     * A tree containing the steps and sub-workflow in order.
     * Iterating through this tree depth-first would yield the steps in order.
     */
    [kGraph]: GraphElement<unknown, unknown>[]
    [kPluginAutoId]: number
    [kRegisteredDecorators]: string[]
}

function WorkflowConstructor (this: WorkflowImpl, name: string) {
    this[kWorkflow] = true
    this[kReady] = false
    this.name = name
    this[kGraph] = []
    this[kPluginAutoId] = 0
    this[kRegisteredDecorators] = []
}

WorkflowConstructor.prototype.step = function step(this: WorkflowImpl, opts: StepOpts<unknown, unknown>) {
    const {
        maxAttempts = 1,
        optional = false,
        delayBetweenAttempts = 0,
        ...requiredFields
    } = opts

    this[kGraph].push({
        type: "step",
        step: {
            ...requiredFields,
            maxAttempts,
            optional,
            delayBetweenAttempts,
        },
        context: this
    })

    return this
}

WorkflowConstructor.prototype.getHook = function* getHook(this: WorkflowImpl, hook: "onStepCompleted") {
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

WorkflowConstructor.prototype.addHook = function addHook(this: WorkflowImpl, hook: string, handler: Function) {
    switch(hook) {
        case "onWorkflowCompleted":
            this[kGraph].push({
                type: "onWorkflowCompleted",
                hook: handler as OnWorkflowCompletedHook<unknown, unknown>,
                context: this
            })
            break
        case "onStepError":
            this[kGraph].push({
                type: "onStepError",
                hook: handler as OnStepErrorHook<unknown, unknown>,
                context: this
            })
            break

        case "onStepSkipped":
            this[kGraph].push({
                type: "onStepSkipped",
                hook: handler as OnStepSkippedHook<unknown, unknown>,
                context: this
            })
            break

        case "onWorkflowStopped":
            this[kGraph].push({
                type: "onWorkflowStopped",
                hook: handler as OnWorkflowStoppedHook<unknown, unknown>,
                context: this
            })
            break

        case "onStepCompleted":
            this[kGraph].push({
                type: "onStepCompleted",
                hook: handler as OnStepCompletedHook<unknown, unknown>,
                context: this
            })
            break

        case "onWorkflowFailed":
            this[kGraph].push({
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

WorkflowConstructor.prototype.steps = function *steps (this: WorkflowImpl): Iterable<[ Step<unknown, unknown>, WorkflowImpl ]> {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    const root = getRootWorkflow(this)

    for (const element of iterateDepthFirst(root)) {
        if (element.type === "step") {
            yield [ element.step, element.context ]
        }
    }
}

WorkflowConstructor.prototype.register = function register(this: WorkflowImpl, plugin: RivrPlugin<unknown, unknown, unknown>, opts: unknown) {
    const nested = new (WorkflowConstructor as any)(this.name)
    Object.setPrototypeOf(nested, this)

    const {
        opts: {
            deps = [],
            name = `plugin-auto-${getRootWorkflow(this)[kPluginAutoId] ++}`
        } = {}
    } = plugin

    Object.defineProperty(plugin, "opts", {
        value: {
            deps,
            name
        }
    })

    this[kGraph].push({ type: "plugin", plugin, context: nested, opts })
    return nested
}

WorkflowConstructor.prototype.decorate = function decorate(this: WorkflowImpl, key: string, value: unknown) {
    if (this[kRegisteredDecorators].includes(key)) {
        throw new Error(`Cannot decorate the same property '${key}' twice`)
    }

    // @ts-expect-error
    this[key] = value
    this[kRegisteredDecorators].push(key)
    return this
}

WorkflowConstructor.prototype.getFirstStep = function getFirstStep(this: WorkflowImpl) {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    for (const [ step ] of this.steps()) {
        return step
    }
}

WorkflowConstructor.prototype.getStepAndExecutionContext = function getStepAndExecutionContext(this: WorkflowImpl, name: string) {
    if (!this[kReady]) {
        throw new WorkflowNotReadyError(this.name)
    }

    for (const [ step, context ] of this.steps()) {
        if (name === step.name)
            return [step, context] as const
    }
}

WorkflowConstructor.prototype.getNextStep = function getNextStep(this: WorkflowImpl, name: string) {
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

WorkflowConstructor.prototype.ready = async function ready(this: WorkflowImpl) {
    const root = getRootWorkflow(this)

    if (root[kReady]) {
        return this
    }

    await executePlugins(root)

    return this
}

/**
 * Iterate the workflow graph depth first.
 *
 * @param w
 */
function* iterateDepthFirst(w: WorkflowImpl): Iterable<GraphWithoutPlugin<unknown, unknown>> {
    for (const element of w[kGraph]) {
        if (element.type === "plugin") {
            for (const nested of iterateDepthFirst(element.context as WorkflowImpl)) {
                yield nested
            }
        } else {
            yield element
        }
    }
}

/**
 * Iterate the workflow prototype chain from the given workflow to the top.
 *
 * @param w
 */
function* iterateBottomToTop (w: WorkflowImpl): Iterable<GraphElement<unknown, unknown>> {
    let current = w

    do {
        for (const element of current[kGraph]) {
            yield element
        }

        current = Object.getPrototypeOf(current)
    } while (kWorkflow in current)
}

/**
 * Get the root workflow of the given workflow.
 *
 * @param w
 */
function getRootWorkflow (w: WorkflowImpl): WorkflowImpl {
    const proto = Object.getPrototypeOf(w)
    const isRoot = !(kWorkflow in proto)

    if (isRoot) {
        return w
    }

    return getRootWorkflow(proto)
}

/**
 * List unsatisfied deps.
 *
 * @param root
 * @param deps
 */
function getUnsatisfiedDeps (root: WorkflowImpl, deps: RivrPlugin<unknown, unknown, unknown>[]): RivrPlugin<unknown, unknown, unknown>[] {
    const foundDeps = []

    for (const element of iterateBottomToTop(root)) {
        if (element.type === "plugin" && deps.includes(element.plugin)) {
            foundDeps.push(element.plugin)
        }
    }

    return diffArrays(
      foundDeps,
      deps,
      (a, b) => a.opts?.name === b.opts?.name
    )
}

function diffArrays<T>(a: T[], b: T[], equals: (a: T, b: T) => boolean): T[] {
    if (a.length === 0)
        return b

    if (b.length === 0)
        return a

    return a.filter(itemA => !b.some(itemB => equals(itemA, itemB)))
}

async function executePlugins (root: WorkflowImpl) {
    for (const element of root[kGraph]) {
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

            const currentPluginElements = [...element.context[kGraph]]
            element.context[kGraph] = []

            const pluginOpts = typeof element.opts === "function"
                ? element.opts(element.context)
                : element.opts

            element.plugin(element.context, pluginOpts)
            element.context[kGraph].push(...currentPluginElements)
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
