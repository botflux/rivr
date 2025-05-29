import {createEngine} from "./mongodb";
import {randomUUID} from "crypto";
import {rivr} from "rivr";
import { setTimeout } from "node:timers/promises"

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
        console.log("step called", state)
        throw new Error("Not implemented at line 24 in sandbox.ts")
        // return state + 1
      },
      maxAttempts: 3,
      optional: true,
      delayBetweenAttempts: attempt => attempt * 500
    })
    .step({
      name: "add-5",
      handler: ({ state }) => {
        console.log("add-5", state)
        return state + 5
      }
    })

  console.log("starting the worker")
  await worker.start([ workflow ])

  const trigger = engine.createTrigger()
  await trigger.trigger(workflow, 1)

  console.log("waiting for 5s to be sure that the state is picked up by the single pass poller")
  await setTimeout(5_000)


  console.log("triggering a workflow")
  // await trigger.trigger(workflow, 10)
}

run().catch(console.error)