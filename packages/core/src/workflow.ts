import {
  OnStepCompletedHook,
  OnStepErrorHook,
  OnStepSkippedHook,
  OnWorkflowCompletedHook,
  OnWorkflowFailedHook,
  OnWorkflowStoppedHook, PlainPlugin,
  ReadyWorkflow, RivrPlugin,
  Step,
  StepOpts,
  WithContext,
  Workflow as PublicWorkflow,
} from "./types";
import {ArrayAdapter, List, Slice} from "./utils/list"
import {WorkflowState} from "./pull/state";

type EmptyDecorator = Record<never, never>
type EmptyStateByStep = Record<never, never>

type StepElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "step"
  id: number
  context: Workflow<State, FirstState, StateByStepName>
  step: Step
}

type Hook =
  | { type: "onStepCompleted", hook: OnStepCompletedHook<EmptyDecorator> }
  | { type: "onStepError", hook: OnStepErrorHook<EmptyDecorator> }
  | { type: "onStepSkipped", hook: OnStepSkippedHook<EmptyDecorator> }
  | { type: "onWorkflowCompleted", hook: OnWorkflowCompletedHook<EmptyDecorator> }
  | { type: "onWorkflowFailed", hook: OnWorkflowFailedHook<EmptyDecorator> }
  | { type: "onWorkflowStopped", hook: OnWorkflowStoppedHook<EmptyDecorator> }

type HookElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "hook"
  context: Workflow<State, FirstState, StateByStepName>
  hook: Hook
  id: number
}

type PluginElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "plugin"
  id: number
  context: Workflow<State, FirstState, StateByStepName>
  plugin: RivrPlugin<unknown, unknown, Record<string, never>, Record<never, never>, unknown, any>
  pluginOpts?: unknown | ((w: Workflow<State, FirstState, StateByStepName>) => unknown)
}

type RootElement<State, FirstState, StateByStepName extends EmptyStateByStep> = {
  type: "root"
  id: number
  context: Workflow<State, FirstState, StateByStepName>
}

type NodeElement<State, FirstState, StateByStepName extends EmptyStateByStep> =
  | StepElement<State, FirstState, StateByStepName>
  | HookElement<State, FirstState, StateByStepName>
  | PluginElement<State, FirstState, StateByStepName>
  | RootElement<State, FirstState, StateByStepName>

interface Workflow<State, FirstState, StateByStepName extends EmptyStateByStep> extends PublicWorkflow<State, FirstState, StateByStepName, EmptyDecorator> {
  list: List<NodeElement<State, FirstState, StateByStepName>>
  pluginStartIndex: number
  registeredDecorators: string[]
  registeredPlugins: string[]
  isReady: boolean
  generateNewNodeId(): number
  nextNodeId: number
  autoPluginId: number
}

function isStep<State, FirstState, StateByStepName extends EmptyStateByStep>(node: NodeElement<State, FirstState, StateByStepName>): node is StepElement<State, FirstState, StateByStepName> {
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
    registeredPlugins: [],
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
        } as Hook
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
        } as Step
      })

      return this as unknown as Workflow<StateOut, FirstState, StateByStepName & Record<Name, State>>
    },
    getFirstStep(): Step | undefined {
      for (const node of this.list) {
        if (node.type === "step") {
          return node.step
        }
      }
    },
    getStepByName(name: string): WithContext<Step> | undefined {
      for (const node of this.list) {
        if (node.type === "step" && node.step.name === name) {
          return { item: node.step, context: node.context as ReadyWorkflow<unknown, unknown, Record<string, never>, Record<never, never>> }
        }
      }
    },
    getNextStep(name: string): Step | undefined {
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
    steps(): Iterable<WithContext<Step>> {
      return Array.from(this.list)
        .filter(node => isStep<State, FirstState, StateByStepName>(node))
        .map(node => ({ item: node.step, context: node.context } as WithContext<Step>))
    },
    // @ts-expect-error
    getHook(hook) {
      return Array.from(this.list)
        .filter(isHook)
        .filter(isHookType(hook))
        .map(node => ({
          item: node.hook.hook,
          context: node.context
        }))
    },
    register<OutState, OutStateByStepName extends StateByStepName, OutDecorators extends EmptyDecorator, PluginOpts>(
      plugin: PlainPlugin<State, FirstState, StateByStepName, EmptyDecorator, OutState, OutStateByStepName, OutDecorators> | RivrPlugin<OutState, State, OutStateByStepName, OutDecorators, PluginOpts, any>,
      opts?: PluginOpts
    ): PublicWorkflow<OutState, FirstState, OutStateByStepName, OutDecorators> {
      const child = createChildWorkflow(this, this.list, this.list.length + 1)
      const pluginWithName = isPlainPlugin(plugin)
        ? toRivrPlugin(plugin, () => this.autoPluginId ++)
        : plugin

      this.list.append({
        type: "plugin",
        plugin: pluginWithName as unknown as RivrPlugin<unknown, unknown, Record<string, never>, Record<never, never>, unknown, any>,
        context: child,
        pluginOpts: opts,
        id: this.generateNewNodeId()
      })

      return child as unknown as PublicWorkflow<OutState, FirstState, OutStateByStepName, OutDecorators>
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

        const unregisteredPluginList = node.plugin.deps
          .map(pl => pl.name)
          .filter(depName => !this.registeredPlugins.find(name => name === depName))

        if (unregisteredPluginList.length > 0) {
          const formattedPluginList = unregisteredPluginList
            .map(name => `"${name}"`)
            .join(", ")

          throw new Error(`Plugin "${node.plugin.name}" needs ${formattedPluginList} to be registered`)
        }

        this.registeredPlugins.push(node.plugin.name)

        const pluginScope = createPluginWorkflow(
          node.context,
          new Slice(node.context.list, node.context.pluginStartIndex)
        )

        const pluginOpts = typeof node.pluginOpts === "function"
          ? node.pluginOpts(this)
          : node.pluginOpts

        // TODO: find out why I need to cast with `as never`.
        node.plugin(pluginScope as never, pluginOpts)
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

function isPlainPlugin<State, FirstState, StateByStepName extends Record<string, never>, OutState, OutStateByStepName extends StateByStepName, OutDecorators extends EmptyDecorator, PluginOpts>(
  plugin: PlainPlugin<State, FirstState, StateByStepName, EmptyDecorator, OutState, OutStateByStepName, OutDecorators> | RivrPlugin<OutState, State, OutStateByStepName, OutDecorators, PluginOpts, any>
): plugin is PlainPlugin<State, FirstState, StateByStepName, EmptyDecorator, OutState, OutStateByStepName, OutDecorators> {
  return !("deps" in plugin)
}

function toRivrPlugin<State, FirstState, StateByStepName extends Record<string, never>, OutState, OutStateByStepName extends StateByStepName, OutDecorators extends EmptyDecorator>(
  plain: PlainPlugin<State, FirstState, StateByStepName, EmptyDecorator, OutState, OutStateByStepName, OutDecorators>,
  getAutoPluginId: () => number
): RivrPlugin<State, FirstState, StateByStepName, EmptyDecorator, never, any> {
  Object.defineProperty(plain, "name", {
    value: `auto-plugin-${getAutoPluginId()}`,
  })

  Object.defineProperty(plain, "deps", { value: [] })

  // @ts-expect-error
  return plain as RivrPlugin<State, FirstState, StateByStepName, EmptyDecorator, never, any>
}

export const rivr = {
  workflow<State>(name: string): PublicWorkflow<State, State, EmptyStateByStep, Record<never, never>> {
    return createRootWorkflow(name)
  }
}