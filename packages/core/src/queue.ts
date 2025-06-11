export interface Consumption {
  /**
   * Start the consumption
   */
  start(): Promise<void>

  /**
   * Stop the consumption
   */
  stop(): Promise<void>
}

export interface Message {
  /**
   * The date after which the message should be consumed.
   */
  pickAfter?: Date

  /**
   * The message's ID.
   */
  id: string

  /**
   * The message's type
   */
  type: string

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

  disconnect(): Promise<void>
}
