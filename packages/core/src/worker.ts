import {Consumer, Message, Producer, Queue} from "./queue";
import {updateWorkflowState, WorkflowState} from "./workflow/state/state";
import {ReadyWorkflow, Step, StepResult, Workflow} from "./workflow/types";
import {randomUUID} from "crypto";
import {isOutboxState} from "./outbox/handler";
import {OutboxMessage} from "./outbox/types";

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

export interface MessageHandler<T> {
  support(message: Message): message is Message & { payload: T }
  handle(message: Message & { payload: T }): Promise<Message[]>
}

class WorkflowMessageHandler implements MessageHandler<WorkflowState<unknown>> {
  #workflows: Workflow<any, any, Record<string, never>, Record<never, never>>[]

  constructor(workflows: Workflow<any, any, Record<string, never>, Record<never, never>>[]) {
    this.#workflows = workflows;
  }

  support(message: Message): message is Message & { payload: WorkflowState<unknown> } {
    const { payload } = message

    return typeof payload === "object" && payload !== null
      && "name" in payload && typeof payload.name === "string"
  }

  async handle(message: Message & { payload: WorkflowState<unknown> }): Promise<Message[]> {
    const { payload: state } = message
    const mWorkflow = this.#workflows.find(w => w.name === state.name)

    if (!mWorkflow) {
      console.warn(`State '${state.id}' references to workflow '${state.name}' which was not passed to the worker`)
      return []
    }

    const mStepAndExecutionContext = mWorkflow.getStepByName(state.toExecute.step)

    if (!mStepAndExecutionContext) {
      console.warn(`State '${state.id}' references to an unknown step '${state.toExecute.step}'`)
      return []
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
      return [
        {
          id: randomUUID(),
          type: "workflow",
          payload: newState,
          ...newState.toExecute.pickAfter !== undefined && { pickAfter: newState.toExecute.pickAfter },
          createdAt: new Date()
        }
      ]
    }

    return []
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

class OutboxMessageHandler implements MessageHandler<OutboxMessage> {
    support(message: Message): message is Message & { payload: OutboxMessage; } {
      return isOutboxState(message.payload)
    }
    async handle(message: Message & { payload: OutboxMessage; }): Promise<Message[]> {
        return [ message ]
    }
}

class DefaultWorker implements Worker {
  #opts: CreateWorkerOpts
  #handlers: MessageHandler<unknown>[]
  #consumptions: Consumer[] = []
  #producers: Producer<never>[]
  #primaryProducer: Producer<never>
  #onErrorHooks: OnError[] = []

  constructor(opts: CreateWorkerOpts, handlers: MessageHandler<unknown>[]) {
    this.#opts = opts;
    this.#handlers = handlers;
    this.#primaryProducer = opts.primary.createProducer()
    this.#producers = [
      this.#primaryProducer,
      ...(opts.secondaries ?? []).map(q => q.createProducer())
    ]
  }

  async start(): Promise<void> {
    await Promise.all(this.#opts.workflows.map(w => w.ready()))

    const { primary, secondaries = [], customConsumptions = [] } = this.#opts
    const queues = [ primary, ...secondaries ]

    this.#consumptions = [
      ...queues.flatMap(queue => queue.createConsumers({
        onMessage: async msg => {
          for (const handler of this.#handlers) {
            if (handler.support(msg)) {
              const messages = await handler.handle(msg)

              await this.#produce(messages)
            }
          }
        }
      })),
      ...customConsumptions
    ]

    await Promise.all(
      this.#consumptions.map(c => c.start())
    )
  }

  async stop(): Promise<void> {
    await Promise.all([
      ...this.#consumptions.map(c => c.stop()),
      ...this.#producers.map(p => p.disconnect())
    ])
  }

  addHook(hook: "error", fn: OnError): this {
    this.#onErrorHooks.push(fn)
    return this
  }

  async #produce(messages: Message[]) {
    const delayedMessages = messages.filter(message => message.pickAfter !== undefined)
    const notDelayedMessages = messages.filter(message => message.pickAfter === undefined)

    const delayedProducer = this.#producers
      .find(p => p.supportsDelayedMessages())

    if (delayedProducer === undefined && delayedMessages.length !== 0) {
      throw new Error("Cannot produce delayed messages because the worker has no queues supporting them configured")
    }

    if (delayedMessages.length > 0) {
      await delayedProducer?.produce(delayedMessages)
    }

    if (notDelayedMessages.length > 0) {
      await this.#primaryProducer.produce(notDelayedMessages)
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

  /**
   * Pass custom consumptions that the worker will start and stop.
   */
  customConsumptions?: Consumer[]
}

export function createWorker (opts: CreateWorkerOpts): Worker {
  const workflowHandler = new WorkflowMessageHandler(opts.workflows)
  const outboxHandler = new OutboxMessageHandler()
  const handlers = [ workflowHandler, outboxHandler ]

  return new DefaultWorker(opts, handlers)
}