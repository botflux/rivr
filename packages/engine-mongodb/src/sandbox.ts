import {createEngine} from "./mongodb";
import {randomUUID} from "crypto";
import {rivr} from "rivr";
import { setTimeout } from "node:timers/promises"

async function run(): Promise<void> {
  const engine = createEngine({
    url: "mongodb://localhost:27017",
    dbName: randomUUID(),
    useChangeStream: true,
  })

  const worker = engine.createWorker()

  worker.addHook("onError", err => {
    console.log("onerror hook", err)
  })

  const trigger = engine.createTrigger()

  const workflow = rivr.workflow<number>("workflow")
    .step({
      name: "add-1",
      handler: ({ state }) => {
        console.log("step called", state)
        return state + 1
      }
    })

  console.log("triggering first message")
  await trigger.trigger(workflow, 1)

  console.log("starting the worker")
  await worker.start([ workflow ])

  console.log("waiting for timeout")
  await setTimeout(5_000)

  console.log("triggering a workflow")
  await trigger.trigger(workflow, 10)

}

run().catch(console.error)