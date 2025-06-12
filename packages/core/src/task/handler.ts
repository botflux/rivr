import {isState, OutboxState, updateState} from "./state";
import {Queue} from "../queue";
import {Task, TaskResult} from "./types";
import {WorkerHandler} from "../worker";
import {randomUUID} from "crypto";

export async function handleState (
  queue: Queue<unknown>,
  outbox: Task<unknown, Record<never, never>>,
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
  outbox: Task<unknown, Record<never, never>>,
  state: OutboxState
): Promise<TaskResult> {
  try {
    const opts = outbox.getHandler()

    const result = await opts.handler({
      state: state.state,
      task: outbox,
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

function isResult (value: unknown): value is TaskResult {
  return typeof value === "object" && value !== null
    && "type" in value && (value.type === "success" || value.type === "error")
}

export function createTaskHandler (tasks: Task<unknown, Record<never, never>>[]): WorkerHandler {
  return async (primary, { payload }) => {
    if (!isState(payload)) {
      return false
    }

    const mTask = tasks.find(task => task.name === payload.name)

    if (!mTask) {
      console.log("outbox not found")
      return true
    }

    const ready = await mTask.ready()
    const handler = mTask.getHandler()

    await handler.handler({ attempt: 1, task: ready, state: payload.state })
    return true
  }
}