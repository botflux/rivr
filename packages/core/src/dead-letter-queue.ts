import {CreateMessage, Message, Producer} from "./queue";

export const kDeadLetterQueue= Symbol("kDeadLetterQueue")
export type CreateDeadLetter = {
  id?: string
  reason: string
  message: CreateMessage
}
export type DeadLetter = {
  id: string
  reason: string
  message: Message
  createdAt: Date
}
export type ReintegrateResult = {
  reintegratedCount: number
}

export interface DeadLetterQueue<WriteOpts> {
  [kDeadLetterQueue]: true

  /**
   * Produce a dead letter
   *
   * @param messages
   * @param opts
   */
  produce(messages: CreateDeadLetter[], opts?: WriteOpts): Promise<DeadLetter[]>

  /**
   * Reintegrate dead letters into the normal flow.
   *
   * @param count the number of dead letters you want to reintegrate
   * @param producer the producer in which the dead letters are produced
   */
  reintegrateFirsts(count: number | 'all', producer: Producer<never>): Promise<ReintegrateResult>

  disconnect(): Promise<void>
}

export type ReintegrateManyResult = {
  /**
   * The list of dead letters that were reintegrated successfully.
   */
  reintegratedIds: string[]

  /**
   * The list of ids that match no dead letter.
   */
  missingIds: string[]

  /**
   * The list of dead letters that were not reintegrated because
   * their ID were updated.
   */
  wrongVersionIds: string[]
}

export type ListDeadLettersResult = {
  count: number
  results: DeadLetter[]
}

export type ListDeadLettersOpts = {
  page?: string
  pageSize?: number
  messageTypes?: string[]
  reasons?: string[]
}

export interface AdvancedDeadLetterQueue<WriteOpts> extends DeadLetterQueue<WriteOpts> {
  /**
   * List dead letters.
   *
   * @param opts
   */
  list(opts?: ListDeadLettersOpts): Promise<ListDeadLettersResult>

  /**
   * Reintegrate the message matching the given ID.
   * Throw an error if the given ID matches no dead letter.
   *
   * @param id Dead letter's ID
   * @param version Dead letter's version
   * @param producer
   */
  reintegrateOne(id: string, version: string, producer: Producer<never>): Promise<void>

  /**
   * Reintegrate a batch of dead letters from their IDs.
   *
   * @param ids
   * @param producer
   */
  reintegrateMany(ids: IdAndVersion[], producer: Producer<never>): Promise<ReintegrateManyResult>
}

export type IdAndVersion = {
  id: string
  version: string
}