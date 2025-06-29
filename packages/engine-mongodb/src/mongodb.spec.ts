import {MongoDBContainer, StartedMongoDBContainer} from "@testcontainers/mongodb";
import {advancedFlow, basicFlow, installUnhandledRejectionHook, Message, timeBasedFlow} from "rivr";
import {createQueue, createQueue as createMongoQueue} from "./queue"
import test, {after, before, describe, TestContext} from "node:test";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import {Network, StartedNetwork} from "testcontainers";
import {StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";

let network!: StartedNetwork
let mongodb!: StartedMongoDBContainer
let toxiproxy!: StartedToxiProxyContainer

installUnhandledRejectionHook()
before(async () => {
  network = await new Network().start()
  mongodb = await new MongoDBContainer("mongo:8")
    .withNetwork(network)
    .withNetworkAliases("mongo")
    .start()
  toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
    .withNetwork(network)
    .start()
})

after(async () => {
  await toxiproxy?.stop()
  await mongodb?.stop()
  await network?.stop()
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
          id: randomUUID(),
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

      const [ consumer ] = queue.createConsumers({
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
        id: randomUUID(),
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

      const [ consumer1 ] = queue.createConsumers({
        onMessage: async msg => {
          messages.push(msg)
        }
      })

      t.after(async () => {
        await consumer1.stop()
      })

      await consumer1.start()

      const [ consumer2 ] = queue.createConsumers({
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
        id: randomUUID(),
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

      const [ consumer ] = queue.createConsumers({
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
        id: randomUUID(),
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


      const [ succeedingConsumer ] = queue.createConsumers({
        onMessage: async msg => {
          pickedBySucceedingConsumer.push(msg)
        }
      })

      t.after(async () => {
        await succeedingConsumer.stop()
      })

      const [ failingConsumer ] = queue.createConsumers({
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
        id: randomUUID(),
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
        .produce([ { createdAt: new Date(), id: randomUUID(), payload: { msg: "hello" }, type: "foo" } ])

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
      const [ consumer ] = queue.createConsumers({
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

      const [ consumer ] = queue.createConsumers({
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

      const [ consumer ] = queue.createConsumers({
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

      const [ consumer ] = queue.createConsumers({
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

      const [ consumer ] = queue.createConsumers({
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

//
// describe('mongodb', function () {
//   const makeEngine = () => createEngine({
//     url: container.getConnectionString(),
//     clientOpts: {
//       directConnection: true
//     },
//     dbName: randomUUID(),
//     delayBetweenEmptyPolls: 100,
//   })
//
//   basicFlowControl({ createEngine: makeEngine })
//   advancedFlowControl({ createEngine: makeEngine })
//   extension({ createEngine: makeEngine })
// })
//
// describe('transaction', function () {
//   test("should be able to execute the write in a transaction",  {skip: true}, async (t) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       clientOpts: {
//         directConnection: true
//       },
//       dbName: randomUUID(),
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     const db = randomUUID()
//
//     let state: unknown
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         state = s
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.client.withSession(async session => {
//       await engine.client.db(db).collection("another-collection").insertOne({
//         n: 1
//       })
//       await engine.createTrigger().trigger(workflow, 1, {
//         session
//       })
//     })
//
//     // Then
//     await waitForPredicate(() => state !== undefined)
//     t.assert.deepEqual(state, 2)
//     t.assert.deepEqual((await engine.client.db(db).collection("another-collection").findOne())?.n, 1)
//   })
//
//   test("should be able to trigger a workflow once",  async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       dbName: randomUUID(),
//       clientOpts: {
//         directConnection: true
//       },
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     const states: unknown[] = []
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         states.push(s)
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     const trigger = engine.createTrigger()
//
//     // When
//     await Promise.all([
//       trigger.trigger(workflow, 1, {
//         id: "0"
//       }),
//       trigger.trigger(workflow, 1, {
//         id: "0"
//       }),
//       trigger.trigger(workflow, 2, {
//         id: "1"
//       }),
//       trigger.trigger(workflow, 2, {
//         id: "1"
//       }),
//     ])
//
//     // Then
//     await waitForPredicate(() => states.length === 2)
//     t.assert.deepStrictEqual(states.toSorted(), [ 2, 3 ])
//   })
// })
//
// describe('hooks', function () {
//   test("should be able to handle hook failure",  async (t) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       clientOpts: {
//         directConnection: true
//       },
//       dbName: randomUUID(),
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .addHook("onWorkflowCompleted", (w, s) => {
//         throw "oops"
//       })
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//
//     let error: unknown
//
//     const worker = engine.createWorker()
//     worker.addHook("onError", err => {
//       error = err
//     })
//     await worker.start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 1)
//
//     // Then
//     await waitForPredicate(() => error !== undefined)
//     t.assert.deepEqual(error, "oops")
//   })
//
//   test("emit a workflow completed if the last step is optional and is failing",  async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       dbName: randomUUID(),
//       clientOpts: {
//         directConnection: true
//       },
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     let state: unknown
//     let workflowFailedCalled = false
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .step({
//         name: "always-fails",
//         handler: () => {
//           throw "oops"
//         },
//         optional: true,
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         state = s
//       })
//       .addHook("onWorkflowFailed", (w, s) => {
//         workflowFailedCalled = true
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 3)
//
//     // Then
//     await waitForPredicate(() => state !== undefined)
//     t.assert.deepEqual(state, 4)
//     t.assert.deepEqual(workflowFailedCalled, false)
//   })
//
//   test("execute all the handler",  async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       dbName: randomUUID(),
//       clientOpts: {
//         directConnection: true
//       },
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     const stepCompletedStates: unknown[] = []
//     let finished = false
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .addHook("onStepCompleted", (w, s, state) => {
//         stepCompletedStates.push(state)
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         finished = true
//       })
//       .step({
//         name: "add-3",
//         handler: ({ state }) => state + 3
//       })
//       .register(w => {
//         return w
//           .addHook("onStepCompleted", (w, s, state) => {
//             stepCompletedStates.push(state)
//           })
//           .step({
//             name: "add-4",
//             handler: ({ state }) => state + 4
//           })
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 3)
//
//     // Then
//     await waitForPredicate(() => finished)
//     t.assert.deepStrictEqual(stepCompletedStates, [ 6, 6, 10, 10 ])
//   })
//
//   test("execute onWorkflowCompleted hooks in order",  async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       clientOpts: {
//         directConnection: true
//       },
//       dbName: randomUUID(),
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     let elements: number[] = []
//     let finished = false
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .addHook("onWorkflowCompleted", (w, s) => {
//         elements.push(1)
//       })
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         elements.push(2)
//       })
//       .register(w => {
//         return w
//           .addHook("onWorkflowCompleted", (w, s) => {
//             elements.push(3)
//           })
//           .step({
//             name: "add-4",
//             handler: ({ state }) => state + 4
//           })
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         elements.push(4)
//         finished = true
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 3)
//
//     // Then
//     await waitForPredicate(() => finished)
//     t.assert.deepEqual(finished, true)
//     t.assert.deepStrictEqual(elements, [ 1, 2, 3, 4 ])
//   })
//
//   test("should be able to execute a hook in the correct context",  async (t) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       clientOpts: {
//         directConnection: true
//       },
//       dbName: randomUUID(),
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     let hookValue: unknown
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .register(w => {
//         return w.decorate("foo", 4)
//           .addHook("onStepCompleted", function (workflow1, step, state) {
//             hookValue = workflow1.foo + (state as number)
//           })
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 1)
//
//     // Then
//     await waitForPredicate(() => hookValue !== undefined)
//     t.assert.deepEqual(hookValue, 6)
//   })
// })
//
// describe("resilience", {skip: true}, () => {
//   let network: StartedNetwork
//   let mongodb: StartedMongoDBContainer
//   let toxiproxy: StartedToxiProxyContainer
//
//   before(async () => {
//     network = await new Network().start()
//
//     mongodb = await new MongoDBContainer("mongo:8")
//       .withNetwork(network)
//       .withNetworkAliases("mongodb")
//       .start()
//
//     toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
//       .withNetwork(network)
//       .start()
//   })
//
//   let proxy!: CreatedProxy
//
//   beforeEach(async () => {
//     proxy = await toxiproxy.createProxy({
//       name: "mongodb",
//       upstream: "mongodb:27017",
//       enabled: true
//     })
//   })
//
//   afterEach(async () => {
//     await proxy.instance.remove()
//   })
//
//   after(async () => {
//     await toxiproxy.stop()
//     await mongodb.stop()
//     await network.stop()
//   })
//
//   test("should be able to survive a mongodb crash",  async (t) => {
//     // Given
//     const engine = createEngine({
//       url: `mongodb://${proxy.host}:${proxy.port}`,
//       clientOpts: {
//         serverSelectionTimeoutMS: 3_000,
//         socketTimeoutMS: 3_000,
//         waitQueueTimeoutMS: 3_000,
//         connectTimeoutMS: 3_000,
//         directConnection: true
//       },
//       dbName: randomUUID(),
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     let state: unknown
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-2",
//         handler: ({ state }) => state + 2
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         state = s
//       })
//
//     let error: unknown
//
//     const worker = engine.createWorker()
//       .addHook("onError", err => {
//         error = err
//       })
//
//     await workflow.ready()
//
//     // When
//     await engine.createTrigger().trigger(workflow, 2)
//     await proxy.setEnabled(false)
//     await worker.start([ workflow ])
//     await waitForPredicate(() => error !== undefined)
//     await proxy.setEnabled(true)
//
//     // Then
//     await waitForPredicate(() => state !== undefined)
//     t.assert.deepEqual(state, 4)
//   })
//
//   test("should be able to survive a write error",  async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: `mongodb://${proxy.host}:${proxy.port}`,
//       clientOpts: {
//         serverSelectionTimeoutMS: 3_000,
//         socketTimeoutMS: 1_000,
//         waitQueueTimeoutMS: 1_000,
//         connectTimeoutMS: 1_000,
//         directConnection: true
//       },
//       dbName: randomUUID(),
//       delayBetweenEmptyPolls: 10
//     })
//
//     t.after(() => engine.close())
//
//     let error: unknown
//
//     const worker = engine.createWorker()
//       .addHook("onError", err => {
//         error = err
//       })
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-3",
//         handler: ({ state }) => state + 3
//       })
//       .step({
//         name: "disable-proxy",
//         handler: async ({ state }) => {
//           await proxy.setEnabled(false)
//           return state
//         }
//       })
//
//     await worker.start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 1)
//
//     // Then
//     await waitForPredicate(() => error !== undefined)
//
//     t.assert.deepStrictEqual(
//       error instanceof MongoBulkWriteError || error instanceof MongoServerSelectionError ||
//       (typeof error === "object" && error !== null && "message" in error && error.message === "This socket has been ended by the other party"),
//       true,
//       `${(error as any)?.constructor?.name} "${(error as any)?.message}" does not match the expected error`
//     )
//   })
// })
//
// describe('storage', function () {
//   test("should be able to find workflow state by id", async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       delayBetweenEmptyPolls: 10,
//       dbName: randomUUID(),
//       clientOpts: {
//         directConnection: true
//       },
//     })
//     const now = new Date()
//
//     t.after(() => engine.close())
//
//     let result: unknown
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .addHook("onWorkflowCompleted", (w, s) => {
//         result = s
//       })
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 1, { id: "1", now })
//
//     // Then
//     await waitForPredicate(() => result !== undefined)
//     const mState = await engine.createStorage().findById("1")
//
//     t.assert.deepStrictEqual(mState ? omit(mState, [ "lastModified" ]) : mState, {
//       id: "1",
//       name: "complex-calculation",
//       result: 2,
//       status: "successful",
//       steps: [
//         {
//           attempts: [
//             {
//               id: 1,
//               status: "successful",
//             }
//           ],
//           name: "add-1"
//         }
//       ],
//       toExecute: {
//         areRetryExhausted: false,
//         attempt: 1,
//         state: 1,
//         status: "done",
//         step: "add-1"
//       },
//     })
//   })
//
//   test("should be able to find a list of workflow", async (t: TestContext) => {
//     // Given
//     const engine = createEngine({
//       url: container.getConnectionString(),
//       dbName: randomUUID(),
//       clientOpts: {
//         directConnection: true,
//       },
//     })
//
//     t.after(() => engine.close())
//
//     let doneCount = 0
//
//     const workflow = rivr.workflow<number>("complex-calculation")
//       .step({
//         name: "add-1",
//         handler: ({ state }) => state + 1
//       })
//       .addHook("onWorkflowCompleted", (w, s) => doneCount++)
//
//     await engine.createWorker().start([ workflow ])
//
//     // When
//     await engine.createTrigger().trigger(workflow, 10)
//     await engine.createTrigger().trigger(workflow, 20)
//     await engine.createTrigger().trigger(workflow, 30)
//
//     // Then
//     await waitForPredicate(() => doneCount === 3)
//     const states = await engine.createStorage().findAll({
//       workflows: [ workflow ]
//     })
//     t.assert.deepStrictEqual(states.map(s => omit(s, [ "lastModified", "id" ])), [
//       {
//         name: "complex-calculation",
//         result: 11,
//         status: "successful",
//         steps: [
//           {
//             attempts: [
//               {
//                 id: 1,
//                 status: "successful",
//               }
//             ],
//             name: "add-1"
//           }
//         ],
//         toExecute: {
//           areRetryExhausted: false,
//           attempt: 1,
//           state: 10,
//           status: "done",
//           step: "add-1"
//         }
//       },
//       {
//         name: "complex-calculation",
//         result: 21,
//         status: "successful",
//         steps: [
//           {
//             attempts: [
//               {
//                 id: 1,
//                 status: "successful",
//               }
//             ],
//             name: "add-1"
//           }
//         ],
//         toExecute: {
//           areRetryExhausted: false,
//           attempt: 1,
//           state: 20,
//           status: "done",
//           step: "add-1"
//         }
//       },
//       {
//         name: "complex-calculation",
//         result: 31,
//         status: "successful",
//         steps: [
//           {
//             attempts: [
//               {
//                 id: 1,
//                 status: "successful",
//               }
//             ],
//             name: "add-1"
//           }
//         ],
//         toExecute: {
//           areRetryExhausted: false,
//           attempt: 1,
//           state: 30,
//           status: "done",
//           step: "add-1"
//         }
//       }
//     ])
//   })
// })
//
// async function waitForPredicate(fn: () => boolean, ms = 5_000) {
//   let now = new Date().getTime()
//   while (!fn() && new Date().getTime() - now < ms) {
//     await setTimeout(20)
//   }
// }
//
// function omit<Object extends Record<never, never>, Key extends keyof Object>(
//   o: Object,
//   keys: Key[]
// ): Omit<Object, Key> {
//   const shallowCopy = { ...o }
//
//   for (const key of keys) {
//     delete shallowCopy[key]
//   }
//
//   return shallowCopy
// }