import {createWorker, rivr, trigger} from "rivr";
import {createQueue} from "./queue";
import {randomUUID} from "node:crypto";

async function sandbox() {
  const workflow = rivr.workflow<number>("complex-calculation")
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .addHook("onStepHandled", (w, step, r) => {
      console.log("done", r)
    })

  const queue = createQueue({
    url: "mongodb://localhost:27017",
    dbName: randomUUID()
  })

  const worker = createWorker({ primary: queue, workflows: [ workflow ] })

  await worker.start()

  // When
  await trigger(
    queue,
    workflow,
    10
  )

}

sandbox().catch(console.error)