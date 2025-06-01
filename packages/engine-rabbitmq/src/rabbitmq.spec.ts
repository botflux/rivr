import { before, after, test, describe, TestContext } from "node:test"
import {RabbitMQContainer, StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
import {randomUUID} from "node:crypto";
import {rivr, basicFlowControl, advancedFlowControl, extension} from "rivr";
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

  const makeEngine = () => createEngine({
    url: container.getAmqpUrl(),
    exchangeName: randomUUID(),
    queueName: randomUUID(),
    routingKey: randomUUID(),
  })

  basicFlowControl({ createEngine: makeEngine })
  advancedFlowControl({ createEngine: makeEngine })
  extension({ createEngine: makeEngine })
})

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}
