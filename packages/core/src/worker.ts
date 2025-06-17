import {Consumption, Message, Queue} from "./queue";
import {updateWorkflowState, WorkflowState} from "./workflow/state/state";
import {ReadyWorkflow, Step, StepResult, Workflow} from "./workflow/types";
import {randomUUID} from "crypto";
import {isOutboxState} from "./outbox/handler";
import {OutboxState} from "./outbox/types";

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
  #consumptions: Consumption[] = []
  #onErrorHooks: OnError[] = []

  constructor(opts: CreateWorkerOpts) {
    this.#opts = opts;
  }

  async start(): Promise<void> {
    await Promise.all(this.#opts.workflows.map(w => w.ready()))

    const { primary, secondaries = [] } = this.#opts
    const queues = [ primary, ...secondaries ]

    this.#consumptions = queues.map(queue => queue.consume({
      onMessage: async msg => {
        const { payload } = msg

        if (this.#isWorkflowState(payload)) {
          await this.#handleWorkflow(payload)
        } else if (isOutboxState(payload)) {
          await this.#handleOutbox(payload)
        } else {
          console.warn("unknown message", msg)
        }

      }
    }))

    await Promise.all(
      this.#consumptions.map(c => c.start())
    )
  }

  async stop(): Promise<void> {
    await Promise.all(this.#consumptions.map(c => c.stop()))
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
      await hook(context, step, state.toExecute.state)
    }

    const result = await this.#executeHandler(step, context, state)
    const newState = updateWorkflowState(state, step, result)

    for (const { context, item: hook } of mWorkflow.getHook("onStepHandled")) {
      await hook(context, step, result, newState)
    }

    if (newState.status === "successful") {
      for (const { context, item: hook } of mWorkflow.getHook("onWorkflowCompleted")) {
        await hook(context, newState.toExecute.state)
      }
    } else if (newState.status === "stopped") {
      for (const { context, item: hook } of mWorkflow.getHook("onWorkflowStopped")) {
        await hook(context, step, newState.toExecute.state)
      }
    } else if (newState.status === "failed" && result.type === "failure") {
      for (const { context, item: hook } of mWorkflow.getHook("onWorkflowFailed")) {
        await hook(result.error, context, step, newState.toExecute.state)
      }
    }

    if (newState.status === "in_progress") {
      await this.#produce([
        {
          id: randomUUID(),
          type: "workflow",
          payload: newState,
          ...newState.toExecute.pickAfter !== undefined && { pickAfter: newState.toExecute.pickAfter },
          createdAt: new Date()
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

  async #handleOutbox(state: OutboxState) {
    await this.#produce([ state.payload ])
  }

  async #produce(messages: Message[]) {
    const delayedMessages = messages.filter(message => message.pickAfter !== undefined)
    const notDelayedMessages = messages.filter(message => message.pickAfter === undefined)

    const delayedProducer = [ this.#opts.primary, ...this.#opts.secondaries ?? [] ]
      .find(p => p.supportsDelayedMessages())

    if (delayedProducer === undefined && delayedMessages.length !== 0) {
      throw new Error("Cannot produce delayed messages because the worker has no queues supporting them configured")
    }

    if (delayedMessages.length > 0) {
      await delayedProducer?.produce(delayedMessages)
    }

    if (notDelayedMessages.length > 0) {
      await this.#opts.primary.produce(notDelayedMessages)
    }
  }
}

export type CreateWorkerOpts = {
  primary: Queue<unknown>

  /**
   * A list of read-only queues.
   *
   * Usually, the secondaries are your database-backed queues,
   * while your primary is a messaging system.
   */
  secondaries?: Queue<unknown>[]

  /**
   * The workflows the worker must execute.
   */
  workflows: Workflow<any, any, Record<string, never>, Record<never, never>>[]
}

export function createWorker (opts: CreateWorkerOpts): Worker {
  return new DefaultWorker(opts)
}