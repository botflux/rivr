export class TooFastPromiseError extends Error {
  constructor(min: number, actual: number) {
    super(
      `The promise resolved too fast. It should have resolved after ${min}ms ` +
      `but it resolved in ${actual}ms. You can still lower the minimum amount of time to await.`
    )

    this.name = TooFastPromiseError.name
    Object.setPrototypeOf(this, TooFastPromiseError.prototype)
  }
}

export class TooSlowPromiseError extends Error {
  constructor(timeout: number) {
    super(
      `The awaited promise takes too long to resolve. Maybe, you could try the increase the timeout? ` +
      `The current timeout is ${timeout}ms.`
    )

    this.name = TooSlowPromiseError.name
    Object.setPrototypeOf(this, TooSlowPromiseError.prototype)
  }
}

export function waitOrTimeout<T>(
  promise: Promise<T>,
  timeout: number
): Promise<T> {
  let time: NodeJS.Timeout | undefined

  promise.finally(() => {
    if (time !== undefined) clearTimeout(time)
  })

  return Promise.race([
    promise,
    new Promise((resolve) => {
      time = setTimeout(resolve, timeout)
    }).then(() => Promise.reject(new TooSlowPromiseError(timeout))),
  ])
}

export function waitAtLeastOrTimeout<T>(
  promise: Promise<T>,
  min: number,
  max: number
): Promise<T> {
  const startTime = new Date().getTime()

  return waitOrTimeout(promise, max).then(async (value) => {
    const endTime = new Date().getTime()
    const delta = endTime - startTime

    if (delta < min) {
      return await Promise.reject(new TooFastPromiseError(min, delta))
    }

    return value
  })
}
