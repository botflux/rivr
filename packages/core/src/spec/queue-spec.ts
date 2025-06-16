import {Queue} from "../queue";
import {test, TestContext} from "node:test";
import { setTimeout } from "node:timers/promises"
import {createWorker} from "../worker";
import {rivr} from "../workflow/workflow";
import {trigger, triggerFrom} from "../workflow/trigger";
import {StepResult} from "../workflow/types";

export type QueueSpecOpts = {
  /**
   * Each test will call this function at least once.
   * For each call, the function must return an isolated queue.
   * In case of a DB queue, a random table name, or a random collection name must be generated.
   * For streaming system/queueing system, a topic/stream/queue name must be generated.
   */
  createQueue: () => Queue<any>
}

export function basicFlow ({ createQueue }: QueueSpecOpts) {
  test("should be able to execute a step", async (t: TestContext) => {
    // Given
    let result: StepResult<unknown> | undefined

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onStepHandled", (w, step, r) => result = r)

    const queue = createQueue()
    const worker = createWorker({ primary: queue, workflows: [ workflow ] })

    t.after(async () => {
      await worker.stop()
      await queue.disconnect()
    })

    await worker.start()

    // When
    await trigger(
      queue,
      workflow,
      10
    )

    // Then
    await waitForPredicate(() => result !== undefined)
    t.assert.deepStrictEqual(result, { type: "success", state: 11 })
  })

  test("should be able to execute a workflow made of two steps", async (t: TestContext) => {
    // Given
    let result: unknown

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "minus-6",
        handler: ({ state }) => state - 6
      })
      .step({
        name: "multiply-by-4",
        handler: ({ state }) => state * 4
      })
      .addHook("onWorkflowCompleted", (w, state) => result = state)

    const queue = createQueue()
    const worker = createWorker({ primary: queue, workflows: [ workflow ] })

    t.after(async () => {
      await worker.stop()
      await queue.disconnect()
    })

    await worker.start()

    // When
    await trigger(
      queue,
      workflow,
      10
    )

    // Then
    await waitForPredicate(() => result !== undefined)
    t.assert.deepStrictEqual(result, 16)
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
      .addHook("onStepHandled", (w, step, r) => result = r)

    const queue = createQueue()
    const worker = createWorker({ primary: queue, workflows: [ workflow ] })

    t.after(async () => {
      await worker.stop()
      await queue.disconnect()
    })

    await worker.start()

    // When
    await trigger(
      queue,
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
     .addHook("onWorkflowCompleted", (context, r) => result = r)

   const queue = createQueue()
   const worker = createWorker({ primary: queue, workflows: [ workflow ] })

   t.after(async () => {
     await worker.stop()
     await queue.disconnect()
   })

   await worker.start()

   // When
   await trigger(
     queue,
     workflow,
     10
   )

   // Then
   await waitForPredicate(() => result !== undefined)
   t.assert.deepStrictEqual(result, "State is 11")
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
      .addHook("onStepHandled", (context, step, r) => result = r)

    const queue = createQueue()
    const worker = createWorker({ primary: queue, workflows: [ workflow ] })

    t.after(async () => {
      await worker.stop()
      await queue.disconnect()
    })

    await worker.start()

    // When
    await triggerFrom(
      queue,
      workflow,
      "formatting",
      10
    )

    // Then
    await waitForPredicate(() => result !== undefined)
    t.assert.deepStrictEqual(result, { type: "success", state: "State is 10" })
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