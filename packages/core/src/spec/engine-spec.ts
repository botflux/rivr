import {describe, test, TestContext} from "node:test"
import {Engine} from "../engine";
import {rivr} from "../workflow";
import {setTimeout} from "timers/promises";
import {rivrPlugin} from "../types";

export type TestOpts = {
  createEngine: () => Engine<any>
}

export function basicFlowControl (
  opts: TestOpts
) {
  describe('basic flow control', function () {
    test("should be able to execute a workflow made of a step", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()

      t.after(() => engine.close())

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: ({ state }) => state + 3
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      const trigger = engine.createTrigger()
      const worker = engine.createWorker()

      worker.addHook("onError", err => console.log(t.name, "onErrorHook", err))

      await worker.start([ workflow ])

      // When
      await trigger.trigger(workflow, 4)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.strictEqual(state, 7)
    })

    test("should be able to execute a workflow made of multiple step", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()

      t.after(() => engine.close())

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: ({ state }) => state + 3
        })
        .step({
          name: "multiply-by-3",
          handler: ({ state }) => state * 3
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 0)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 9)
    })

    test("should be able to handle step errors", async (t) => {
      // Given
      const engine = opts.createEngine()

      t.after(() => engine.close())

      let state: unknown
      let error: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: () => {
            throw "oops"
          }
        })
        .addHook("onStepError", (e, w, s) => {
          state = s
          error = e
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 4)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(error, "oops")
      t.assert.deepEqual(state, 4)
    })

    test("should be able to get the workflow state when triggering a workflow", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())
      const now = new Date()

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })

      // When
      // Then
      t.assert.deepStrictEqual(await engine.createTrigger().trigger(workflow, 4, {
        id: "1",
        now
      }), {
        id: "1",
        name: "complex-calculation",
        status: "in_progress",
        steps: [
          {
            attempts: [],
            name: "add-1"
          }
        ],
        toExecute: {
          areRetryExhausted: false,
          attempt: 1,
          state: 4,
          status: "todo",
          step: "add-1"
        },
        lastModified: now
      })
    })

    test("should be able to change the workflow's state between steps", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let result: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "heavy-computation",
          handler: ({ state }) => state + 1
        })
        .step({
          name: "format",
          handler: ({ state }) => `The result is '${state}'`,
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          result = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 4)

      // Then
      await waitForPredicate(() => result !== undefined)
      t.assert.strictEqual(result, "The result is '5'")
    })

    test("should be able to start a workflow from a specific step", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let result: unknown

      const workflow = rivr.workflow<boolean>("complex-calculation")
        .step({
          name: "add-4",
          handler: async ({ state }) => 10
        })
        .step({
          name: "multiply-10",
          handler: async ({ state }) => state * 10
        })
        .step({
          name: "format",
          handler: async ({ state }) => `The result is '${state}'`
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          result = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().triggerFrom(workflow, "multiply-10", 4)

      // Then
      await waitForPredicate(() => result !== undefined, 5_000)
      t.assert.strictEqual(result, "The result is '40'")
    })
  })
}

export function extension (opts: TestOpts) {
  describe('extension', function () {
    test("should be able to add a property on the workflow", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .decorate("add", (x: number, y: number) => x + y)
        .step({
          name: "add-3",
          handler: ({ state, workflow }) => workflow.add(state, 3)
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 3)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.strictEqual(state, 6)
    })

    test("should be able to register a plugin", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown
      let errors: unknown[] = []

      const workflow = rivr.workflow<number>("complex-calculation")
        .register(workflow => workflow.decorate("add", (x: number, y: number) => x + y))
        .step({
          name: "add-3",
          handler: ({ state, workflow }) => workflow.add(state, 3)
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })
        .addHook("onStepError", error => errors.push(error))

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 3)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 6)
    })

    test("should be able to register a step within a plugin", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      const plugin = rivrPlugin({
        name: "my-plugin",
        plugin: p => p.input<number>().step({
          name: "add-1",
          handler: ({ state }) => ({ result: state + 1 })
        })
      })

      let result: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .register(plugin)
        .step({
          name: "format",
          handler: ({ state }) => `Result is ${state.result}`,
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          result = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => result !== undefined, 5_000)
      t.assert.deepStrictEqual(result, "Result is 2")
    })
    
    test("should be able to not break the state tracking if a plugin without step is registered", async (t) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      const pluginA = rivrPlugin({
        name: "plugin-a",
        plugin: p => p.input().decorate("foo", 1)
      })
      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .register(pluginA)
        .step({
          name: "add-bar",
          handler: ({ state, workflow }) => state + workflow.foo
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 2)
    })

    test("should be able to register a plugin with dependencies", async (t) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      const pluginA = rivrPlugin({
        name: "plugin-a",
        plugin: p => p.input().decorate("foo", 1)
      })
      const pluginB = rivrPlugin({
        name: "plugin-b",
        deps: [ pluginA ],
        plugin: p => {
          const w = p.input()

          return w.decorate("bar", w.foo + 1)
        }
      })

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .register(pluginA)
        .register(pluginB)

      workflow
        .step({
          name: "add-bar",
          handler: ({ state, workflow }) => state + workflow.bar
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 3)
    })

    test("should be able to register a plugin with options", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      const greetPlugin = rivrPlugin({
        name: "greet-plugin",
        plugin: (p, opts: { name: string }) => p.input().decorate("greet", function () {
          return `Hello, ${opts.name}!`
        })
      })

      let state: unknown

      const workflow = rivr.workflow<string>("complex-calculation")
        .register(greetPlugin, {
          name: "Daneel"
        })
        .step({
          name: "step-1",
          handler: ({ workflow }) => workflow.greet()
        })
        .addHook("onWorkflowCompleted", (w, s) => state = s)

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, "")

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.strictEqual(state, "Hello, Daneel!")
    })

    test("should be able to declare the plugin options as a function", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      const plugin0 = rivrPlugin({
        name: "plugin-0",
        plugin: p => p.input()
          .decorate("fooFromPlugin0", 1)
      })

      const plugin1 = rivrPlugin({
        name: "plugin-1",
        deps: [ plugin0],
        plugin: (p, opts: { foo: number }) => p.input().decorate("foo", opts.foo)
      })

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .register(plugin0)
        .register(plugin1, w => ({
          foo: w.fooFromPlugin0
        }))
        .step({
          name: "my-step",
          handler: ctx => ctx.workflow.foo + 1
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 2)
    })
  })
}

export function advancedFlowControl (opts: TestOpts) {
  describe('advanced flow control', function () {
    test("should be able to skip a step", async (t) => {
      // Given
      const engine = opts.createEngine()

      t.after(() => engine.close())

      let skippedState: unknown
      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: ({ state }) => state + 3
        })
        .step({
          name: "skipped",
          handler: ctx => ctx.skip()
        })
        .step({
          name: "minus-1",
          handler: ({ state }) => state - 1
        })
        .addHook("onStepSkipped", (w, step, state) => {
          skippedState = state
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 3)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(skippedState, 6)
      t.assert.deepEqual(state, 5)
    })

    test("should be able to stop a workflow", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()

      t.after(() => engine.close())

      let stoppedState: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: ({ state }) => state + 3
        })
        .step({
          name: "stopped",
          handler: ctx => ctx.stop()
        })
        .step({
          name: "minus-1",
          handler: ({ state }) => state - 1
        })
        .addHook("onWorkflowStopped", (w, step, state) => {
          stoppedState = state
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 3)

      // Then
      await waitForPredicate(() => stoppedState !== undefined)
      t.assert.strictEqual(stoppedState, 6)
    })

    test("should be able to mark a step as optional", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown
      let errors: unknown[] = []

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .step({
          name: "always-fails",
          handler: ({ state }) => {
            throw "oops"
          },
          optional: true
        })
        .step({
          name: "add-2",
          handler: ({ state }) => state + 2
        })
        .addHook("onStepError", (e) => {
          errors.push(e)
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 3)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 6)
      t.assert.deepStrictEqual(errors, [ "oops" ])
    })

    test("should be able to retry an optional step until it passes", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown
      let errors: unknown[] = []

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .step({
          name: "always-fails",
          handler: ({ state }) => {
            throw "oops"
          },
          maxAttempts: 5,
          optional: true
        })
        .step({
          name: "add-2",
          handler: ({ state }) => state + 2
        })
        .addHook("onStepError", (e) => {
          errors.push(e)
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 3)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 6)
      t.assert.deepStrictEqual(errors, [ "oops", "oops", "oops", "oops", "oops" ])
    })

    test("should be able to return a ok result", async (t) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: ctx => ctx.ok(ctx.state + 3)
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 4)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(state, 7)
    })

    test("should be able to return a error step result", async (t) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown
      let error: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-3",
          handler: ctx => ctx.err("oops")
        })
        .addHook("onStepError", (e, w, s) => {
          error = e
          state = s
        })

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 4)

      // Then
      await waitForPredicate(() => state !== undefined)
      t.assert.deepEqual(error, "oops")
      t.assert.deepEqual(state, 4)
    })

    test("should be able to retry a failed step", async (t) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let errorCount = 0
      let failed = false

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "always-failing",
          handler: ctx => ctx.err("oops"),
          maxAttempts: 5
        })
        .addHook("onStepError", (w, s) => errorCount ++)
        .addHook("onWorkflowFailed", () => failed = true)

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => failed)
      t.assert.deepEqual(errorCount, 5)
    })

    test("should be able to not retry failed steps by default", async (t) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let errorCount = 0
      let failed = false

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "always-failing",
          handler: ctx => ctx.err("oops"),
        })
        .addHook("onStepError", (w, s) => errorCount ++)
        .addHook("onWorkflowFailed", () => failed = true)

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => failed)
      t.assert.deepEqual(errorCount, 1)
    })

    test("should be able to wait between tries", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "add-1",
          handler: ({ state, attempt }) => {
            if (attempt === 1) {
              throw "oops"
            }
            return state + 1
          },
          maxAttempts: 2,
          delayBetweenAttempts: 1_500
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      const start = new Date().getTime()

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => state !== undefined)
      const end = new Date().getTime()
      t.assert.strictEqual(end - start > 1_500, true, `${end - start}ms is not greater than 1500ms`)
      t.assert.strictEqual(state, 2)
    })

    test("should be able to increase the delay between tries", async (t: TestContext) => {
      // Given
      const engine = opts.createEngine()
      t.after(() => engine.close())

      let state: unknown

      const workflow = rivr.workflow<number>("complex-calculation")
        .step({
          name: "fails-once",
          handler: ctx => {
            if (ctx.attempt <= 2) {
              return ctx.err("oops")
            }

            return ctx.state + 1
          },
          maxAttempts: 3,
          delayBetweenAttempts: attempt => attempt * 500
        })
        .addHook("onWorkflowCompleted", (w, s) => {
          state = s
        })

      const start = new Date().getTime()

      await engine.createWorker().start([ workflow ])

      // When
      await engine.createTrigger().trigger(workflow, 1)

      // Then
      await waitForPredicate(() => state !== undefined)
      const end = new Date().getTime()
      t.assert.strictEqual(end - start > 1_500, true, `${end - start}ms is not greater than 1500ms`)
      t.assert.strictEqual(state, 2)
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