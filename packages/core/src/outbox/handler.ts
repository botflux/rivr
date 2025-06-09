import {OutboxState, updateState} from "./state";
import {Queue} from "../queue";
import {Outbox, OutboxResult} from "./types";

export async function handleState (
  queue: Queue<unknown>,
  outbox: Outbox<unknown, Record<never, never>>,
  state: OutboxState
): Promise<void> {
  const result = await execHandler(outbox, state)
  const newState = updateState(state, outbox, result, new Date())

  await queue.produce([
    {
      taskId: newState.id,
      payload: newState
    }
  ])
}

async function execHandler (
  outbox: Outbox<unknown, Record<never, never>>,
  state: OutboxState
): Promise<OutboxResult> {
  try {
    const handler = outbox.getHandler()

    const result = await handler({
      state: state.state,
      outbox,
      attempt: state.attempt
    })

    if (isResult(result)) {
      return result
    }

    return { type: "success" }
  } catch (error: unknown) {
    return { type: "error", error }
  }
}

function isResult (value: unknown): value is OutboxResult {
  return typeof value === "object" && value !== null
    && "type" in value && (value.type === "success" || value.type === "error")
}