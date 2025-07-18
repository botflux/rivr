import {CreateMessage, Message} from "../../queue";

/**
 * The message handler is an abstraction used by the
 * default worker.
 *
 * This abstraction's role is to decouple the worker from
 * the specifics of message handling.
 *
 * This is necessary because the worker has to manage multiple
 * types of messages: workflow messages and outbox messages.
 */
export interface MessageHandler<T> {
  /**
   * Returns true if the given message is supported by
   * this message handler.
   *
   * @param message
   */
  support(message: Message): message is Message & { payload: T }

  /**
   * Handles the actual message.
   *
   * You should execute `support` to verify that the message is
   * supported by this handler.
   *
   * Returns a list of messages to produce back.
   * Note that it is the worker's role to select the
   * queue in which each message should be produced.
   *
   * @param message
   */
  handle(message: Message & { payload: T }): Promise<CreateMessage[]>
}