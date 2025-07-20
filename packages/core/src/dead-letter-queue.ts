import {CreateMessage, Message} from "./queue";

export const kDeadLetterQueue= Symbol("kDeadLetterQueue")
export type CreateDeadLetter = CreateMessage & {
  reason: string
}
export type DeadLetter = Message & {
  reason: string
}
export type ListDeadLettersResult = {
  count: number
  results: DeadLetter[]
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
   * This is the less specific method to list dead letters that should work
   * with db-based engines as well as messaging-based engines.
   *
   * @param count
   */
  list(count: number): Promise<ListDeadLettersResult>

  disconnect(): Promise<void>
}