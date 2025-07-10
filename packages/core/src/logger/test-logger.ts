import {Additional, Logger} from "./logger";

export type CollectedLog = {
  message: string
  level: string
} & Additional

export class TestLogger implements Logger {
  messages: CollectedLog[] = []

  warn(message: string, additional: Additional = {}): void {
    this.messages.push({ message, level: "warn", ...additional })
  }
}