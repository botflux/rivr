export class Workflow {
  decorate<K extends string, V>(key: K, value: V): Workflow & Record<K, V> {
    // @ts-expect-error
    Workflow.prototype[key] = undefined
    // @ts-expect-error 
    this[key] = value
    return this as Workflow & Record<K, V>
  }
}

export type Plugin<In extends Workflow, Out extends In> =
  (workflow: In) => Out

export type WorkflowPlugin<In extends Workflow, Out extends In> (workflow: In) => Out

export class WorkflowBuilder<W extends Workflow> {
  register<WOut extends W>(plugin: WorkflowPlugin<W, WOut>): WorkflowBuilder<WOut> {
    return this as unknown as WorkflowBuilder<WOut>
  }

  withEngineContext<T>(): this {
    return this
  }

  step(...args: any[]): this {
    return this
  }

  addHook(hook: "onStep", handler: (wf: W) => void): this
  addHook(hook: "onStepCompleted", handler: (wf: W) => void): this
  addHook(hook: "onStep" | "onStepCompleted", handler: (wf: W) => void): this {
    return this
  }
}