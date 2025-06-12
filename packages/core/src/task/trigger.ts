import {Queue} from "../queue";
import {Task} from "./types";
import {createState, OutboxState} from "./state";
import {randomUUID} from "crypto";

/**
 * Trigger a task.
 *
 * @param queue The queue where the task's state will be produced
 * @param task
 * @param state The state to produce in the queue
 * @param writeOpts The options to pass to `queue.produce(messages, writeOpts)`.
 */
export async function trigger<State, Decorators extends Record<never, never>, WriteOpts> (
  queue: Queue<WriteOpts>,
  task: Task<State, Decorators>,
  state: State,
  writeOpts?: WriteOpts
): Promise<OutboxState> {
  const taskState = createState(
    task,
    state,
    randomUUID(),
    new Date()
  )

  await queue.produce([
    {
      type: "task",
      id: randomUUID(),
      payload: taskState
    }
  ], writeOpts)

  return taskState
}
