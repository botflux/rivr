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
export async function trigger<State, WriteOpts> (
  queue: Queue<WriteOpts>,
  outbox: Outbox<State, Record<never, never>>,
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
      taskId: outboxState.id,
      payload: outboxState
    }
  ], writeOpts)

  return outboxState
}