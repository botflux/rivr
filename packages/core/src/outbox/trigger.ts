import {Queue} from "../queue";
import {Outbox} from "./types";
import {createState, OutboxState} from "./state";
import {randomUUID} from "crypto";

/**
 * Trigger an outbox.
 *
 * @param queue The queue where the outbox state will be produced
 * @param outbox
 * @param state The state to produce in the queue
 * @param writeOpts The options to pass to `queue.produce(messages, writeOpts)`.
 */
export async function trigger<State, Decorators extends Record<never, never>, WriteOpts> (
  queue: Queue<WriteOpts>,
  outbox: Outbox<State, Decorators>,
  state: State,
  writeOpts?: WriteOpts
): Promise<OutboxState> {
  const outboxState = createState(
    outbox,
    state,
    randomUUID(),
    new Date()
  )

  await queue.produce([
    {
      type: "outbox",
      id: randomUUID(),
      payload: outboxState
    }
  ], writeOpts)

  return outboxState
}