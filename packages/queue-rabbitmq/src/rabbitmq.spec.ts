import test, {after, before, describe, TestContext} from "node:test";
import {advancedFlow, basicFlow, installUnhandledRejectionHook, Message, timeBasedFlow} from "rivr";
import {GenericContainerBuilder, Wait} from "testcontainers";
import {RabbitMQContainer, StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {createQueue as createRabbitMQQueue} from "./rabbitmq";
import {setTimeout} from "node:timers/promises";

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

    describe('producer/consumer', function () {
      test("should be able to produce a message", async (t: TestContext) => {
        // Given
        const queue = createQueue()

        t.after(async () => {
          await queue.disconnect()
        })

        const producer = queue.createProducer()

        t.after(async () => {
          await producer.disconnect()
        })

        // When
        const error = await producer.produce([ randomMessage() ]).then(() => undefined).catch(e => e)

        // Then
        t.assert.strictEqual(error, undefined)
      })
      
      test("should be able to consume a message", async (t: TestContext) => {
        // Given
        const queue = createQueue()

        t.after(async () => {
          await queue.disconnect()
        })

        const producer = queue.createProducer()

        t.after(async () => {
          await producer.disconnect()
        })

        const receivedMessages: Message[] = []

        const consumer = queue.createConsumer({
          async onMessage(msg) {
            receivedMessages.push(msg)
          }
        })

        t.after(async () => {
          await consumer.stop()
        })

        await consumer.start()

        const producedMessages = [randomMessage(), randomMessage()]

        // When
        await producer.produce(producedMessages)

        // Then
        await waitForPredicate(() => receivedMessages.length === 2, 5_000)
        t.assert.deepStrictEqual(receivedMessages.toSorted(sortMessages), producedMessages.toSorted(sortMessages))
      })

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

function randomMessage(): Message {
  return {
    type: "msg",
    id: randomUUID(),
    createdAt: new Date(),
    payload: { msg: "hello world" }
  }
}

async function waitForPredicate(fn: () => boolean | Promise<boolean>, ms = 5_000) {
  let now = new Date().getTime()
  while (!await fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}

function sortMessages (a: Message, b: Message) {
  return a.id.localeCompare(b.id)
}
