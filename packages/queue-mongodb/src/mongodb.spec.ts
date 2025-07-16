import {MongoDBContainer, StartedMongoDBContainer} from "@testcontainers/mongodb";
import {advancedFlow, basicFlow, installUnhandledRejectionHook, Message, timeBasedFlow} from "rivr";
import {createQueue as createMongoQueue} from "./queue"
import test, {after, before, describe, TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import {uuidv7} from "uuidv7";

let mongodb!: StartedMongoDBContainer

installUnhandledRejectionHook()
before(async () => {
  mongodb = await new MongoDBContainer("mongo:8")
    .start()
})

after(async () => {
  await mongodb?.stop()
})

describe("mongodb queue", function () {
  describe('producer/consumer', function () {
    test("should be able to produce in a queue", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true
        }
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const error = await producer.produce([
        {
          type: "msg",
          id: uuidv7(),
          createdAt: new Date(),
          payload: { msg: "hello world" },
        }
      ]).catch(e => e)

      // Then
      t.assert.strictEqual(error, undefined)
    })

    test("should be able to consume a message", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true
        },
        delayBetweenEmptyPolls: 100
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      let message: unknown

      const consumer = queue.createConsumer({
        onMessage: async msg => {
          message = msg
        }
      })

      t.after(async () => {
        await consumer.stop()
      })

      await consumer.start()

      // When
      const producedMessage: Message = {
        type: "msg",
        id: uuidv7(),
        createdAt: new Date(),
        payload: { msg: "hello world" },
      }
      await producer.produce([
        producedMessage
      ])

      // Then
      await waitForPredicate(() => message !== undefined)
      t.assert.deepStrictEqual(message, producedMessage)
    })
    
    test("should be able to consume from multiple consumptions", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        delayBetweenEmptyPolls: 100,
        clientOpts: {
          directConnection: true
        },
        dbName: randomUUID()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const messages: Message[] = []

      const consumer1 = queue.createConsumer({
        onMessage: async msg => {
          messages.push(msg)
        }
      })

      t.after(async () => {
        await consumer1.stop()
      })

      await consumer1.start()

      const consumer2 = queue.createConsumer({
        onMessage: async msg => {
          messages.push(msg)
        }
      })

      t.after(async () => {
        await consumer2.stop()
      })

      await consumer2.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const producedMessages: Message[] = new Array(10).fill(0).map(() => ({
        type: "msg",
        id: uuidv7(),
        payload: { msg: "hello world" },
        createdAt: new Date(),
      }))

      await producer.produce(producedMessages)

      // Then
      await waitForPredicate(() => messages.length === 10)
      t.assert.deepStrictEqual(messages.toSorted(sortMessages), producedMessages.toSorted(sortMessages))
    })
    
    test("should be able to retry nack messages", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        },
        delayBetweenEmptyPolls: 100,
      })

      t.after(async () => {
        await queue.disconnect()
      })

      let i = 0

      const messages: Message[] = []
      const failedMessages: Message[] = []

      const consumer = queue.createConsumer({
        onMessage: async msg => {
          if (i++ < 2) {
            failedMessages.push(msg)
            throw new Error("oops")
          }

          messages.push(msg)
        }
      })

      t.after(async () => {
        await consumer.stop()
      })

      await consumer.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const producedMessage: Message = {
        payload: { msg: "hello" },
        id: uuidv7(),
        createdAt: new Date(),
        type: "hello"
      }

      await producer.produce([ producedMessage ])

      // Then
      await waitForPredicate(() => messages.length > 0)
      t.assert.deepStrictEqual(messages, [ producedMessage ])
      t.assert.deepStrictEqual(failedMessages, [ producedMessage, producedMessage ])
    })

    test("should be able to take another consumer's messages if not handled in time", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        delayBetweenEmptyPolls: 100,
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID(),
        deadMessageTimeout: 2_000
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const pickedBySucceedingConsumer: Message[] = []
      const pickedByFailingConsumer: Message[] = []


      const succeedingConsumer = queue.createConsumer({
        onMessage: async msg => {
          pickedBySucceedingConsumer.push(msg)
        }
      })

      t.after(async () => {
        await succeedingConsumer.stop()
      })

      const failingConsumer = queue.createConsumer({
        onMessage: async msg => {
          pickedByFailingConsumer.push(msg)
          await succeedingConsumer.start()
          await setTimeout(60_000, 0, { signal: t.signal })
        }
      })

      t.after(async () => {
        await failingConsumer.stop()
      })

      await failingConsumer.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const producedMessage: Message = {
        type: "msg",
        id: uuidv7(),
        payload: { msg: "hello" },
        createdAt: new Date()
      }
      await producer.produce([ producedMessage ])

      // Then
      await waitForPredicate(() => pickedBySucceedingConsumer.length > 0)
      t.assert.deepStrictEqual(pickedByFailingConsumer, [ producedMessage ])
      t.assert.deepStrictEqual(pickedBySucceedingConsumer, [producedMessage])
    })
  })

  describe('disconnect', function () {
    test("should be able to ignore if already disconnected", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        },
      })

      // Produce a message to initialize the MongoClient.
      await queue
        .createProducer()
        .produce([ { createdAt: new Date(), id: uuidv7(), payload: { msg: "hello" }, type: "foo" } ])

      // When
      const error1 = await queue.disconnect().catch((err) => err)
      const error2 = await queue.disconnect().catch((err) => err)

      // Then
      t.assert.strictEqual(error1, undefined)
      t.assert.strictEqual(error2, undefined)
    })
  })

  describe('hooks', function () {
    test("onStart is not triggered if the consumer is not started", (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      // When
      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let called = false
      consumer.addHook("onStart", () => called = true)

      // Then
      t.assert.strictEqual(called, false)
    })

    test("should be able to trigger the onStart hook", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let called = false
      consumer.addHook("onStart", () => called = true)

      t.after(async () => {
        await consumer.stop()
      })

      // When
      await consumer.start()

      // Then
      t.assert.strictEqual(called, true)
    })

    test("should be able to trigger the onStop hook", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let reason: unknown
      consumer.addHook("onStop", (r) => reason = r)
      await consumer.start()

      // When
      await consumer.stop()

      // Then
      t.assert.strictEqual(reason, "manually_stopped")
    })

    test("should be able to ignore duplicate calls to start", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let calls = 0
      consumer.addHook("onStart", () => calls ++)

      t.after(async () => {
        await consumer.stop()
      })

      // When
      await consumer.start()
      await consumer.start()

      // Then
      t.assert.strictEqual(calls, 1)
    })
    
    test("should be able to ignore duplicate calls to stop", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let calls = 0
      consumer.addHook("onStop", () => calls ++)
      await consumer.start()

      // When
      await consumer.stop()
      await consumer.stop()

      // Then
      t.assert.strictEqual(calls, 1)
    })

    test("should be able to trigger the onError hook", async (t: TestContext) => {
      // Given
      const queue = createMongoQueue({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID(),
        delayBetweenEmptyPolls: 100
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {
          throw new Error("oops")
        }
      })

      const errors: unknown[] = []

      consumer.addHook("onError", (err) => {
        errors.push(err)
      })

      t.after(async () => {
        await consumer.stop()
      })

      await consumer.start()

      // When
      const p = queue.createProducer()
      t.after(async () => {
        await p.disconnect()
      })
      await p.produce([
        {
          type: "msg",
          id: uuidv7(),
          payload: { msg: "hello world" },
          createdAt: new Date()
        }
      ])

      // Then
      await waitForPredicate(() => errors.length > 0)
      t.assert.strictEqual(errors.length > 0, true)
    })
  })

  describe('workflows', function () {
    const createQueue = () => createMongoQueue({
      url: mongodb.getConnectionString(),
      clientOpts: { directConnection: true },
      dbName: randomUUID(),
      delayBetweenEmptyPolls: 100,
    })

    basicFlow({ createQueue })
    advancedFlow({ createQueue })
    timeBasedFlow({ createQueue })
  })
})

function sortMessages (a: Message, b: Message) {
  return a.id.localeCompare(b.id)
}

async function waitForPredicate(fn: () => boolean | Promise<boolean>, ms = 5_000) {
  let now = new Date().getTime()
  while (!await fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}
