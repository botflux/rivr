import {OutboxState} from "./types";
import {Message, Queue} from "../queue";
import {randomUUID} from "crypto";

export function isOutboxState (value: unknown): value is OutboxState {
  return typeof value === "object" && value !== null
    && "type" in value && value.type === "outbox"
}

export function createOutboxHandler () {
  return async (primary: Queue<unknown>, message: Message)=> {
    const { payload } = message

    if (!isOutboxState(payload)) {
      return false
    }

    await primary.produce([
      {
        type: message.type,
        id: randomUUID(),
        payload: payload.payload,
      }
    ])

    return true
  }
}