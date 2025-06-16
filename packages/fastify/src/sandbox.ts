import * as redis from "@rivr/engine-redis";
import {createWorker, rivr, trigger} from "rivr";

async function sandbox () {
  const queue = redis.createQueue({
    redis: { url: "redis://localhost:6379" },
  })

  const w = rivr.workflow<number>("my-workflow")
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .step({
      name: "add-6",
      handler: ({ state }) => state + 6
    })
    .addHook("preStepHandler", (w, step, state) => {
      console.log("preStepHandler", step, state)
    })
    .addHook("onStepHandled", (w, step, result) => {
      console.log("onStepHandled", step, result)
    })
    .addHook("onWorkflowCompleted", (w, result) => {
      console.log("onWorkflowCompleted", result)
    })

  const worker = createWorker({
    primary: queue,
    workflows: [ w ]
  })

  console.log("starting worker")

  await worker.start()

  console.log("worker started")

  await trigger(
    queue,
    w,
    10,
  )

  console.log("triggered")
}

sandbox().catch(console.error);