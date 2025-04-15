import {rivr} from "./workflow.ts";

async function start() {
  const workflow = await rivr.workflow<number>("foo")
    .addHook("onWorkflowCompleted", (w) => {})
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .register(w => w.step({
      name: "sub-2",
      handler: ({ state }) => state - 2
    }))
    .ready()

  console.log(workflow.name)
  console.log(Array.from(workflow.steps()))
  console.log(workflow.getHook("onWorkflowCompleted"))
}

start().catch(console.error)