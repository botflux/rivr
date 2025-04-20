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

type StepElement<State> = {
  type: "step"
  id: number
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
  id: number
}

type PluginElement<State> = {
  type: "plugin"
  id: number
  context: Workflow<State>
  plugin: RivrPlugin<EmptyDecorator, unknown, State>
  pluginOpts?: unknown | ((w: Workflow<State>) => unknown)
}

type RootElement<State> = {
  type: "root"
  id: number
  context: Workflow<State>
}

type NodeElement<State> =
  | StepElement<State>
  | HookElement<State>
  | PluginElement<State>
  | RootElement<State>

interface Workflow<State> extends PublicWorkflow<State, EmptyDecorator> {
  list: List<NodeElement<State>>
  pluginStartIndex: number
  registeredDecorators: string[]
  isReady: boolean
  generateNewNodeId(): number
  nextNodeId: number
  autoPluginId: number
}

function isStep<State>(node: NodeElement<State>): node is StepElement<State> {
  return node.type === 'step'
}

function isHook<State>(node: NodeElement<State>): node is HookElement<State> {
  return node.type === 'hook'
}

function isPlugin<State>(node: NodeElement<State>): node is PluginElement<State> {
  return node.type === 'plugin'
}

function isHookType<Hook> (hook: Hook) {
  return function<State> (node: HookElement<State>): node is HookElement<State> & { hook: { type: Hook } } {
    return node.hook.type === hook
  }
}

function createPluginWorkflow<State>(parent: Workflow<State>, list: List<NodeElement<State>>): Workflow<State> {
  const workflow = {
    decorate<K extends string, V>(key: K, value: V): PublicWorkflow<State, EmptyDecorator & Record<K, V>> {
      // @ts-expect-error
      parent.decorate.call(parent, key, value)
      return this as unknown as PublicWorkflow<State, EmptyDecorator & Record<K, V>>
    },
    list,
  } as Workflow<State>
  Object.setPrototypeOf(workflow, parent)
  return workflow
}

function createChildWorkflow<State>(parent: Workflow<State>, list: List<NodeElement<State>>, startIndex: number): Workflow<State> {
  const workflow = {
    list,
    registeredDecorators: [] as string[],
    pluginStartIndex: startIndex,
    isReady: false
  } as Workflow<State>
  Object.setPrototypeOf(workflow, parent)

  return workflow
}

function createRootWorkflow<State> (name: string) {
  const list = new ArrayAdapter<NodeElement<State>>()
  const workflow: Workflow<State> = {
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
        context: this as Workflow<State>,
        hook: {
          type: hook,
          hook: handler
        } as Hook<State>
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
    step(opts: StepOpts<State, EmptyDecorator>) {
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
    getFirstStep(): Step<State, EmptyDecorator> | undefined {
      for (const node of this.list) {
        if (node.type === "step") {
          return node.step
        }
      }
    },
    getStepAndExecutionContext(name: string): WithContext<Step<State, EmptyDecorator>, State, EmptyDecorator> | undefined {
      for (const node of this.list) {
        if (node.type === "step" && node.step.name === name) {
          return [ node.step, node.context ]
        }
      }
    },
    getNextStep(name: string): Step<State, EmptyDecorator> | undefined {
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
    steps(): Iterable<[step: Step<State, EmptyDecorator>, context: PublicWorkflow<State, EmptyDecorator>]> {
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
    register<NewDecorators>(plugin: Function, opts?: unknown | ((w: PublicWorkflow<State, EmptyDecorator>) => unknown)): PublicWorkflow<State, EmptyDecorator & NewDecorators> {
      const child = createChildWorkflow(this, this.list, this.list.length + 1)

      const rivrPlugin = isRivrPlugin<EmptyDecorator, State>(plugin)
        ? plugin
        : toRivrPlugin<State>(plugin, () => `auto-plugin-${this.autoPluginId++}`)

      this.list.append({
        type: "plugin",
        plugin: rivrPlugin,
        context: child,
        pluginOpts: opts,
        id: this.generateNewNodeId()
      })

      return child as unknown as PublicWorkflow<State, EmptyDecorator & NewDecorators>
    },
    async ready(): Promise<ReadyWorkflow<State, EmptyDecorator>> {
      if (this.isReady) {
        return this as unknown as ReadyWorkflow<State, EmptyDecorator>
      }

      let visited: number[] = []
      let index = 0

      for (const node of this.list) {
        if (visited.includes(node.id))
          continue

        visited.push(node.id)

        if (node.type !== "plugin")
          continue

        const deps = (node.plugin.opts.deps ?? []) as RivrPlugin<any, any, any>[]

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

      return this as unknown as ReadyWorkflow<State, EmptyDecorator>
    }
  }

  return workflow
}

function toRivrPlugin<State>(
  plugin: Function,
  getRandomName: () => string
) {
  Object.defineProperty(plugin, "opts", {
    value: {
      name: getRandomName()
    }
  })

  return plugin as RivrPlugin<EmptyDecorator, unknown, State>
}

function isRivrPlugin<NewDecorators, State>(plugin: Function): plugin is RivrPlugin<NewDecorators, unknown, State> {
  return "opts" in plugin
}

function decorate<State, K extends string, V> (
  this: Workflow<State>,
  key: K,
  value: V
) {
  if (this.registeredDecorators.includes(key)) {
    throw new Error(`Cannot decorate the same property '${key}' twice`)
  }

  Object.defineProperty(this, key, { value })
  this.registeredDecorators.push(key)
  return this as unknown as PublicWorkflow<State, EmptyDecorator & Record<K, V>>
}

export const rivr = {
  workflow<State>(name: string): PublicWorkflow<State, Record<never, never>> {
    return createRootWorkflow(name)
  }
}