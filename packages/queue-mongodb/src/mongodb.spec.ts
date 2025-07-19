import {MongoDBContainer, StartedMongoDBContainer} from "@testcontainers/mongodb";
import {
  advancedFlow,
  basicFlow,
  installUnhandledRejectionHook,
  Message,
  rivr, SearchableWorkflowStateStorage,
  timeBasedFlow,
  WorkflowState, WorkflowStateStorage
} from "rivr";
import test, {after, before, describe, TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import {uuidv7} from "uuidv7";
import assert from "node:assert";
import {createEngine as createMongoEngine, createEngine} from "./engine";

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true
        }
      }).createQueue()

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
      ]).then(() => undefined).catch(e => e)

      // Then
      t.assert.strictEqual(error, undefined)
    })

    test("should be able to consume a message", async (t: TestContext) => {
      // Given
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true
        },
        queue: {
          delayBetweenEmptyPolls: 100
        }
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true
        },
        dbName: randomUUID(),
        queue: {
          delayBetweenEmptyPolls: 100,
        }
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        },
        queue: {
          delayBetweenEmptyPolls: 100,
        }
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID(),
        queue: {
          delayBetweenEmptyPolls: 100,
          deadMessageTimeout: 2_000
        }
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        },
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID()
      }).createQueue()

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
      const queue = createEngine({
        url: mongodb.getConnectionString(),
        clientOpts: {
          directConnection: true,
        },
        dbName: randomUUID(),
        queue: {
          delayBetweenEmptyPolls: 100
        }
      }).createQueue()

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

  describe('storage', function () {
    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: opts => opts.state + 1
      })

    test("should be able to store a workflow state", async (t) => {
      // Given
      const storage = createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        }
      }).createStorage!()

      const now = new Date()
      const id = uuidv7()

      t.after(async () => {
        await storage.disconnect()
      })

      const state = WorkflowState
        .initialize(workflow, "add-1", 10, id, now)
        .toNormalized()

      // When
      await storage.upsert([state])

      // Then
      assert.deepStrictEqual(await storage.get(id), state)
    })

    test("should be able to paginate workflow state search results by 25 by default", async (t) => {
      // Given
      const storage = ensureSearchable(createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        }
      }).createStorage!())

      const now = new Date()

      t.after(async () => {
        await storage.disconnect()
      })

      const states = new Array(100).fill(0).map((_, i) => WorkflowState
        .initialize(workflow, "add-1", i, undefined, now)
        .toNormalized())

      // When
      await storage.upsert(states)

      // Then
      assert.deepStrictEqual(await storage.search(), {
        results: states.slice(0, 25),
        nextPage: 2,
        totalCount: 100
      })
    })

    test("should be able to get the next page", async (t) => {
      // Given
      const storage = ensureSearchable(
        createEngine({
          url: mongodb.getConnectionString(),
          dbName: randomUUID(),
          clientOpts: {
            directConnection: true,
          }
        }).createStorage!()
      )

      const now = new Date()

      t.after(async () => {
        await storage.disconnect()
      })

      const states = new Array(100).fill(0).map((_, i) => WorkflowState
        .initialize(workflow, "add-1", i, undefined, now)
        .toNormalized())

      await storage.upsert(states)

      // When
      const { nextPage } = await storage.search()

      // Then
      assert.notStrictEqual(nextPage, undefined)
      assert.deepStrictEqual(await storage.search({ page: nextPage }), {
        results: states.slice(25, 50),
        nextPage: 3,
        previousPage: 1,
        totalCount: 100
      })
    })

    test("should be able to change the page's size", async (t) => {
      // Given
      const storage = ensureSearchable(createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        }
      }).createStorage!())

      const now = new Date()

      t.after(async () => {
        await storage.disconnect()
      })

      const states = new Array(100).fill(0).map((_, i) => WorkflowState
        .initialize(workflow, "add-1", i, undefined, now)
        .toNormalized())

      // When
      await storage.upsert(states)

      // Then
      assert.deepStrictEqual(await storage.search({ limit: 50 }), {
        results: states.slice(0, 50),
        nextPage: 2,
        totalCount: 100
      })
    })

    test("should be able to search by workflow status", async (t) => {
      // Given
      const storage = ensureSearchable(createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        }
      }).createStorage!())

      t.after(async () => {
        await storage.disconnect()
      })

      const now = new Date()

      const failed = new Array(10).fill(0).map((_, i) => WorkflowState
        .initialize(workflow, "add-1", 10, uuidv7(), now)
        .startProcessing(now)
        .updateFromStepResult(workflow.getFirstStep()!, { type: "failure", error: "oops" }, now)
        .toNormalized())

      const succeeded = new Array(10).fill(0).map((_, i) => WorkflowState
        .initialize(workflow, "add-1", 10, uuidv7(), now)
        .startProcessing(now)
        .updateFromStepResult(workflow.getFirstStep()!, { type: "success", state: 11 }, now)
        .toNormalized())

      await storage.upsert([ ...succeeded, ...failed ])

      // When
      // Then
      assert.deepStrictEqual(await storage.search({ status: ["failed"] }), {
        results: failed,
        totalCount: 10
      })
      assert.deepStrictEqual(await storage.search({ status: ["successful"] }), {
        results: succeeded,
        totalCount: 10
      })
    })

    test("should be able to search by workflow name", async (t) => {
      // Given
      const storage = ensureSearchable(createEngine({
        url: mongodb.getConnectionString(),
        dbName: randomUUID(),
        clientOpts: {
          directConnection: true,
        }
      }).createStorage!())

      t.after(async () => {
        await storage.disconnect()
      })

      const now = new Date()

      const anotherWorkflow = rivr.workflow<number>("calc-2")
        .step({
          name: "add-1",
          handler: opts => opts.state + 1
        })

      const workflow1States = new Array(10).fill(0).map((_, i) => WorkflowState
        .initialize(workflow, "add-1", 10, uuidv7(), now)
        .startProcessing(now)
        .updateFromStepResult(workflow.getFirstStep()!, { type: "success", state: 11 }, now)
        .toNormalized())

      const workflow2States = new Array(10).fill(0).map((_, i) => WorkflowState
        .initialize(anotherWorkflow, "add-1", 10, uuidv7(), now)
        .startProcessing(now)
        .updateFromStepResult(anotherWorkflow.getFirstStep()!, { type: "success", state: 11 }, now)
        .toNormalized())

      // When
      await storage.upsert([ ...workflow1States, ...workflow2States ])

      // Then
      assert.deepStrictEqual(await storage.search({ names: ["calc-2"] }), {
        results: workflow2States,
        totalCount: 10
      })
      assert.deepStrictEqual(await storage.search({ names: ["calc"] }), {
        results: workflow1States,
        totalCount: 10
      })
    })
  })

  describe('workflows', function () {
    const createEngine = () => createMongoEngine({
      url: mongodb.getConnectionString(),
      clientOpts: { directConnection: true },
      dbName: randomUUID(),
      queue: {
        delayBetweenEmptyPolls: 100,
      }
    })

    basicFlow({ createEngine })
    advancedFlow({ createEngine })
    timeBasedFlow({ createEngine })
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

function ensureSearchable(storage: WorkflowStateStorage | SearchableWorkflowStateStorage): SearchableWorkflowStateStorage {
  if (!("search" in storage && storage.search !== undefined)) {
    throw new Error("Storage must be searchable")
  }

  return storage as SearchableWorkflowStateStorage
}