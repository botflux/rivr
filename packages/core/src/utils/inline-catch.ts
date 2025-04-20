export type Result<T, E = Error> = [T, undefined] | [undefined, E];

export async function tryCatch<T, E = Error>(
  promise: Promise<T>
): Promise<Result<T, E>> {
  try {
    return [ await promise, undefined ]
  } catch (e: unknown) {
    return [ undefined, e as E ]
  }
}

export function tryCatchSync<T, E = Error>(
  fn: () => T
): Result<T, E> {
  try {
    return [ fn(), undefined ]
  } catch (error) {
    return [undefined, error as E]
  }
}