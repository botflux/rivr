import {Queue} from "../queue";
import {describe, test, TestContext} from "node:test";
import {setTimeout} from "node:timers/promises"
import {rivr} from "../workflow/workflow";
import {trigger, triggerFrom} from "../workflow/trigger";
import {Step, StepResult} from "../workflow/types";
import {createWorker} from "../worker/default-worker";
import {Engine} from "../engine";

export type QueueSpecOpts = {
  /**
   * Each test will call this function at least once.
   * For each call, the function must return an isolated queue.
   * In case of a DB queue, a random table name, or a random collection name must be generated.
   * For streaming system/queueing system, a topic/stream/queue name must be generated.
   */
  createEngine: () => Engine<any>
}

export function basicFlow ({ createEngine }: QueueSpecOpts) {
  describe('basic flow', function () {
    test("should be able to execute a step", async (t: TestContext) => {
      // Given
      let result: StepResult<unknown> | undefined

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .addHook("onStepHandled", (w, step, r) => {
          result = r
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => result !== undefined)
      t.assert.deepStrictEqual(result, { type: "success", state: 11 })
    })

    test("should be able to execute a workflow made of two steps", async (t: TestContext) => {
      // Given
      let stepResult: StepResult<unknown> | undefined

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "minus-6",
          handler: ({ state }) => state - 6
        })
        .step({
          name: "multiply-by-4",
          handler: ({ state }) => state * 4
        })
        .addHook("onWorkflowCompleted", (w, state) => {
          stepResult = state
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => stepResult !== undefined, 10_000)
      t.assert.deepStrictEqual(stepResult, { type: "success", state: 16 })
    })

    test("should be able to handle a step error", async (t: TestContext) => {
      // Given
      let result: StepResult<unknown> | undefined

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "always-fails",
          handler: (): number => {
            throw new Error("oops")
          }
        })
        .addHook("onStepHandled", (w, step, r) => {
          result = r
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => result !== undefined)
      t.assert.deepStrictEqual(result, { type: "failure", error: new Error("oops") })
    })

    test("should be able to change the workflow's state", async (t: TestContext) => {
      // Given
      let result: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .step({
          name: "formatting",
          handler: ({ state }) => `State is ${state}`,
        })
        .addHook("onWorkflowCompleted", (context, r) => {
          result = r
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => result !== undefined)
      t.assert.deepStrictEqual(result, { type: "success", state: "State is 11" })
    })

    test("should be able to start a workflow at a specific step", async (t: TestContext) => {
      // Given
      let result: StepResult<unknown> | undefined

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .step({
          name: "formatting",
          handler: ({ state }) => `State is ${state}`,
        })
        .addHook("onStepHandled", (context, step, r) => {
          result = r
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await triggerFrom(
        producer,
        workflow,
        "formatting",
        10
      )

      // Then
      await waitForPredicate(() => result !== undefined)
      t.assert.deepStrictEqual(result, { type: "success", state: "State is 10" })
    })
  })
}

export function advancedFlow({ createEngine }: QueueSpecOpts) {
  describe('advanced flow', function () {
    test("should be able to stop a workflow", async (t: TestContext) => {
      // Given
      let result: unknown
      let step: Step | undefined

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "stop",
          handler: ctx => ctx.stop()
        })
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .addHook("onWorkflowStopped", (ctx, s, state) => {
          step = s
          result = state
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => result !== undefined && step !== undefined)
      t.assert.strictEqual(step?.name, "stop")
      t.assert.strictEqual(result, 10)
    })

    test("should be able to retry a failing step", async (t: TestContext) => {
      // Given
      let results: StepResult<unknown>[] = []

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "always-fails",
          handler: ctx => ctx.err(new Error(`oops ${ctx.attempt}`)),
          maxAttempts: 5
        })
        .addHook("onStepHandled", (ctx, step, result) => {
          results.push(result)
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => results.length === 5)
      t.assert.deepStrictEqual(results, [
        {
          type: "failure",
          error: new Error("oops 1")
        },
        {
          type: "failure",
          error: new Error("oops 2")
        },
        {
          type: "failure",
          error: new Error("oops 3")
        },
        {
          type: "failure",
          error: new Error("oops 4")
        },
        {
          type: "failure",
          error: new Error("oops 5")
        }
      ])
    })
  })
}

export function timeBasedFlow({ createEngine }: QueueSpecOpts) {
  describe('time base flow', function () {
    test("should be able to delay retries", async (t: TestContext) => {
      // Given
      const results: StepResult<unknown>[] = []
      let end: number = 0

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "always-fails",
          handler: ctx => ctx.err(new Error(`oops ${ctx.attempt}`)),
          delayBetweenAttempts: 200,
          maxAttempts: 5
        })
        .addHook("onWorkflowFailed", () => {
          end = new Date().getTime()
        })
        .addHook("onStepHandled", (ctx, step, result) => {
          results.push(result)
        })

      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const start = new Date().getTime()
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => results.length === 5 && end !== 0)
      t.assert.strictEqual(end - start > 800, true, `${end - start}ms is not greater than 800ms`)
      t.assert.deepStrictEqual(results, [
        {
          type: "failure",
          error: new Error("oops 1")
        },
        {
          type: "failure",
          error: new Error("oops 2")
        },
        {
          type: "failure",
          error: new Error("oops 3")
        },
        {
          type: "failure",
          error: new Error("oops 4")
        },
        {
          type: "failure",
          error: new Error("oops 5")
        }
      ])
    })

    test("should be able to increase the delay between tries", async (t: TestContext) => {
      // Given
      const results: StepResult<unknown>[] = []
      let end: number = 0

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "always-fails",
          handler: ctx => ctx.err(new Error(`oops ${ctx.attempt}`)),
          delayBetweenAttempts: attempt => attempt * 100,
          maxAttempts: 5
        })
        .addHook("onWorkflowFailed", () => {
          end = new Date().getTime()
        })
        .addHook("onStepHandled", (ctx, step, result) => {
          results.push(result)
        })


      const queue = createEngine().createQueue()
      const worker = createWorker({ primary: queue, workflows: [ workflow ] })

      t.after(async () => {
        await worker.stop()
        await queue.disconnect()
      })

      await worker.start()

      const producer = queue.createProducer()

      t.after(async () => {
        await producer.disconnect()
      })

      // When
      const start = new Date().getTime()
      await trigger(
        producer,
        workflow,
        10
      )

      // Then
      await waitForPredicate(() => results.length === 5 && end !== 0)
      t.assert.strictEqual(end - start > 200 + 300 + 400 + 500, true, `${end - start}ms is not greater than 1400ms`)
      t.assert.deepStrictEqual(results, [
        {
          type: "failure",
          error: new Error("oops 1")
        },
        {
          type: "failure",
          error: new Error("oops 2")
        },
        {
          type: "failure",
          error: new Error("oops 3")
        },
        {
          type: "failure",
          error: new Error("oops 4")
        },
        {
          type: "failure",
          error: new Error("oops 5")
        }
      ])
    })
  })
}

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}

export function installUnhandledRejectionHook () {
  process.on('unhandledRejection', err => {
    console.log("Unhandled rejection caught", err)
  })
}