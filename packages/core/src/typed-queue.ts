import {Consumption} from "./queue";

export interface TypedMessage<T> {
  /**
   * An ID representing the task (e.g. the workflow id, the outbox id).
   */
  taskId: string
  payload: T
}

export interface TypedOnMessage<T> {
  (msg: TypedMessage<T>): Promise<void>
}

export interface TypedConsumeOpts<T> {
  onMessage: TypedOnMessage<T>
}

/**
 * This interface is exactly the same as the `Queue<WriteOpts>`
 * interface except that the messages consumed and produced are typed.
 *
 * This interface is needed, because sometimes the queue abstraction
 * need to know what to do with the produced items.
 *
 * For example, a RabbitMQ queue implementation must not produce
 * the outbox state that are done. Same for the workflow states mark
 * as done.
 *
 * Note that there is no duplication between the `TypedQueue` and `Queue`
 * implementations. An engine should always implement the `Queue` interface,
 * and it should use the utility implementation such as `PassThroughTypedQueue` or
 * `FilterTypedQueue` if operation needs to be done on the typed rivr object.
 */
export interface TypedQueue<T, WriteOpts> {
  /**
   * Create a new consumption.
   *
   * @param opts
   */
  consume(opts: TypedConsumeOpts<T>): Consumption

  /**
   * Produce messages in the queue.
   *
   * @param messages
   * @param opts
   */
  produce(messages: TypedMessage<T>[], opts?: WriteOpts): Promise<void>
}
