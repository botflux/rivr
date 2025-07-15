import {after, before, describe, test, TestContext} from "node:test"
import {KurrentDbContainer, StartedKurrentDbContainer} from "@testcontainers/kurrentdb"
import {
  consumeCustomSubscription,
  consumeWorkflowStateChanges,
  createQueue,
  createStorage,
  RivrInvalidStreamInfixError
} from "./kurrentdb";
import {advancedFlow, basicFlow, createWorker, Message, rivr, trigger, NormalizedWorkflowState} from "rivr";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import {jsonEvent, JSONEventType, KurrentDBClient} from "@kurrent/kurrentdb-client";

describe('kurrentdb', function () {
  let kurrentdb!: StartedKurrentDbContainer

  before(async () => {
    kurrentdb = await new KurrentDbContainer("kurrentplatform/kurrentdb:25.0").start()
  })

  after(async () => {
    await kurrentdb?.stop()
  })

  describe('queue', function () {
    test("should be able to produce in the queue", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        createSubscriptionOpts: {
          groupName: randomUUID(),
        },
        streamInfix: randomInfix()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const mError = await producer.produce([
        randomMessage()
      ]).then(() => {}).catch(e => e)

      // Then
      t.assert.strictEqual(mError, undefined)
    })

    test("should be able to consume messages", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        createSubscriptionOpts: {
          groupName: randomUUID(),
        },
        streamInfix: randomInfix()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      const randomMsg = randomMessage()
      let msg!: unknown

      const consumer = queue.createConsumer({
        onMessage: async msg1 => {
          msg = msg1
        }
      })

      t.after(async () => {
        await consumer.stop()
      })

      await consumer.start()

      // When
      await producer.produce([ randomMsg ])

      // Then
      await waitForPredicate(() => msg !== undefined, 15_000)
      t.assert.deepStrictEqual(msg, randomMsg)
    })

    test("should be able to not override the subscription", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        createSubscriptionOpts: {
          groupName: randomUUID(),
        },
        streamInfix: randomInfix()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      t.after(async () => {
        await consumer.stop()
      })

      await consumer.start()

      // When
      // Then
      const mError = await consumer.start().catch(e => e)
      t.assert.strictEqual(mError, undefined)
    })

    test("should be able to create the persistent subscription once", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        createSubscriptionOpts: {
          groupName: randomUUID(),
        },
        streamInfix: randomInfix()
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer1 = queue.createConsumer({
        onMessage: async () => {}
      })

      t.after(async () => {
        await consumer1.stop()
      })

      await consumer1.start()

      const consumer2 = queue.createConsumer({
        onMessage: async () => {}
      })

      t.after(async () => {
        await consumer2.stop()
      })

      // When
      // Then
      const mError = await consumer2.start().catch(e => e)
      t.assert.strictEqual(mError, undefined)
    })

    test("should be able to ensure the infix does not contain '-'", (t) => {
      // Given
      // When
      // Then
      t.assert.throws(
        () => createQueue({ streamInfix: "foo-bar", connectionString: "" }),
        new RivrInvalidStreamInfixError("foo-bar")
      )
    })
  })

  describe('consumption hooks', function () {
    test("should be able to call the start hook", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: randomInfix(),
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

    test("should be able to call the start hook once", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: randomInfix(),
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let calls = 0

      consumer.addHook("onStart", () => calls++)

      t.after(async () => {
        await consumer.stop()
      })

      // When
      await consumer.start()
      await consumer.start()

      // Then
      t.assert.strictEqual(calls, 1)
    })

    test("should be able to call the stop hook", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: randomInfix(),
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumer = queue.createConsumer({
        onMessage: async msg => {}
      })

      let params: unknown[] = []

      consumer.addHook("onStop", (...params1) => params = params1)

      await consumer.start()

      // When
      await consumer.stop()

      // Then
      t.assert.deepStrictEqual(params, [ "manually_stopped" ])
    })

    test("should be able to call the stop hook once", async (t: TestContext) => {
      // Given
      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: randomInfix(),
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const consumption = queue.createConsumer({
        onMessage: async msg => {}
      })

      let calls: unknown[] = []

      consumption.addHook("onStop", (...params) => {
        calls.push(params)
      })

      // When
      await consumption.start()
      await consumption.stop()
      await consumption.stop()

      // Then
      t.assert.deepStrictEqual(calls, [ [ "manually_stopped" ] ])
    })
  })
  
  describe('workflow', function () {
    const makeQueue = () => createQueue({
      connectionString: kurrentdb.getConnectionString(),
      streamInfix: randomInfix(),
      createSubscriptionOpts: {
        groupName: randomUUID(),
      },
    })

    basicFlow({ createQueue: makeQueue })
    advancedFlow({ createQueue: makeQueue })
  })

  describe('workflow state storage', function () {
    test("should be able to store workflow states", async (t: TestContext) => {
      // Given
      const storage = createStorage({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: randomInfix()
      })

      // When
      const state: NormalizedWorkflowState<number> = {
        status: "successful",
        id: randomUUID(),
        name: "workflow",
        lastModified: new Date(),
        result: 1,
        steps: [
          {
            name: "foo",
            attempts: [
              {
                id: 1,
                status: "successful",
                inputState: 1,
                result: {
                  type: "success",
                  state: 2
                }
              }
            ]
          }
        ]
      }
      await storage.upsert([ state ])

      // Then
      t.assert.deepStrictEqual(await storage.get(state.id), state)
    })

    test("should be able to return undefined if no workflow exists for the given id", async (t: TestContext) => {
      // Given
      const storage = createStorage({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: randomInfix()
      })

      // When
      // Then
      t.assert.strictEqual(await storage.get(randomUUID()), undefined)
    })
    
    test("should be able to subscribe to workflow state changes", async (t: TestContext) => {
      // Given
      const infix = randomInfix()

      const storage = createStorage({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: infix
      })

      let event: unknown

      const consumption = consumeWorkflowStateChanges({
        streamInfix: infix,
        groupName: `test-${randomUUID()}`,
        connectionString: kurrentdb.getConnectionString(),
        handler: async e => {
          event = e?.data
        }
      })

      t.after(async () => {
        await consumption.stop()
      })

      await consumption.start()

      const state: NormalizedWorkflowState<number> = {
        status: "successful",
        id: randomUUID(),
        name: "workflow",
        lastModified: new Date(),
        steps: [
          {
            name: "foo",
            attempts: [
              {
                id: 1,
                status: "successful",
                inputState: 1,
                result: {
                  type: "success",
                  state: 2
                }
              }
            ]
          }
        ]
      }

      // When
      await storage.upsert([ state ])

      // Then
      await waitForPredicate(() => event !== undefined)
      t.assert.deepStrictEqual(event, state)
    })
  })

  describe('trigger workflow from persistent subscription', function () {
    test("should be able to consume a custom subscription", async (t: TestContext) => {
      // Given
      const infix = randomInfix()
      let eventPayload: unknown

      type MyEvent = JSONEventType<"record_created", { value: number }>

      const customConsumption = consumeCustomSubscription<MyEvent>({
        streamName: `$ce-Record${infix}`,
        groupName: randomUUID(),
        connectionString: kurrentdb.getConnectionString(),
        handler: async event => {
          eventPayload = event.data
        }
      })

      t.after(async () => {
        await customConsumption.stop()
      })

      await customConsumption.start()

      // When
      await KurrentDBClient
        .connectionString(kurrentdb.getConnectionString())
        .appendToStream(`Record${infix}-${randomUUID()}`, [ jsonEvent<MyEvent>({ type: "record_created", data: { value: 2 } }) ])

      // Then
      await waitForPredicate(() => eventPayload !== undefined)
      t.assert.deepStrictEqual(eventPayload, { value: 2 })
    })

    test("should be able to trigger workflow from a persistent subscription", async (t: TestContext) => {
      // Given
      const infix = randomInfix()

      const queue = createQueue({
        connectionString: kurrentdb.getConnectionString(),
        streamInfix: infix,
        createSubscriptionOpts: {
          groupName: randomUUID(),
        }
      })

      t.after(async () => {
        await queue.disconnect()
      })

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      type MyEvent = JSONEventType<"record_created", { value: number }>

      const customConsumption = consumeCustomSubscription<MyEvent>({
        streamName: `$ce-Record${infix}`,
        groupName: randomUUID(),
        connectionString: kurrentdb.getConnectionString(),
        handler: async event => {
          await trigger(
            producer,
            workflow,
            event.data.value
          )
        }
      })

      t.after(async () => {
        await customConsumption.stop()
      })


      let handled: unknown

      const workflow = rivr.workflow<number>("calc")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .addHook("onWorkflowCompleted", () => {
          handled = true
        })

      const worker = createWorker({
        primary: queue,
        workflows: [ workflow ],
        customConsumptions: [ customConsumption ]
      })

      worker.addHook("error", (err) => console.log(err))

      t.after(async () => {
        await worker.stop()
      })

      await worker.start()

      // When
      await KurrentDBClient
        .connectionString(kurrentdb.getConnectionString())
        .appendToStream(`Record${infix}-${randomUUID()}`, [ jsonEvent<MyEvent>({ type: "record_created", data: { value: 2 } }) ])

      // Then
      await waitForPredicate(() => handled === true)
      t.assert.strictEqual(handled, true)
    })
  })
})

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}

function randomInfix() {
  return randomUUID().replace("-", "").substring(0, 7)
}

function randomMessage(): Message {
  return {
    type: "foo",
    id: randomUUID(),
    payload: { msg: "hello world" },
    createdAt: new Date()
  }
}