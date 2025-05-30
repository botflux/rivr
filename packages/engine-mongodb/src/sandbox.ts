import {createEngine, WriteOpts} from "./mongodb";
import {randomUUID} from "crypto";
import {rivr, Trigger, Workflow} from "rivr";
import { createInterface } from "node:readline/promises"

type Matcher = Record<string, () => Promise<void>>

async function triggerFromConsoleMessages(
  matcher: Matcher,
  fallback: (message: string) => Promise<void>,
) {
  const i = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    do {
      const response = await i.question("Which number should trigger the workflow? (empty to pass) ")

      if (response === "") {
        return
      }

      for (const match in matcher) {
        if (match === response) {
          await matcher[match]()
          continue
        }
      }

      await fallback(response)
    } while (true)
  } finally {
    i.close()
  }
}

async function run(): Promise<void> {
  const engine = createEngine({
    url: "mongodb://localhost:27017",
    dbName: randomUUID(),
  })

  const worker = engine.createWorker()

  worker.addHook("onError", err => {
    console.log("onerror hook", err)
  })

  const workflow = rivr.workflow<number>("workflow")
    .step({
      name: "add-1",
      handler: ({ state }) => {
        console.log(`step triggered with ${state}`)
        return state + 1
      },
      maxAttempts: 1,
    })

  const trigger = engine.createTrigger()

  console.log("The worker is not started yet, but you can already trigger messages, " +
    "they should be picked up by the single pass poller.")

  await triggerFromConsoleMessages({}, async message => {
    const n = Number.parseInt(message)

    if (Number.isNaN(n)) {
      console.log(`${n} is not a number, please submit a valid number`)
      return
    }

    await trigger.trigger(workflow, n)
  })

  console.log("Starting the worker...")
  await engine.createWorker().start([ workflow ])
  console.log("Worker started")

  console.log("Now you can trigger workflow, and the states should be picked up by the change stream consumption")

  await triggerFromConsoleMessages({
    "close": () => worker.stop()
  }, async message => {
    const n = Number.parseInt(message)

    if (Number.isNaN(n)) {
      console.log(`${n} is not a number, please submit a valid number`)
      return
    }

    await trigger.trigger(workflow, n)
  })
}

run().catch(console.error)