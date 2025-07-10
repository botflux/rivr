import {MessageHandler} from "./handlers/message-handler";
import {Consumer, Message, Producer, Queue} from "../queue";
import {OnError, Worker} from "./worker";
import {WorkflowMessageHandler} from "./handlers/workflow-message-handler";
import {OutboxMessageHandler} from "./handlers/outbox-message-handler";
import {Workflow} from "../workflow/types";
import {WorkflowStateStorage} from "../workflow/state/storage";

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

  /**
   * Pass a workflow state storage in which the intermediate
   * state changes are stored.
   */
  workflowStateStorage?: WorkflowStateStorage
}

export function createWorker(opts: CreateWorkerOpts): Worker {
  const workflowHandler = new WorkflowMessageHandler(opts.workflows, opts.workflowStateStorage)
  const outboxHandler = new OutboxMessageHandler()
  const handlers = [workflowHandler, outboxHandler]

  return new DefaultWorker(opts, handlers)
}

export class DefaultWorker implements Worker {
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

    const {primary, secondaries = [], customConsumptions = []} = this.#opts
    const queues = [primary, ...secondaries]

    this.#consumptions = [
      ...queues.map(queue => queue.createConsumer({
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