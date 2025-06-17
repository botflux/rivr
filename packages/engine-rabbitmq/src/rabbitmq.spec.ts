// import { before, after, test, describe, TestContext } from "node:test"
// import {StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
// import {randomUUID} from "node:crypto";
// import {basicFlowControl, advancedFlowControl, extension, installUnhandledRejectionHook} from "rivr";
// import {createEngine} from "./rabbitmq";
// import {GenericContainerBuilder, Wait} from "testcontainers"
// import { join } from "node:path";
//
import {after, before, describe} from "node:test";
import {advancedFlow, basicFlow, installUnhandledRejectionHook, timeBasedFlow} from "rivr";
import {GenericContainerBuilder, Wait} from "testcontainers";
import {RabbitMQContainer, StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
import { join } from "node:path";
import {randomUUID} from "node:crypto";
import {createQueue as createRabbitMQQueue} from "./rabbitmq";

installUnhandledRejectionHook()

describe("rabbitmq engine", () => {
  describe('recommended setup (without delayed exchange)', function () {
    let container!: StartedRabbitMQContainer

    before(async () => {
      container = await new RabbitMQContainer("rabbitmq:4.1").start()
    })

    after(async () => {
      await container?.stop()
    })

    const createQueue = () => createRabbitMQQueue({
      url: container.getAmqpUrl(),
      exchange: randomUUID(),
      queue: randomUUID(),
    })

    basicFlow({ createQueue })
    advancedFlow({ createQueue })
  })

  describe('not-recommended setup (with delayed exchange)', function () {
    let container!: StartedRabbitMQContainer

    before(async () => {
      const customImage = await new GenericContainerBuilder(join(__dirname, ".."), join("config", "Dockerfile"))
        .withCache(true)
        .build("custom-rabbitmq-with-delayed-exchange:latest")

      const AMQP_PORT = 5672;
      const AMQPS_PORT = 5671;
      const RABBITMQ_DEFAULT_USER = "guest";
      const RABBITMQ_DEFAULT_PASS = "guest";

      container = new StartedRabbitMQContainer(
        await customImage
          .withExposedPorts(AMQP_PORT, AMQPS_PORT)
          .withEnvironment({
            RABBITMQ_DEFAULT_USER,
            RABBITMQ_DEFAULT_PASS
          })
          .withWaitStrategy(Wait.forLogMessage("Server startup complete"))
          .withStartupTimeout(30_000)
          .start()
      )

      // container = await new RabbitMQContainer("rabbitmq:4.1").start()
    })

    after(async () => {
      await container?.stop()
    })

    const createQueue = () => createRabbitMQQueue({
      url: container.getAmqpUrl(),
      exchange: randomUUID(),
      queue: randomUUID(),
      delayedExchange: randomUUID(),
      enableDelayedMessageExchange: true
    })

    basicFlow({ createQueue })
    advancedFlow({ createQueue })
    timeBasedFlow({ createQueue })
  })
})
