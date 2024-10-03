import { clearInterval, setInterval } from "node:timers"

export function tryUntilSuccess (
    callback: () => Promise<void>,
    timeout: number,
    retries: number = 10
  ): Promise<void> {
    const frequency = timeout / retries
    const startTime = new Date().getTime()
    let timer: NodeJS.Timeout | undefined
  
    return new Promise<void>((resolve, reject) => {
      timer = setInterval(() => {
        callback()
          .then(() => {
            if (timer !== null) clearInterval(timer)
  
            resolve()
          })
          .catch((error) => {
            const now = new Date().getTime()
            const delta = now - startTime

            if (delta > timeout) {
              if (timer !== null) clearInterval(timer)
              reject(error)
            }
          })
      }, frequency)
    })
  }
  