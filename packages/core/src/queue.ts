export type StopReason = "unrecoverable_error" | "manually_stopped"

export interface Consumer {
  /**
   * Start the consumption
   */
  start(): Promise<void>

  /**
   * Stop the consumption
   */
  stop(): Promise<void>

  addHook(hook: "onStart", handler: () => void): this
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this
  addHook(hook: "onError", handler: (error: unknown) => void): this
}

export type ConsumptionHooks = {
  onStart: () => void
  onStop: (reason: StopReason, error?: unknown) => void
  onError: (error: unknown) => void
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

  createdAt: Date
}

export interface OnMessage {
  (msg: Message): Promise<void>
}

export interface ConsumerOpts {
  onMessage: OnMessage
}

export interface Producer<WriteOpts> {
  /**
   * Produce messages in the queue.
   *
   * @param messages
   * @param opts
   */
  produce(messages: Message[], opts?: WriteOpts): Promise<void>

  /**
   * Returns true if delayed messages can be produced; otherwise false.
   */
  supportsDelayedMessages(): boolean

  disconnect(): Promise<void>
}

export interface Queue<WriteOpts> {
  createProducer(): Producer<WriteOpts>
  /**
   * Create a new consumption.
   *
   * @param opts
   */
  createConsumers(opts: ConsumerOpts): Consumer
  disconnect(): Promise<void>
}
