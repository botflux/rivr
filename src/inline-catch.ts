export type Result<T, E = Error> = [T, null] | [null, E];

export function tryCatchSync<T, E = Error>(
  fn: () => T
): Result<T, E> {
  try {
    return [ fn(), null ]
  } catch (error) {
    return [null, error as E]
  }
}
