import {OutboxState} from "./types";

export function isOutboxState (value: unknown): value is OutboxState {
  return typeof value === "object" && value !== null
    && "type" in value && value.type === "outbox"
}
