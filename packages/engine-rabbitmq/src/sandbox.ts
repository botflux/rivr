import {createEngine} from "./rabbitmq";
import {rivr} from "rivr";
import {addAbortSignal} from "node:stream";
import {randomUUID} from "node:crypto";

async function start() {
  const workflow = rivr.workflow<number>("calc")
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .addHook("onWorkflowCompleted", (_, state) => {
      console.log(`state is ${state}`)
    })

  const engine = createEngine({
    url: "amqp://localhost:5672",
    queueName: randomUUID(),
    exchangeName: randomUUID(),
    routingKey: randomUUID(),
  })

  const t = engine.createTrigger()
  const w = engine.createWorker()

  await t.trigger(workflow, 1)

  await w.start([ workflow ])

  await t.trigger(workflow, 4)
}

start().catch(console.error)