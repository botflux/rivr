import { before, after, test, describe, TestContext } from "node:test"
import {RabbitMQContainer, StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
import {randomUUID} from "node:crypto";
import {rivr} from "rivr";
import {setTimeout} from "timers/promises";
import {createEngine} from "./rabbitmq";

describe("rabbitmq engine", () => {
  let container!: StartedRabbitMQContainer

  before(async () => {
    container = await new RabbitMQContainer("rabbitmq:4.1").start()
  })

  after(async () => {
    await container?.stop()
  })

  test("should be able to execute a workflow made of one step", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getAmqpUrl(),
      exchangeName: randomUUID(),
      queueName: randomUUID()
    })

    let state: unknown

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (_, s) => state = s)

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 9)

    // Then
    await waitForPredicate(() => state !== undefined)
    t.assert.strictEqual(state, 10)
  })
})

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}
