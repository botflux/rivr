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
  RivrPlugin
} from "./types";
import { List, Slice, ArrayAdapter } from "./utils/list"

type EmptyDecorator = Record<never, never>

type StepElement<State, FirstState> = {
  type: "step"
  id: number
  context: Workflow<State, FirstState>
  step: Step<State, FirstState, EmptyDecorator>
}

type Hook<State, FirstState> =
  | { type: "onStepCompleted", hook: OnStepCompletedHook<State, EmptyDecorator, FirstState> }
  | { type: "onStepError", hook: OnStepErrorHook<State, EmptyDecorator, FirstState> }
  | { type: "onStepSkipped", hook: OnStepSkippedHook<State, EmptyDecorator, FirstState> }
  | { type: "onWorkflowCompleted", hook: OnWorkflowCompletedHook<State, EmptyDecorator, FirstState> }
  | { type: "onWorkflowFailed", hook: OnWorkflowFailedHook<State, EmptyDecorator, FirstState> }
  | { type: "onWorkflowStopped", hook: OnWorkflowStoppedHook<State, EmptyDecorator, FirstState> }

type HookElement<State, FirstState> = {
  type: "hook"
  context: Workflow<State, FirstState>
  hook: Hook<State, FirstState>
  id: number
}

type PluginElement<State, FirstState> = {
  type: "plugin"
  id: number
  context: Workflow<State, FirstState>
  plugin: RivrPlugin<EmptyDecorator, unknown, State, FirstState>
  pluginOpts?: unknown | ((w: Workflow<State, FirstState>) => unknown)
}

type RootElement<State, FirstState> = {
  type: "root"
  id: number
  context: Workflow<State, FirstState>
}

type NodeElement<State, FirstState> =
  | StepElement<State, FirstState>
  | HookElement<State, FirstState>
  | PluginElement<State, FirstState>
  | RootElement<State, FirstState>

interface Workflow<State, FirstState> extends PublicWorkflow<State, FirstState, EmptyDecorator> {
  list: List<NodeElement<State, FirstState>>
  pluginStartIndex: number
  registeredDecorators: string[]
  isReady: boolean
  generateNewNodeId(): number
  nextNodeId: number
  autoPluginId: number
}

function isStep<State, FirstState>(node: NodeElement<State, FirstState>): node is StepElement<State, FirstState> {
  return node.type === 'step'
}

function isHook<State, FirstState>(node: NodeElement<State, FirstState>): node is HookElement<State, FirstState> {
  return node.type === 'hook'
}

function isPlugin<State, FirstState>(node: NodeElement<State, FirstState>): node is PluginElement<State, FirstState> {
  return node.type === 'plugin'
}

function isHookType<Hook> (hook: Hook) {
  return function<State, FirstState> (node: HookElement<State, FirstState>): node is HookElement<State, FirstState> & { hook: { type: Hook } } {
    return node.hook.type === hook
  }
}

function createPluginWorkflow<State, FirstState>(parent: Workflow<State, FirstState>, list: List<NodeElement<State, FirstState>>): Workflow<State, FirstState> {
  const workflow = {
    decorate<K extends string, V>(key: K, value: V): PublicWorkflow<State, FirstState, EmptyDecorator & Record<K, V>> {
      // @ts-expect-error
      parent.decorate.call(parent, key, value)
      return this as unknown as PublicWorkflow<State, FirstState, EmptyDecorator & Record<K, V>>
    },
    list,
  } as Workflow<State, FirstState>
  Object.setPrototypeOf(workflow, parent)
  return workflow
}

function createChildWorkflow<State, FirstState>(parent: Workflow<State, FirstState>, list: List<NodeElement<State, FirstState>>, startIndex: number): Workflow<State, FirstState> {
  const workflow = {
    list,
    registeredDecorators: [] as string[],
    pluginStartIndex: startIndex,
    isReady: false
  } as Workflow<State, FirstState>
  Object.setPrototypeOf(workflow, parent)

  return workflow
}

function createRootWorkflow<State, FirstState> (name: string) {
  const list = new ArrayAdapter<NodeElement<State, FirstState>>()
  const workflow: Workflow<State, FirstState> = {
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
        context: this as Workflow<State, FirstState>,
        hook: {
          type: hook,
          hook: handler
        } as Hook<State, FirstState>
      })
      // this.dag.addNode({
      //     type: "hook",
      //     context: this as Workflow<State>,
      //     hook: {
      //         type: hook,
      //         hook: handler
      //     } as Hook<State>
      // }, (this as Workflow<State>).node)
      return this
    },
    step<Name extends string>(opts: StepOpts<Name, State, FirstState, EmptyDecorator>) {
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
        }
      })

      // this.dag.addNode({
      //     type: "step",
      //     context: this,
      //     step: {
      //         ...requiredFields,
      //         optional,
      //         delayBetweenAttempts,
      //         maxAttempts
      //     }
      // }, this.node)
      return this
    },
    getFirstStep(): Step<State, FirstState, EmptyDecorator> | undefined {
      for (const node of this.list) {
        if (node.type === "step") {
          return node.step
        }
      }
    },
    getStepByName(name: string): WithContext<Step<State, FirstState, EmptyDecorator>, State, FirstState, EmptyDecorator> | undefined {
      for (const node of this.list) {
        if (node.type === "step" && node.step.name === name) {
          return [ node.step, node.context ]
        }
      }
    },
    getNextStep(name: string): Step<State, FirstState, EmptyDecorator> | undefined {
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

      return node?.step
    },
    steps(): Iterable<[step: Step<State, FirstState, EmptyDecorator>, context: PublicWorkflow<State, FirstState, EmptyDecorator>]> {
      return Array.from(this.list)
        .filter(isStep)
        .map(node => [ node.step, node.context ])
    },
    // @ts-expect-error
    getHook(hook) {
      return Array.from(this.list)
        .filter(isHook)
        .filter(isHookType(hook))
        .map(node => [node.hook.hook, node.context])
    },
    register<NewDecorators>(plugin: Function, opts?: unknown | ((w: PublicWorkflow<State, FirstState, EmptyDecorator>) => unknown)): PublicWorkflow<State, FirstState, EmptyDecorator & NewDecorators> {
      const child = createChildWorkflow(this, this.list, this.list.length + 1)

      const rivrPlugin = isRivrPlugin<EmptyDecorator, State, FirstState>(plugin)
        ? plugin
        : toRivrPlugin<State, FirstState>(plugin, () => `auto-plugin-${this.autoPluginId++}`)

      this.list.append({
        type: "plugin",
        plugin: rivrPlugin,
        context: child,
        pluginOpts: opts,
        id: this.generateNewNodeId()
      })

      return child as unknown as PublicWorkflow<State, FirstState, EmptyDecorator & NewDecorators>
    },
    async ready(): Promise<ReadyWorkflow<State, FirstState, EmptyDecorator>> {
      if (this.isReady) {
        return this as unknown as ReadyWorkflow<State, FirstState, EmptyDecorator>
      }

      let visited: number[] = []
      let index = 0

      for (const node of this.list) {
        if (visited.includes(node.id))
          continue

        visited.push(node.id)

        if (node.type !== "plugin")
          continue

        const deps = (node.plugin.opts.deps ?? []) as RivrPlugin<any, any, any, any>[]

        const registeredPlugins = Array.from(this.list.reverseIteratorFromIndex(index))
          .filter(isPlugin)
          .map(node => node.plugin.opts.name)

        const unsatisfiedDeps = deps.filter(plugin => !registeredPlugins.includes(plugin.opts.name))

        if (unsatisfiedDeps.length > 0) {
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

      return this as unknown as ReadyWorkflow<State, FirstState, EmptyDecorator>
    }
  }

  return workflow
}

function toRivrPlugin<State, FirstState>(
  plugin: Function,
  getRandomName: () => string
) {
  Object.defineProperty(plugin, "opts", {
    value: {
      name: getRandomName()
    }
  })

  return plugin as RivrPlugin<EmptyDecorator, unknown, State, FirstState>
}

function isRivrPlugin<NewDecorators, State, FirstState>(plugin: Function): plugin is RivrPlugin<NewDecorators, unknown, State, FirstState> {
  return "opts" in plugin
}

function decorate<State, FirstState, K extends string, V> (
  this: Workflow<State, FirstState>,
  key: K,
  value: V
) {
  if (this.registeredDecorators.includes(key)) {
    throw new Error(`Cannot decorate the same property '${key}' twice`)
  }

  Object.defineProperty(this, key, { value })
  this.registeredDecorators.push(key)
  return this as unknown as PublicWorkflow<State, FirstState, EmptyDecorator & Record<K, V>>
}

export const rivr = {
  workflow<State>(name: string): PublicWorkflow<State, State, Record<never, never>> {
    return createRootWorkflow(name)
  }
}