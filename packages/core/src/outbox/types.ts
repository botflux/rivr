import {ConsumeOpts, Consumption, Message, Producer, Queue} from "../queue";

export const kOutbox = Symbol("kOutbox");

/**
 * An outbox is just a thin wrapper around a queue.
 * Everytime you produce through an outbox instance,
 * the actual payload will be wrapper in an outbox state.
 *
 * Then, when the message get consumed, the outbox state is
 * unpacked and the actual payload is republished.
 */
export interface Outbox<WriteOpts> extends Producer<WriteOpts> {
  [kOutbox]: true
}

export type OutboxState = {
  type: "outbox"
  payload: unknown
}

class DefaultOutbox<WriteOpts> implements Outbox<WriteOpts> {
  [kOutbox]: true = true
  #queue: Queue<WriteOpts>

  constructor(queue: Queue<WriteOpts>) {
    this.#queue = queue;
  }

  async produce(messages: Message[], opts?: WriteOpts): Promise<void> {
    await this.#queue.produce(
      messages.map(message => ({
        ...message,
        payload: { type: "outbox", payload: message.payload } satisfies OutboxState,
      })),
      opts
    )
  }

  disconnect(): Promise<void> {
    return this.#queue.disconnect()
  }
}

export function createOutbox<WriteOpts>(queue: Queue<WriteOpts>): Outbox<WriteOpts> {
  return new DefaultOutbox(queue)
}