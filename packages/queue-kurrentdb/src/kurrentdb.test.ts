import {after, before, describe, test, TestContext} from "node:test"
import {KurrentDbContainer, StartedKurrentDbContainer} from "@testcontainers/kurrentdb"
import {
  consumeCustomSubscription,
  consumeWorkflowStateChanges,
  createQueue,
  createStorage,
  RivrInvalidStreamInfixError
} from "./kurrentdb";
import {advancedFlow, basicFlow, createWorker, Message, rivr, trigger, WorkflowState} from "rivr";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import {
  jsonEvent,
  JSONEventType,
  JSONRecordedEvent,
  KurrentDBClient,
  RecordedEvent,
  RecordedEventToEventType
} from "@kurrent/kurrentdb-client";

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

      // When
      const mError = await queue.produce([
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

      const randomMsg = randomMessage()
      let msg!: unknown

      const consumption = queue.consume({
        onMessage: async msg1 => {
          msg = msg1
        }
      })

      t.after(async () => {
        await consumption.stop()
      })

      await consumption.start()

      // When
      await queue.produce([ randomMsg ])

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

      const consumption = queue.consume({
        onMessage: async msg => {}
      })

      t.after(async () => {
        await consumption.stop()
      })

      await consumption.start()

      // When
      // Then
      const mError = await consumption.start().catch(e => e)
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

      const consumption1 = queue.consume({
        onMessage: async () => {}
      })

      t.after(async () => {
        await consumption1.stop()
      })

      await consumption1.start()

      const consumption2 = queue.consume({
        onMessage: async () => {}
      })

      t.after(async () => {
        await consumption2.stop()
      })

      // When
      // Then
      const mError = await consumption2.start().catch(e => e)
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
      const state: WorkflowState<number> = {
        status: "successful",
        id: randomUUID(),
        name: "workflow",
        lastModified: new Date(),
        toExecute: {
          status: "done",
          pickAfter: new Date(),
          attempt: 1,
          state: 5,
          step: "foo",
          areRetryExhausted: false
        },
        result: 1,
        steps: [
          {
            name: "foo",
            attempts: [
              {
                id: 1,
                status: "successful"
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

      const state: WorkflowState<number> = {
        status: "successful",
        id: randomUUID(),
        name: "workflow",
        lastModified: new Date(),
        toExecute: {
          status: "done",
          pickAfter: new Date(),
          attempt: 1,
          state: 5,
          step: "foo",
          areRetryExhausted: false
        },
        result: 1,
        steps: [
          {
            name: "foo",
            attempts: [
              {
                id: 1,
                status: "successful"
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

      type MyEvent = JSONEventType<"record_created", { value: number }>

      const customConsumption = consumeCustomSubscription<MyEvent>({
        streamName: `$ce-Record${infix}`,
        groupName: randomUUID(),
        connectionString: kurrentdb.getConnectionString(),
        handler: async event => {
          await trigger(
            queue,
            workflow,
            event.data.value
          )
        }
      })

      t.after(async () => {
        await customConsumption.stop()
      })

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