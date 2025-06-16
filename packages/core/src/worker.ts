import {Consumption, Queue} from "./queue";
import {updateWorkflowState, WorkflowState} from "./workflow/state/state";
import {ReadyWorkflow, Step, StepResult, Workflow} from "./workflow/types";
import {randomUUID} from "crypto";

export type OnError = (error: unknown) => void

export interface Worker {
  /**
   * Start the worker
   */
  start(): Promise<void>

  /**
   * Stop the worker
   */
  stop(): Promise<void>

  /**
   * Register an error hook.
   *
   * @param hook
   * @param fn
   */
  addHook(hook: "error", fn: OnError): void
}

class DefaultWorker implements Worker {
  #opts: CreateWorkerOpts
  #consumption: Consumption | undefined
  #onErrorHooks: OnError[] = []

  constructor(opts: CreateWorkerOpts) {
    this.#opts = opts;
  }

  async start(): Promise<void> {
    await Promise.all(this.#opts.workflows.map(w => w.ready()))

    this.#consumption = this.#opts.primary.consume({
      onMessage: async msg => {
        const { payload } = msg

        if (!this.#isWorkflowState(payload)) {
          console.warn("not a workflow state")
          return
        }

        await this.#handleWorkflow(payload)
      }
    })

    await this.#consumption?.start()
  }

  async stop(): Promise<void> {
    await this.#consumption?.stop()
  }

  addHook(hook: "error", fn: OnError): this {
    this.#onErrorHooks.push(fn)
    return this
  }

  #isWorkflowState(payload: unknown): payload is WorkflowState<unknown> {
    return typeof payload === "object" && payload !== null
      && "name" in payload && typeof payload.name === "string"
  }

  async #handleWorkflow(state: WorkflowState<unknown>) {
    const mWorkflow = this.#opts.workflows.find(w => w.name === state.name)

    if (!mWorkflow) {
      console.warn(`State '${state.id}' references to workflow '${state.name}' which was not passed to the worker`)
      return
    }

    const mStepAndExecutionContext = mWorkflow.getStepByName(state.toExecute.step)

    if (!mStepAndExecutionContext) {
      console.warn(`State '${state.id}' references to an unknown step '${state.toExecute.step}'`)
      return
    }

    const { item: step, context } = mStepAndExecutionContext

    for (const { context, item: hook } of mWorkflow.getHook("preStepHandler")) {
      hook(context, step, state.toExecute.state)
    }

    const result = await this.#executeHandler(step, context, state)
    const newState = updateWorkflowState(state, step, result)

    for (const { context, item: hook } of mWorkflow.getHook("onStepHandled")) {
      hook(context, step, result)
    }

    if (newState.status === "successful") {
      for (const { context, item: hook } of mWorkflow.getHook("onWorkflowCompleted")) {
        hook(context, newState.toExecute.state)
      }
    } else if (result.type === "stopped") {
      for (const { context, item: hook } of mWorkflow.getHook("onWorkflowStopped")) {
        hook(context, step, newState.toExecute.state)
      }
    } else if (result.type === "failure") {
      for (const { context, item: hook } of mWorkflow.getHook("onWorkflowFailed")) {
        hook(result.error, context, step, newState.toExecute.state)
      }
    }

    if (newState.status === "in_progress") {
      await this.#opts.primary.produce([
        {
          id: randomUUID(),
          type: "workflow",
          payload: newState
        }
      ])
    }
  }
  
  async #executeHandler(
    step: Step,
    context: ReadyWorkflow<unknown, unknown, Record<string, never>, Record<never, never>>,
    state: WorkflowState<unknown>
  ): Promise<StepResult<unknown>> {
    try {
      const stepResultOrResult = await step.handler({
        stop: () => ({ type: "stopped" }),
        err: (error: unknown) => ({ type: "failure", error }),
        skip: () => ({ type: "skipped" }),
        ok: (state) => ({ type: "success", state }),
        attempt: state.toExecute.attempt,
        state: state.toExecute.state,
        workflow: context
      })

      return this.#isStepResult(stepResultOrResult)
        ? stepResultOrResult
        : { type: "success", state: stepResultOrResult }
    } catch (error: unknown) {
      return { type: "failure", error }
    }
  }

  #isStepResult(value: unknown): value is StepResult<unknown> {
    return typeof value === "object" && value !== null
      && "type" in value && typeof value.type === "string"
      && [ "stopped", "success", "failure", "skipped" ].includes(value.type)
  }
}

export type CreateWorkerOpts = {
  primary: Queue<unknown>

  /**
   * The workflows the worker must execute.
   */
  workflows: Workflow<any, any, Record<string, never>, Record<never, never>>[]
}

export function createWorker (opts: CreateWorkerOpts): Worker {
  return new DefaultWorker(opts)
}