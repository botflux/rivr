import {
  OnStepCompletedHook,
  OnStepErrorHook,
  OnStepSkippedHook,
  OnWorkflowCompletedHook,
  OnWorkflowFailedHook,
  OnWorkflowStoppedHook, ReadyWorkflow,
  Step,
  StepOpts,
  WithContext,
  Workflow as PublicWorkflow,
} from "./types";
import { List, Slice, ArrayAdapter } from "./utils/list"

type EmptyDecorator = Record<never, never>
type EmptyStateByStep = Record<never, never>

type StepElement<State, StateOut, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "step"
  id: number
  context: Workflow<State, FirstState, StateByStepName>
  step: Step<State, StateOut, FirstState, EmptyDecorator, StateByStepName>
}

type Hook<State, FirstState, StateByStepName extends EmptyStateByStep> =
  | { type: "onStepCompleted", hook: OnStepCompletedHook<State, FirstState, StateByStepName, EmptyDecorator> }
  | { type: "onStepError", hook: OnStepErrorHook<State, FirstState, StateByStepName, EmptyDecorator> }
  | { type: "onStepSkipped", hook: OnStepSkippedHook<State, FirstState, StateByStepName, EmptyDecorator> }
  | { type: "onWorkflowCompleted", hook: OnWorkflowCompletedHook<State, FirstState, StateByStepName, EmptyDecorator> }
  | { type: "onWorkflowFailed", hook: OnWorkflowFailedHook<State, FirstState, StateByStepName, EmptyDecorator> }
  | { type: "onWorkflowStopped", hook: OnWorkflowStoppedHook<State, FirstState, StateByStepName, EmptyDecorator> }

type HookElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "hook"
  context: Workflow<State, FirstState, StateByStepName>
  hook: Hook<State, FirstState, StateByStepName>
  id: number
}

type PluginElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "plugin"
  id: number
  context: Workflow<State, FirstState, StateByStepName>
  plugin: Function
  pluginOpts?: unknown | ((w: Workflow<State, FirstState, StateByStepName>) => unknown)
}

type RootElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "root"
  id: number
  context: Workflow<State, FirstState, StateByStepName>
}

type NodeElement<State, FirstState, StateByStepName extends EmptyStateByStep> =
  | StepElement<State, unknown, FirstState, StateByStepName>
  | HookElement<State, FirstState, StateByStepName>
  | PluginElement<State, FirstState, StateByStepName>
  | RootElement<State, FirstState, StateByStepName>

interface Workflow<State, FirstState, StateByStepName extends EmptyStateByStep> extends PublicWorkflow<State, FirstState, StateByStepName, EmptyDecorator> {
  list: List<NodeElement<State, FirstState, StateByStepName>>
  pluginStartIndex: number
  registeredDecorators: string[]
  isReady: boolean
  generateNewNodeId(): number
  nextNodeId: number
  autoPluginId: number
}

function isStep<State, FirstState, StateByStepName extends EmptyStateByStep>(node: NodeElement<State, FirstState, StateByStepName>): node is StepElement<State, unknown, FirstState, StateByStepName> {
  return node.type === 'step'
}

function isHook<State, FirstState, StateByStepName extends EmptyStateByStep>(node: NodeElement<State, FirstState, StateByStepName>): node is HookElement<State, FirstState, StateByStepName> {
  return node.type === 'hook'
}

function isPlugin<State, FirstState, StateByStepName extends EmptyStateByStep>(node: NodeElement<State, FirstState, StateByStepName>): node is PluginElement<State, FirstState, StateByStepName> {
  return node.type === 'plugin'
}

function isHookType<Hook> (hook: Hook) {
  return function<State, FirstState, StateByStepName extends Record<never, never>> (node: HookElement<State, FirstState, StateByStepName>): node is HookElement<State, FirstState, StateByStepName> & { hook: { type: Hook } } {
    return node.hook.type === hook
  }
}

function createPluginWorkflow<State, FirstState, StateByStepName extends Record<never, never>>(parent: Workflow<State, FirstState, StateByStepName>, list: List<NodeElement<State, FirstState, StateByStepName>>): Workflow<State, FirstState, StateByStepName> {
  const workflow = {
    decorate<K extends string, V>(key: K, value: V): PublicWorkflow<State, FirstState, StateByStepName, EmptyDecorator & Record<K, V>> {
      // @ts-expect-error
      parent.decorate.call(parent, key, value)
      return this as unknown as PublicWorkflow<State, FirstState, StateByStepName, EmptyDecorator & Record<K, V>>
    },
    list,
  } as Workflow<State, FirstState, StateByStepName>
  Object.setPrototypeOf(workflow, parent)
  return workflow
}

function createChildWorkflow<State, FirstState, StateByStepName extends EmptyStateByStep>(parent: Workflow<State, FirstState, StateByStepName>, list: List<NodeElement<State, FirstState, StateByStepName>>, startIndex: number): Workflow<State, FirstState, StateByStepName> {
  const workflow = {
    list,
    registeredDecorators: [] as string[],
    pluginStartIndex: startIndex,
    isReady: false
  } as Workflow<State, FirstState, StateByStepName>
  Object.setPrototypeOf(workflow, parent)

  return workflow
}

function createRootWorkflow<State, FirstState, StateByStepName extends EmptyStateByStep> (name: string) {
  const list = new ArrayAdapter<NodeElement<State, FirstState, StateByStepName>>()
  const workflow: Workflow<State, FirstState, StateByStepName> = {
    list,
    isReady: false,
    nextNodeId: 0,
    autoPluginId: 0,
    name,
    registeredDecorators: [],
    generateNewNodeId(): number {
      return this.nextNodeId ++
    },
    decorate,
    addHook(hook, handler) {
      this.list.append({
        type: "hook",
        id: this.generateNewNodeId(),
        context: this as Workflow<State, FirstState, StateByStepName>,
        hook: {
          type: hook,
          hook: handler
        } as Hook<State, FirstState, StateByStepName>
      })
      return this
    },
    step<Name extends string, StateOut>(opts: StepOpts<Name, State, StateOut, FirstState, StateByStepName, EmptyDecorator>) {
      const {
        delayBetweenAttempts = 0,
        optional = false,
        maxAttempts = 1,
        ...requiredFields
      } = opts

      this.list.append({
        type: "step",
        context: this,
        id: this.generateNewNodeId(),
        step: {
          ...requiredFields,
          optional,
          delayBetweenAttempts,
          maxAttempts
        } as unknown as Step<State, StateOut, FirstState, EmptyDecorator, StateByStepName>
      })

      return this as unknown as Workflow<StateOut, FirstState, StateByStepName & Record<Name, State>>
    },
    getFirstStep(): Step<FirstState, unknown, FirstState, StateByStepName, EmptyDecorator> | undefined {
      for (const node of this.list) {
        if (node.type === "step") {
          return node.step as unknown as Step<FirstState, unknown, FirstState, StateByStepName, EmptyDecorator>
        }
      }
    },
    getStepByName(name: string): WithContext<Step<State, unknown, FirstState, StateByStepName, EmptyDecorator>, State, FirstState, StateByStepName, EmptyDecorator> | undefined {
      for (const node of this.list) {
        if (node.type === "step" && node.step.name === name) {
          return [ node.step as unknown as Step<State, unknown, FirstState, StateByStepName, EmptyDecorator>, node.context ]
        }
      }
    },
    getNextStep(name: string): Step<State, unknown, FirstState, StateByStepName, EmptyDecorator> | undefined {
      const nodes = Array.from(this.list)
        .filter(isStep)
      const index = nodes.findIndex(node => node.step.name === name)

      if (index === -1) {
        throw new Error(`No step matching the name '${name}'`)
      }

      const nextStepIndex = index + 1

      const node = nextStepIndex >= nodes.length
        ? undefined
        : nodes[nextStepIndex]

      return node?.step as unknown as Step<State, unknown, FirstState, StateByStepName, EmptyStateByStep>
    },
    steps(): Iterable<[step: Step<State, unknown, FirstState, StateByStepName, EmptyDecorator>, context: PublicWorkflow<State, FirstState, StateByStepName, EmptyDecorator>]> {
      // @ts-expect-error
      return Array.from(this.list)
        .filter(node => isStep<State, FirstState, StateByStepName>(node))
        .map(node => [ node.step, node.context ])
    },
    // @ts-expect-error
    getHook(hook) {
      return Array.from(this.list)
        .filter(isHook)
        .filter(isHookType(hook))
        .map(node => [node.hook.hook, node.context])
    },
    async ready(): Promise<ReadyWorkflow<State, FirstState, StateByStepName, EmptyDecorator>> {
      if (this.isReady) {
        return this as unknown as ReadyWorkflow<State, FirstState, StateByStepName, EmptyDecorator>
      }

      let visited: number[] = []
      let index = 0

      for (const node of this.list) {
        if (visited.includes(node.id))
          continue

        visited.push(node.id)

        if (node.type !== "plugin")
          continue

        // @ts-expect-error
        const deps = (node.plugin.opts.deps ?? []) as Function[]

        const registeredPlugins = Array.from(this.list.reverseIteratorFromIndex(index))
          .filter(isPlugin)
          // @ts-expect-error
          .map(node => node.plugin.opts.name)

        // @ts-expect-error
        const unsatisfiedDeps = deps.filter(plugin => !registeredPlugins.includes(plugin.opts.name))

        if (unsatisfiedDeps.length > 0) {
          // @ts-expect-error
          throw new Error(`Plugin "${node.plugin.opts.name}" needs "${unsatisfiedDeps[0].opts.name}" to be registered`)
        }

        const pluginOpts = typeof node.pluginOpts === "function"
          ? node.pluginOpts(this)
          : node.pluginOpts

        const pluginScope = createPluginWorkflow(
          node.context,
          new Slice(node.context.list, node.context.pluginStartIndex)
        )

        node.plugin(pluginScope, pluginOpts)
        node.context.isReady = true
        index++
      }

      this.isReady = true

      return this as unknown as ReadyWorkflow<State, FirstState, StateByStepName, EmptyDecorator>
    }
  }

  return workflow
}

function decorate<State, FirstState, StateByStepName extends EmptyStateByStep, K extends string, V> (
  this: Workflow<State, FirstState, StateByStepName>,
  key: K,
  value: V
) {
  if (this.registeredDecorators.includes(key)) {
    throw new Error(`Cannot decorate the same property '${key}' twice`)
  }

  Object.defineProperty(this, key, { value })
  this.registeredDecorators.push(key)
  return this as unknown as PublicWorkflow<State, FirstState, StateByStepName, EmptyDecorator & Record<K, V>>
}

export const rivr = {
  workflow<State>(name: string): PublicWorkflow<State, State, EmptyStateByStep, Record<never, never>> {
    return createRootWorkflow(name)
  }
}