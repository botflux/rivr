import {Message, Producer, Queue} from "../queue";

export const kOutbox = Symbol("kOutbox");

export type OutboxMessage = {
  id: string
  type: string
  createdAt: Date
  payload: Message
}

/**
 * An outbox is just a thin wrapper around a queue.
 * Everytime you produce through an outbox instance,
 * the actual payload will be wrapper in an outbox state.
 *
 * Then, when the message get consumed, the outbox state is
 * unpacked and the actual payload is republished.
 */
export interface Outbox<WriteOpts> {
  [kOutbox]: true

  /**
   * Produce messages in an outbox.
   *
   * @param messages
   * @param opts
   */
  produce(messages: OutboxMessage[], opts?: WriteOpts): Promise<void>
}

export type OutboxState = {
  type: "outbox"
  payload: Message
}

class DefaultOutbox<WriteOpts> implements Outbox<WriteOpts> {
  [kOutbox]: true = true
  #queue: Queue<WriteOpts>

  constructor(queue: Queue<WriteOpts>) {
    this.#queue = queue;
  }

  async produce(messages: OutboxMessage[], opts?: WriteOpts): Promise<void> {
    await this.#queue.produce(
      messages,
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