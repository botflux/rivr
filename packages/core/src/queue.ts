export interface Consumption {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface Message {
  /**
   * An ID representing the task (e.g. the workflow id, the outbox id).
   */
  taskId: string
  payload: unknown
}

export interface OnMessage {
  (msg: Message): Promise<void>
}

export interface ConsumeOpts {
  onMessage: OnMessage
}

export interface Queue<WriteOpts> {
  /**
   * Create a new consumption.
   *
   * @param opts
   */
  consume(opts: ConsumeOpts): Consumption

  /**
   * Produce messages in the queue.
   *
   * @param messages
   * @param opts
   */
  produce(messages: Message[], opts?: WriteOpts): Promise<void>
}
