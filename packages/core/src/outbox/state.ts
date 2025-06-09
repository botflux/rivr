import {Outbox, OutboxResult} from "./types";

export type OutboxState = {
  type: "rivr_outbox"

  /**
   * An ID representing the outbox's state.
   */
  id: string

  /**
   * The outbox's name
   */
  name: string

  /**
   * The current status of this state.
   * Workers only look for `"todo"` outbox states.
   */
  status: "todo" | "done"

  /**
   * The date after which the worker should pick this outbox state.
   */
  pickAfter?: Date

  /**
   * The current attempts amount.
   */
  attempt: number

  state: unknown

  lastModified: Date
}

export function createState<State, Decorators extends Record<never, never>>(
  outbox: Outbox<State, Decorators>,
  state: State,
  id: string,
  now: Date
): OutboxState {
  return {
    type: "rivr_outbox",
    id,
    name: outbox.name,
    state,
    attempt: 1,
    status: "todo",
    lastModified: now
  }
}

export function updateState(
  state: OutboxState,
  outbox: Outbox<unknown, Record<never, never>>,
  result: OutboxResult,
  now: Date
): OutboxState {
  const newStatus = result.type === "success"
    ? "done"
    : "todo"

  const newAttempt = result.type === "error"
    ? state.attempt + 1
    : state.attempt

  return {
    ...state,
    lastModified: now,
    status: newStatus,
    attempt: newAttempt,
  }
}

export function isState (value: unknown): value is OutboxState {
  return typeof value === "object" && value !== null
    && "type" in value && value.type === "rivr_outbox"
}