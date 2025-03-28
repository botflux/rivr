import { rivr } from "./workflow"


async function start() {

  const workflow = rivr.workflow<number>("complex-calculation")
    .step({
      name: "divide-by-2",
      handler: ({ state }) => state / 2
    })

  const w1 = workflow
    .register(workflow => workflow
      .decorate("add", (x: number, y: number) => x + y)
      .step({
        name: "add-3",
        handler: ({ state, workflow }) => workflow.add(state, 3)
      })
    )

  const w2 = w1
    .step({
      name: "multiply-by-2",
      handler: ({ state }) => state * 2
    })

  await w2.ready()

  console.log(Array.from(w1.steps()))

  // console.log(JSON.stringify(Object.getPrototypeOf(w2), undefined, 2))

  // console.log(Array.from(workflow.getHook("onStepCompleted")))
}

start().catch(console.error)