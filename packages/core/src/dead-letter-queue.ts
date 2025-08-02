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
  version: string
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
   * Reintegrate a batch of dead letters from their IDs.
   *
   * @param ids
   */
  reintegrateMany(ids: string[]): Promise<ReintegrateManyResult>
}

export type IdAndVersion = {
  id: string
  version: string
}