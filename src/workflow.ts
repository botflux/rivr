import {
    kWorkflow,
    OnStepCompletedHook,
    OnStepErrorHook,
    OnStepSkippedHook,
    OnWorkflowCompletedHook,
    OnWorkflowFailedHook,
    OnWorkflowStoppedHook, Plugin, ReadyWorkflow,
    Step,
    StepOpts,
    WithContext,
    Workflow as PublicWorkflow
} from "./types.ts";
import {DAG2, Node} from "./dag.ts";
import {RivrPlugin} from "./plugin.ts";

type EmptyDecorator = Record<never, never>

type StepElement<State> = {
    type: "step"
    context: Workflow<State>
    step: Step<State, EmptyDecorator>
}

type Hook<State> =
    | { type: "onStepCompleted", hook: OnStepCompletedHook<State, EmptyDecorator> }
    | { type: "onStepError", hook: OnStepErrorHook<State, EmptyDecorator> }
    | { type: "onStepSkipped", hook: OnStepSkippedHook<State, EmptyDecorator> }
    | { type: "onWorkflowCompleted", hook: OnWorkflowCompletedHook<State, EmptyDecorator> }
    | { type: "onWorkflowFailed", hook: OnWorkflowFailedHook<State, EmptyDecorator> }
    | { type: "onWorkflowStopped", hook: OnWorkflowStoppedHook<State, EmptyDecorator> }

type HookElement<State> = {
    type: "hook"
    context: Workflow<State>
    hook: Hook<State>
}

type PluginElement<State> = {
    type: "plugin"
    context: Workflow<State>
    plugin: RivrPlugin<EmptyDecorator, unknown, State>
    pluginOpts?: unknown | ((w: Workflow<State>) => unknown)
}

type RootElement<State> = {
    type: "root"
    context: Workflow<State>
}

type NodeElement<State> =
    | StepElement<State>
    | HookElement<State>
    | PluginElement<State>
    | RootElement<State>

interface Workflow<State> extends PublicWorkflow<State, EmptyDecorator> {
    node: Node<NodeElement<State>>
    dag: DAG2<NodeElement<State>>
    registeredDecorators: string[]
}

function isStep<State>(node: Node<NodeElement<State>>): node is Node<StepElement<State>> {
    return node.value.type === 'step'
}

function isHook<State>(node: Node<NodeElement<State>>): node is Node<HookElement<State>> {
    return node.value.type === 'hook'
}

function isHookType<Hook> (hook: Hook) {
    return function<State> (node: Node<HookElement<State>>): node is Node<HookElement<State> & { hook: { type: Hook } }> {
        return node.value.hook.type === hook
    }
}

function createChildWorkflow<State>(parent: Workflow<State>, node: Node<PluginElement<State>>) {
    const workflow = {
        [kWorkflow]: true,
        node,
        registeredDecorators: [] as string[],
    } as Workflow<State>
    Object.setPrototypeOf(workflow, parent)

    return workflow
}

function createRootWorkflow<State> (name: string) {
    const dag = new DAG2<NodeElement<State>>()
    const rootNode = dag.addRootNode({
        type: "root",
        context: {} as Workflow<State>,
    })
    const workflow: Workflow<State> = {
        dag,
        node: rootNode,
        [kWorkflow]: true,
        name,
        registeredDecorators: [],
        decorate,
        addHook(hook, handler) {
            this.dag.addNode({
                type: "hook",
                context: this as Workflow<State>,
                hook: {
                    type: hook,
                    hook: handler
                } as Hook<State>
            }, (this as Workflow<State>).node)
            return this
        },
        step(opts: StepOpts<State, EmptyDecorator>) {
            const {
                delayBetweenAttempts = 0,
                optional = false,
                maxAttempts = 1,
                ...requiredFields
            } = opts

            this.dag.addNode({
                type: "step",
                context: this,
                step: {
                    ...requiredFields,
                    optional,
                    delayBetweenAttempts,
                    maxAttempts
                }
            }, this.node)
            return this
        },
        getFirstStep(): Step<State, EmptyDecorator> | undefined {
            const root = this.dag.getRootNode()

            if (root === undefined) {
                throw new Error("There is no step in the workflow")
            }

            for (const node of this.dag.iterateDepthFirst(root)) {
                if (node.value.type === "step") {
                    return node.value.step
                }
            }
        },
        getStepAndExecutionContext(name: string): WithContext<Step<State, EmptyDecorator>, State, EmptyDecorator> | undefined {
            const root = this.dag.getRootNode()

            if (root === undefined) {
                throw new Error("There is no root node")
            }

            for (const node of this.dag.iterateDepthFirst(root)) {
                if (node.value.type === "step" && node.value.step.name === name) {
                    return [ node.value.step, node.value.context ]
                }
            }
        },
        getNextStep(name: string): Step<State, EmptyDecorator> | undefined {
            const root = this.dag.getRootNode()

            if (root === undefined) {
                throw new Error("No root node")
            }

            const nodes = Array.from(this.dag.iterateDepthFirst(root))
              .filter(isStep)
            const index = nodes.findIndex(node => node.value.step.name === name)

            if (index === -1) {
                throw new Error(`No step matching the name '${name}'`)
            }

            const nextStepIndex = index + 1

            const node = nextStepIndex >= nodes.length
                ? undefined
                : nodes[nextStepIndex]

            return node?.value.step
        },
        steps(): Iterable<[step: Step<State, EmptyDecorator>, context: PublicWorkflow<State, EmptyDecorator>]> {
            const root = this.dag.getRootNode()

            if (root === undefined) {
                throw new Error("No root node")
            }

            return Array.from(this.dag.iterateDepthFirst(root))
              .filter(isStep)
              .map(node => [ node.value.step, node.value.context ])
        },
        // @ts-expect-error
        getHook(hook) {
            const root = this.dag.getRootNode()

            if (root === undefined) {
                throw new Error("No root node")
            }

            return Array.from(this.dag.iterateDepthFirst(root))
              .filter(isHook)
              .filter(isHookType(hook))
              .map(node => [node.value.hook.hook, node.value.context])
        },
        register<NewDecorators>(plugin: RivrPlugin<EmptyDecorator, unknown, State>, opts?: unknown | ((w: PublicWorkflow<State, EmptyDecorator>) => unknown)): PublicWorkflow<State, EmptyDecorator & NewDecorators> {
            const node = this.dag.addNode({
                type: "plugin",
                plugin,
                context: this,
                pluginOpts: opts
            }, this.node)

            const child = createChildWorkflow(this, node)
            node.value.context = child
            return child as unknown as PublicWorkflow<State, EmptyDecorator & NewDecorators>
        },
        async ready(): Promise<ReadyWorkflow<State, EmptyDecorator>> {
            const root = this.dag.getRootNode()

            if (root === undefined)
                throw new Error("No root node")

            for (const node of this.dag.iterateDepthFirst(this.node)) {
                const value = node.value

                if (value.type !== "plugin")
                    continue

                const pluginOpts = typeof value.pluginOpts === "function"
                    ? value.pluginOpts(this)
                    : value.pluginOpts
            }
        }
    }

    rootNode.value = {
        type: "root",
        context: workflow
    }

    return {
        ...workflow,
        node: rootNode
    }
}

function decorate<State, K extends string, V> (
  this: Workflow<State>,
  key: K,
  value: V
) {
    Object.defineProperty(this, key, { value })
    this.registeredDecorators.push(key)
    return this as unknown as PublicWorkflow<State, EmptyDecorator & Record<K, V>>
}

export const rivr = {
    workflow<State>(name: string): PublicWorkflow<State, Record<never, never>> {
        return createRootWorkflow(name)
    }
}