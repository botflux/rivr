export type Additional = {
  type?: string
} & Record<string, unknown>

export interface Logger {
  warn(message: string, additional?: Additional): void
}