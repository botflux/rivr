import {
    kWorkflow,
    OnStepCompletedHook,
    OnStepErrorHook,
    OnStepSkippedHook,
    OnWorkflowCompletedHook,
    OnWorkflowFailedHook,
    OnWorkflowStoppedHook,
    Plugin,
    ReadyWorkflow,
    Step,
    StepOpts,
    WithContext,
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
const kGetPluginAutoId = Symbol("kGetPluginId");
const kIterateDepthFirst = Symbol("kIterateDepthFirst");
const kApplyPlugin = Symbol("kApplyPlugin");
const kListRegisteredPlugins = Symbol("kListRegisteredPlugins")

export type StepElement<State, Decorators> = {
    type: "step",
    step: Step<State, Decorators>
    context: WorkflowImpl
}
export type StepCompletedElement<State, Decorators> = {
    type: "onStepCompleted",
    hook: OnStepCompletedHook<State, Decorators>
    context: WorkflowImpl
}
export type StepErrorElement<State, Decorators> = {
    type: "onStepError",
    hook: OnStepErrorHook<State, Decorators>
    context: WorkflowImpl
}
export type StepSkippedElement<State, Decorators> = {
    type: "onStepSkipped",
    hook: OnStepSkippedHook<State, Decorators>
    context: WorkflowImpl
}
export type WorkflowCompletedElement<State, Decorators> = {
    type: "onWorkflowCompleted",
    hook: OnWorkflowCompletedHook<State, Decorators>
    context: WorkflowImpl
}
export type WorkflowStoppedElement<State, Decorators> = {
    type: "onWorkflowStopped",
    hook: OnWorkflowStoppedHook<State, Decorators>
    context: WorkflowImpl
}
export type WorkflowFailedElement<State, Decorators> = {
    type: "onWorkflowFailed",
    hook: OnWorkflowFailedHook<State, Decorators>
    context: WorkflowImpl
}
export type WorkflowPluginElement<State, Decorators> = {
    type: "plugin",
    plugin: RivrPlugin<Decorators, unknown, State>
    context: WorkflowImpl
    opts: unknown
}

export type GraphElement<State, Decorators> =
  | StepElement<State, Decorators>
  | StepCompletedElement<State, Decorators>
  | WorkflowCompletedElement<State, Decorators>
  | StepErrorElement<State, Decorators>
  | StepSkippedElement<State, Decorators>
  | WorkflowStoppedElement<State, Decorators>
  | WorkflowFailedElement<State, Decorators>
  | WorkflowPluginElement<State, Decorators>

export type GraphWithoutPlugin<State, Decorators> = Exclude<GraphElement<State, Decorators>, WorkflowPluginElement<State, Decorators>>

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

interface RootWorkflow<State> extends ChildWorkflow<State> {
    [kPluginAutoId]: number
    [kIterateDepthFirst]: () => Iterable<GraphElement<State, Record<never, never>>>
}

interface ChildWorkflow<State> extends Workflow<State, Record<never, never>> {
    [kReady]: boolean
    [kGraph]: GraphElement<State, Record<never, never>>[]
    [kRegisteredDecorators]: string[]
    [kGetPluginAutoId]: () => number
    [kApplyPlugin]: (
      plugin: RivrPlugin<Record<never, never>, Record<never, never>, State>,
      opts: unknown | ((workflow: Workflow<State, Record<never, never>>) => unknown)
    ) => Promise<void>
}

export function createChildWorkflow<State>(
  parent: ChildWorkflow<State>
): Workflow<State, Record<never, never>> {
    const child = {} as Workflow<State, Record<never, never>>
    Object.setPrototypeOf(child, parent)
    Object.defineProperty(child, "name", {
        get() {
            return parent.name
        }
    })
    Object.assign(child, {
        [kWorkflow]: true,
        [kReady]: false,
        [kGraph]: [],
        [kRegisteredDecorators]: [],
        step: addStep,
        // @ts-expect-error
        getHook: (...params: Parameters<typeof getHook>) => parent.getHook(...params),
        addHook,
        register,
        decorate,
        steps(): Iterable<[step: Step<State, Record<never, never>>, context: Workflow<State, Record<never, never>>]> {
            return parent.steps()
        },
        async ready(): Promise<ReadyWorkflow<State, Record<never, never>>> {
            return await parent.ready()
        },
        getStepAndExecutionContext(name: string): WithContext<Step<State, Record<never, never>>, State, Record<never, never>> | undefined {
            return parent.getStepAndExecutionContext(name)
        },
        getNextStep(name: string): Step<State, Record<never, never>> | undefined {
            return parent.getNextStep(name)
        },
        getFirstStep(): Step<State, Record<never, never>> | undefined {
            return parent.getFirstStep()
        },
        [kGetPluginAutoId](): number {
            return parent[kGetPluginAutoId]()
        },
        async [kApplyPlugin](
          plugin: RivrPlugin<Record<never, never>, Record<never, never>, State>,
          opts: unknown | ((workflow: Workflow<State, Record<never, never>>) => unknown)
        ): Promise<void> {
            const alreadyRegistered = this[kGraph]
            this[kGraph] = []

            const pluginOpts = typeof opts === "function"
                ? opts(this)
                : opts

            plugin(this as unknown as Workflow<State, Record<never, never>>, pluginOpts)
            this[kGraph].push(...alreadyRegistered)
            this[kReady] = true

            for (const node of this[kGraph]) {
                if (node.type === "plugin") {
                    const context = node.context as unknown as ChildWorkflow<State>

                    await context[kApplyPlugin](node.plugin, node.opts)
                }
            }
        },
    } satisfies Omit<ChildWorkflow<State>, "name">)

    return child
}

export function createRootWorkflow<State> (name: string): Workflow<State, Record<never, never>> {
    const workflow = {
        [kWorkflow]: true,
        [kReady]: false,
        [kGraph]: [],
        [kPluginAutoId]: 0,
        [kRegisteredDecorators]: [],
        name,
        decorate: decorate,
        step: addStep,
        * steps(): Iterable<[step: Step<State, Record<never, never>>, context: Workflow<State, Record<never, never>>]> {
            for (const node of this[kIterateDepthFirst]()) {
                if (node.type === "step") {
                    yield [
                        node.step,
                        node.context as unknown as Workflow<State, Record<never, never>>
                    ] as const
                }
            }
        },
        register: register,
        async ready(): Promise<ReadyWorkflow<State, Record<never, never>>> {
            for (const node of this[kGraph]) {
                if (node.type === "plugin") {
                    const context = node.context as unknown as ChildWorkflow<State>

                    await context[kApplyPlugin](node.plugin, node.opts)
                }
            }

            return this as unknown as ReadyWorkflow<State, Record<never, never>>
        },
        getNextStep(name: string): Step<State, Record<never, never>> | undefined {
            const steps = Array.from(this[kIterateDepthFirst]())
              .filter(node => node.type === "step")

            const index = steps.findIndex(
              node => node.step.name === name
            )

            if (index === -1) {
                throw new Error(`No step matching the name '${name}'`)
            }

            const nextStepIndex = index + 1

            const step = nextStepIndex >= steps.length
                ? undefined
                : steps[nextStepIndex]

            return step?.step
        },
        getFirstStep(): Step<State, Record<never, never>> | undefined {
            for (const node of this[kIterateDepthFirst]()) {
                if (node.type === "step") {
                    return node.step
                }
            }
        },
        getStepAndExecutionContext(name: string): WithContext<Step<State, Record<never, never>>, State, Record<never, never>> | undefined {
            for (const node of this[kIterateDepthFirst]()) {
                if (node.type === "step" && node.step.name === name) {
                    return [
                      node.step,
                      node.context as unknown as Workflow<State, Record<never, never>>
                    ]
                }
            }
        },
        getHook: getHook,
        addHook: addHook,
        [kGetPluginAutoId](): number {
            return this[kPluginAutoId]++
        },
        *[kIterateDepthFirst]() {
            for (const node of iterateDepthFirst2(this)) {
                yield node
            }
        },
        async [kApplyPlugin]() {

        }
    } satisfies RootWorkflow<State>

    return workflow
}

function* iterateDepthFirst2<State> (
  workflow: ChildWorkflow<State>
): Iterable<GraphElement<State, Record<never, never>>> {
    for (const node of workflow[kGraph]) {
        if (node.type === "plugin") {
            for (const child of iterateDepthFirst2(node.context as unknown as ChildWorkflow<State>)) {
                yield child
            }
        } else {
            yield node as GraphElement<State, Record<never, never>>
        }
    }
}

function register<State, NewDecorators>(plugin: Plugin<State, Record<never, never>, NewDecorators>): Workflow<State, Record<never, never> & NewDecorators>
function register<State, NewDecorators>(plugin: RivrPlugin<NewDecorators, undefined, State>): Workflow<State, Record<never, never> & NewDecorators>
function register<State, NewDecorators, Opts>(plugin: RivrPlugin<NewDecorators, Opts, State>, opts: Opts | ((workflow: ReadyWorkflow<State, Record<never, never>>) => Opts)): Workflow<State, Record<never, never> & NewDecorators>
function register<State, NewDecorators, Opts>(
  this: ChildWorkflow<State>,
  plugin: RivrPlugin<NewDecorators, Opts, State>,
  opts?: Opts | ((workflow: ReadyWorkflow<State, Record<never, never>>) => Opts) 
): Workflow<State, NewDecorators> {
    const nested = createChildWorkflow(this)

    const {
        opts: {
            deps = [],
            name = `plugin-auto-${this[kGetPluginAutoId]()}`
        } = {}
    } = plugin

    Object.defineProperty(plugin, "opts", {
        value: {
            deps,
            name
        }
    })

    this[kGraph].push({
        type: "plugin",
        plugin: plugin as any,
        context: nested as unknown as WorkflowImpl,
        opts
    })
    return nested as unknown as Workflow<State, NewDecorators>
}

function addHook<State>(hook: "onWorkflowCompleted", handler: OnWorkflowCompletedHook<State, Record<never, never>>): Workflow<State, Record<never, never>>
function addHook<State>(hook: "onStepError", handler: OnStepErrorHook<State, Record<never, never>>): Workflow<State, Record<never, never>>
function addHook<State>(hook: "onStepSkipped", handler: OnStepSkippedHook<State, Record<never, never>>): Workflow<State, Record<never, never>>
function addHook<State>(hook: "onWorkflowStopped", handler: OnWorkflowStoppedHook<State, Record<never, never>>): Workflow<State, Record<never, never>>
function addHook<State>(hook: "onStepCompleted", handler: OnStepCompletedHook<State, Record<never, never>>): Workflow<State, Record<never, never>>
function addHook<State>(hook: "onWorkflowFailed", handler: OnWorkflowFailedHook<State, Record<never, never>>): Workflow<State, Record<never, never>>
function addHook<State>(
  this: ChildWorkflow<State>,
  hook: "onWorkflowCompleted" | "onStepError" | "onStepSkipped" | "onWorkflowStopped" | "onStepCompleted" | "onWorkflowFailed",
  handler: OnWorkflowCompletedHook<State, Record<never, never>> | OnStepErrorHook<State, Record<never, never>> | OnStepSkippedHook<State, Record<never, never>> | OnWorkflowStoppedHook<State, Record<never, never>> | OnStepCompletedHook<State, Record<never, never>> | OnWorkflowFailedHook<State, Record<never, never>>
): ChildWorkflow<State> {
    // @ts-expect-error
    this[kGraph].push({
        type: hook,
        hook: handler,
        context: this as unknown as WorkflowImpl
    })
    return this
}

function addStep<State> (
  this: ChildWorkflow<State>,
  opts: StepOpts<State, Record<never, never>>
): Workflow<State, Record<never, never>> {
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
            delayBetweenAttempts
        },
        context: this as unknown as WorkflowImpl
    })
    return this
}

function decorate<State, Key extends string, Value>(
  this: ChildWorkflow<State>,
  key: Key,
  value: Value
): Workflow<State, Record<Key, Value>> {
    Object.defineProperty(this, key, { value })
    return this as unknown as Workflow<State, Record<Key, Value>>
}

function getHook<State>(hook: "onStepCompleted"): WithContext<OnStepCompletedHook<State, Record<never, never>>, State, Record<never, never>>[]
function getHook<State>(hook: "onWorkflowCompleted"): WithContext<OnWorkflowCompletedHook<State, Record<never, never>>, State, Record<never, never>>[]
function getHook<State>(hook: "onStepError"): WithContext<OnStepErrorHook<State, Record<never, never>>, State, Record<never, never>>[]
function getHook<State>(hook: "onStepSkipped"): WithContext<OnStepSkippedHook<State, Record<never, never>>, State, Record<never, never>>[]
function getHook<State>(hook: "onWorkflowStopped"): WithContext<OnWorkflowStoppedHook<State, Record<never, never>>, State, Record<never, never>>[]
function getHook<State>(hook: "onWorkflowFailed"): WithContext<OnWorkflowFailedHook<State, Record<never, never>>, State, Record<never, never>>[]
function getHook<State>(
  this: RootWorkflow<State>,
  hook: "onWorkflowStopped" | "onWorkflowFailed" | "onStepCompleted" | "onWorkflowCompleted" | "onStepError" | "onStepSkipped"
): WithContext<any, State, Record<never, never>>[] {
    let result: WithContext<any, State, Record<never, never>>[] = []

    for (const node of this[kIterateDepthFirst]()) {
        if (node.type === hook) {
            result.push([ node.hook, node.context as Workflow<State, Record<never, never>> ])
        }
    }

    return result
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
        return createRootWorkflow(name)
        // return new (WorkflowConstructor as any)(name)
    }
}
