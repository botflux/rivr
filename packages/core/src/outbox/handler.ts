import {isState, OutboxState, updateState} from "./state";
import {Queue} from "../queue";
import {Outbox, OutboxResult} from "./types";
import {WorkerHandler} from "../worker";
import {randomUUID} from "crypto";

export async function handleState (
  queue: Queue<unknown>,
  outbox: Outbox<unknown, Record<never, never>>,
  state: OutboxState
): Promise<void> {
  const result = await execHandler(outbox, state)
  const newState = updateState(state, outbox, result, new Date())

  await queue.produce([
    {
      type: "outbox",
      id: randomUUID(),
      payload: newState
    }
  ])
}

async function execHandler (
  outbox: Outbox<unknown, Record<never, never>>,
  state: OutboxState
): Promise<OutboxResult> {
  try {
    const opts = outbox.getHandler()

    const result = await opts.handler({
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

export function createOutboxHandler (outboxes: Outbox<unknown, Record<never, never>>[]): WorkerHandler {
  return async (primary, { payload }) => {
    if (!isState(payload)) {
      return false
    }

    const mOutbox = outboxes.find(outbox => outbox.name === payload.name)

    if (!mOutbox) {
      console.log("outbox not found")
      return true
    }

    const ready = await mOutbox.ready()
    const handler = mOutbox.getHandler()

    await handler.handler({ attempt: 1, outbox: ready, state: payload.state })
    return true
  }
}