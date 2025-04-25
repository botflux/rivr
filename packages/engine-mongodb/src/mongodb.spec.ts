
import {test, before, after, type TestContext, describe, beforeEach, afterEach} from "node:test"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import { randomUUID } from "crypto"
import { setTimeout } from "timers/promises"
import { createEngine } from "./mongodb"
import { rivr } from "rivr"
import {Network, StartedNetwork} from "testcontainers";
import {CreatedProxy, StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {MongoBulkWriteError} from "mongodb";

let container!: StartedMongoDBContainer

before(async () => {
  container = await new MongoDBContainer("mongo:8").start()
})

after(async () => {
  await container?.stop()
})

describe('basic flow control', function () {
  test("execute a workflow step",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-3",
        handler: ({ state }) => state + 3
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        hookExecuted = true
        state = s
      })

    const worker = engine.createWorker()
    worker.addHook("onError", err => console.log(err))

    await worker.start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(state, 7)
  })

  test("execute a workflow made of multiple steps",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state

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
        hookExecuted = true
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 0)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(state, 9)
  })

  test("skip a step",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let skipped = false
    let skippedState
    let finished = false
    let state

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
        skipped = true
        skippedState = state
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        finished = true
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!finished && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(skippedState, 6)
    t.assert.deepEqual(state, 5)
  })

  test("stop a workflow",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let stopped = false
    let stoppedState

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
        stopped = true
        stoppedState = state
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!stopped && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(stoppedState, 6)
  })

  test("handle step errors",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state
    let error

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-3",
        handler: () => {
          throw "oops"
        }
      })
      .addHook("onStepError", (e, w, s) => {
        hookExecuted = true
        state = s
        error = e
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(error, "oops")
    t.assert.deepEqual(state, 4)
  })

  test("return a ok step result",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-3",
        handler: ctx => ctx.ok(ctx.state + 3)
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        hookExecuted = true
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(state, 7)
  })

  test("return a error step result",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state
    let error

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-3",
        handler: ctx => ctx.err("oops")
      })
      .addHook("onStepError", (e, w, s) => {
        error = e
        hookExecuted = true
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(error, "oops")
    t.assert.deepEqual(state, 4)
  })

  test("should be able to return the workflow state when triggering a workflow", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10,
      clientOpts: {
        directConnection: true
      }
    })

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })

    await engine.createWorker().start([ workflow ])

    // When
    // Then
    t.assert.deepStrictEqual(await engine.createTrigger().trigger(workflow, 4, { id: "1" }), {
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
      }
    })
  })

  test("should be able to change the state's type from a step to another", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      delayBetweenPulls: 10,
      clientOpts: {
        directConnection: true,
      },
    })

    t.after(async () => await engine.close())

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
    await waitForPredicate(() => result !== undefined, 5_000)
    t.assert.deepStrictEqual(result, "The result is '5'")
  })

  test("should be able to start a workflow from a specific step", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenPulls: 10
    })

    t.after(async () => await engine.close())

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
    t.assert.deepStrictEqual(result, "The result is '40'")
  })
})

describe('advance flow control', function () {
  test("register an optional step",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      signal: t.signal,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenPulls: 10
    })

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

  test("retry an optional step until it passes",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      signal: t.signal,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenPulls: 10
    })

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

  test("emit a workflow completed if the last step is optional and is failing",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      signal: t.signal,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenPulls: 10
    })

    let state: unknown
    let workflowFailedCalled = false

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .step({
        name: "always-fails",
        handler: () => {
          throw "oops"
        },
        optional: true,
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        state = s
      })
      .addHook("onWorkflowFailed", (w, s) => {
        workflowFailedCalled = true
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    await waitForPredicate(() => state !== undefined)
    t.assert.deepEqual(state, 4)
    t.assert.deepEqual(workflowFailedCalled, false)
  })

  test("should be able to retry a failed step",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true,
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

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

  test("should be able to not retry failed steps by default",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true,
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

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

  test("should be able to wait between tries",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      signal: t.signal,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenPulls: 10
    })

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
    t.assert.strictEqual(end - start > 1_500, true)
    t.assert.strictEqual(state, 2)
  })

  test("should be able to increase the delay between tries",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      signal: t.signal,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true,
      },
      delayBetweenPulls: 10
    })

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
    t.assert.strictEqual(end - start > 1_500, true)
    t.assert.strictEqual(state, 2)
  })
})

describe('extension', function () {
  test("decorate workflow",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state

    const workflow = rivr.workflow<number>("complex-calculation")
      .decorate("add", (x: number, y: number) => x + y)
      .step({
        name: "add-3",
        handler: ({ state, workflow }) => workflow.add(state, 3)
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        hookExecuted = true
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
    }
    t.assert.deepEqual(state, 6)
  })

  test("register plugin",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let hookExecuted = false
    let state
    let errors: unknown[] = []

    const workflow = rivr.workflow<number>("complex-calculation")
      .register(workflow => workflow.decorate("add", (x: number, y: number) => x + y))
      .step({
        name: "add-3",
        handler: ({ state, workflow }) => workflow.add(state, 3)
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        hookExecuted = true
        state = s
      })
      .addHook("onStepError", error => errors.push(error))

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
      await setTimeout(20)
      t.assert.deepStrictEqual(errors, [])
    }
    t.assert.deepEqual(state, 6)
  })
  //
  // test("register step in a plugin",  async (t) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     dbName: randomUUID(),
  //     signal: t.signal,
  //     delayBetweenPulls: 10
  //   })
  //
  //   let hookExecuted = false
  //   let state: number | undefined
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .step({
  //       name: "divide-by-2",
  //       handler: ({ state }) => state / 2
  //     })
  //     .register(workflow => workflow
  //       .decorate("add", (x: number, y: number) => x + y)
  //       .step({
  //         name: "add-3",
  //         handler: ({ state, workflow }) => workflow.add(state, 3)
  //       })
  //     )
  //     .step({
  //       name: "multiply-by-2",
  //       handler: ({ state }) => state * 2
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       hookExecuted = true
  //       state = s
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 4)
  //
  //   // Then
  //   await waitForPredicate(() => state !== undefined)
  //   t.assert.deepEqual(state, 10)
  // })
  //
  // test("register a plugin without its dependency list",  async (t) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     signal: t.signal,
  //     dbName: randomUUID(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     delayBetweenPulls: 10
  //   })
  //
  //   const pluginA = rivrPlugin(function pluginA(w) {
  //     return w.decorate("foo", 1)
  //   }, {
  //     name: "plugin-a"
  //   })
  //
  //   let state: number | undefined
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .register(pluginA)
  //     .step({
  //       name: "add-bar",
  //       handler: ({ state, workflow }) => state + workflow.foo
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       state = s
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 1)
  //
  //   // Then
  //   await waitForPredicate(() => state !== undefined)
  //   t.assert.deepEqual(state, 2)
  // })
  //
  // test("register a plugin with dependencies",  async (t) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     signal: t.signal,
  //     dbName: randomUUID(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     delayBetweenPulls: 10
  //   })
  //
  //   const pluginA = rivrPlugin(function pluginA(w) {
  //     return w.decorate("foo", 1)
  //   }, {
  //     deps: [],
  //     name: "plugin-a"
  //   })
  //   const pluginB = rivrPlugin(function pluginB(w) {
  //     return w.decorate("bar", w.foo + 1)
  //   }, {
  //     deps: [ pluginA ],
  //     name: "plugin-b"
  //   })
  //
  //   let state: number | undefined
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .register(pluginA)
  //     .register(pluginB)
  //
  //   workflow
  //     .step({
  //       name: "add-bar",
  //       handler: ({ state, workflow }) => state + workflow.bar
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       state = s
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 1)
  //
  //   // Then
  //   await waitForPredicate(() => state !== undefined)
  //   t.assert.deepEqual(state, 3)
  // })
  //
  // test("register a plugin with options",  async (t: TestContext) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     signal: t.signal,
  //     dbName: randomUUID(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     delayBetweenPulls: 10
  //   })
  //
  //   const greetPlugin = rivrPlugin((w, opts: { name: string }) => w.decorate("greet", function () {
  //     return `Hello, ${opts.name}!`
  //   }), {
  //     name: "greet-plugin",
  //     deps: []
  //   })
  //
  //   let state: string | undefined
  //
  //   const workflow = rivr.workflow<string>("complex-calculation")
  //     .register(greetPlugin, {
  //       name: "Daneel"
  //     })
  //     .step({
  //       name: "step-1",
  //       handler: ({ workflow }) => workflow.greet()
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => state = s)
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, "")
  //
  //   // Then
  //   await waitForPredicate(() => state !== undefined)
  //   t.assert.deepStrictEqual(state, "Hello, Daneel!")
  // })
  //
  // test("register a plugin with a missing dependency throw an error",  async (t) => {
  //   const plugin1 = rivrPlugin(w => w, {
  //     deps: [],
  //     name: "plugin-1"
  //   })
  //   const plugin2 = rivrPlugin(w => w, {
  //     deps: [ plugin1 ],
  //     name: "plugin-2"
  //   })
  //
  //   await t.assert.rejects(
  //     rivr.workflow("my-workflow").register(plugin2).ready(),
  //     new Error(`Plugin "plugin-2" needs "plugin-1" to be registered`)
  //   )
  // })
  //
  // test("declare a plugin options as a function",  async (t) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     signal: t.signal,
  //     dbName: randomUUID(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     delayBetweenPulls: 10
  //   })
  //
  //   const plugin0 = rivrPlugin(function plugin0(w) {
  //     return w.decorate("fooFromPlugin0", 1)
  //   }, {
  //     name: "plugin-0"
  //   })
  //
  //   const plugin1 = rivrPlugin((w, opts: { foo: number }) => {
  //     return w.decorate("foo", opts.foo)
  //   }, {
  //     name: "plugin-1",
  //     deps: [ plugin0]
  //   })
  //
  //   let state: number | undefined
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .register(plugin0)
  //     .register(plugin1, w => ({
  //       foo: w.fooFromPlugin0
  //     }))
  //     .step({
  //       name: "my-step",
  //       handler: ctx => ctx.workflow.foo + 1
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       state = s
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 1)
  //
  //   // Then
  //   await waitForPredicate(() => state !== undefined)
  //   t.assert.deepEqual(state, 2)
  // })

  test("should not be able to decorate using the property twice",  (t) => {
    // Given
    const workflow = rivr.workflow<number>("complex-calculation")
    workflow.decorate("foo", 1)

    // When
    // Then
    t.assert.throws(() => workflow.decorate("foo", 2), new Error(`Cannot decorate the same property 'foo' twice`))
  })
})

describe('transaction', function () {
  test("should be able to execute the write in a transaction",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    const db = randomUUID()

    let state: unknown

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.client.withSession(async session => {
      await engine.client.db(db).collection("another-collection").insertOne({
        n: 1
      })
      await engine.createTrigger().trigger(workflow, 1, {
        session
      })
    })

    // Then
    await waitForPredicate(() => state !== undefined)
    t.assert.deepEqual(state, 2)
    t.assert.deepEqual((await engine.client.db(db).collection("another-collection").findOne())?.n, 1)
  })

  test("should be able to trigger a workflow once",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      signal: t.signal,
      delayBetweenPulls: 10
    })

    const states: unknown[] = []

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        states.push(s)
      })

    await engine.createWorker().start([ workflow ])

    const trigger = engine.createTrigger()

    // When
    await Promise.all([
      trigger.trigger(workflow, 1, {
        id: "0"
      }),
      trigger.trigger(workflow, 1, {
        id: "0"
      }),
      trigger.trigger(workflow, 2, {
        id: "1"
      }),
      trigger.trigger(workflow, 2, {
        id: "1"
      }),
    ])

    // Then
    await waitForPredicate(() => states.length === 2)
    t.assert.deepStrictEqual(states, [ 2, 3 ])
  })
})

describe('hooks', function () {
  test("should be able to handle hook failure",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    const workflow = rivr.workflow<number>("complex-calculation")
      .addHook("onWorkflowCompleted", (w, s) => {
        throw "oops"
      })
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })

    let error: unknown

    const worker = engine.createWorker()
    worker.addHook("onError", err => {
      error = err
    })
    await worker.start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 1)

    // Then
    await waitForPredicate(() => error !== undefined)
    t.assert.deepEqual(error, "oops")
  })

  // test("execute all the handler",  async (t: TestContext) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     dbName: randomUUID(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     signal: t.signal,
  //     delayBetweenPulls: 10
  //   })
  //
  //   const stepCompletedStates: number[] = []
  //   let finished = false
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .addHook("onStepCompleted", (w, s, state) => {
  //       stepCompletedStates.push(state)
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       finished = true
  //     })
  //     .step({
  //       name: "add-3",
  //       handler: ({ state }) => state + 3
  //     })
  //     .register(w => {
  //       return w
  //         .addHook("onStepCompleted", (w, s, state) => {
  //           stepCompletedStates.push(state)
  //         })
  //         .step({
  //           name: "add-4",
  //           handler: ({ state }) => state + 4
  //         })
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 3)
  //
  //   // Then
  //   let now = new Date().getTime()
  //   while (!finished && new Date().getTime() - now < 5_000) {
  //     await setTimeout(20)
  //   }
  //
  //   t.assert.deepStrictEqual(stepCompletedStates, [ 6, 6, 10, 10 ])
  // })

  // test("execute onWorkflowCompleted hooks in order",  async (t: TestContext) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     dbName: randomUUID(),
  //     signal: t.signal,
  //     delayBetweenPulls: 10
  //   })
  //
  //   let elements: number[] = []
  //   let finished = false
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       elements.push(1)
  //     })
  //     .step({
  //       name: "add-1",
  //       handler: ({ state }) => state + 1
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       elements.push(2)
  //     })
  //     .register(w => {
  //       return w
  //         .addHook("onWorkflowCompleted", (w, s) => {
  //           elements.push(3)
  //         })
  //         .step({
  //           name: "add-4",
  //           handler: ({ state }) => state + 4
  //         })
  //     })
  //     .addHook("onWorkflowCompleted", (w, s) => {
  //       elements.push(4)
  //       finished = true
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 3)
  //
  //   // Then
  //   await waitForPredicate(() => finished)
  //   t.assert.deepEqual(finished, true)
  //   t.assert.deepStrictEqual(elements, [ 1, 2, 3, 4 ])
  // })

  // test("should be able to execute a hook in the correct context",  async (t) => {
  //   // Given
  //   const engine = createEngine({
  //     url: container.getConnectionString(),
  //     clientOpts: {
  //       directConnection: true
  //     },
  //     dbName: randomUUID(),
  //     signal: t.signal,
  //     delayBetweenPulls: 10
  //   })
  //
  //   let hookValue: number | undefined
  //
  //   const workflow = rivr.workflow<number>("complex-calculation")
  //     .step({
  //       name: "add-1",
  //       handler: ({ state }) => state + 1
  //     })
  //     .register(w => {
  //       return w.decorate("foo", 4)
  //         .addHook("onStepCompleted", function (workflow1, step, state) {
  //           hookValue = workflow1.foo + state
  //         })
  //     })
  //
  //   await engine.createWorker().start([ workflow ])
  //
  //   // When
  //   await engine.createTrigger().trigger(workflow, 1)
  //
  //   // Then
  //   await waitForPredicate(() => hookValue !== undefined)
  //   t.assert.deepEqual(hookValue, 6)
  // })
})

describe("resilience", () => {
  let network: StartedNetwork
  let mongodb: StartedMongoDBContainer
  let toxiproxy: StartedToxiProxyContainer

  before(async () => {
    network = await new Network().start()

    mongodb = await new MongoDBContainer("mongo:8")
      .withNetwork(network)
      .withNetworkAliases("mongodb")
      .start()

    toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
      .withNetwork(network)
      .start()
  })

  let proxy!: CreatedProxy

  beforeEach(async () => {
    proxy = await toxiproxy.createProxy({
      name: "mongodb",
      upstream: "mongodb:27017",
      enabled: true
    })
  })

  afterEach(async () => {
    await proxy.instance.remove()
  })

  after(async () => {
    await toxiproxy.stop()
    await mongodb.stop()
    await network.stop()
  })

  test("should be able to survive a mongodb crash",  async (t) => {
    // Given
    const engine = createEngine({
      url: `mongodb://${proxy.host}:${proxy.port}`,
      clientOpts: {
        serverSelectionTimeoutMS: 3_000,
        socketTimeoutMS: 3_000,
        waitQueueTimeoutMS: 3_000,
        connectTimeoutMS: 3_000,
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let state: unknown

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-2",
        handler: ({ state }) => state + 2
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        state = s
      })

    let error: unknown

    const worker = engine.createWorker()
      .addHook("onError", err => {
        error = err
      })

    await workflow.ready()

    // When
    await engine.createTrigger().trigger(workflow, 2)
    await proxy.setEnabled(false)
    await worker.start([ workflow ])
    await waitForPredicate(() => error !== undefined)
    await proxy.setEnabled(true)

    // Then
    await waitForPredicate(() => state !== undefined)
    t.assert.deepEqual(state, 4)
  })

  test("should be able to survive a write error",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: `mongodb://${proxy.host}:${proxy.port}`,
      clientOpts: {
        serverSelectionTimeoutMS: 3_000,
        socketTimeoutMS: 1_000,
        waitQueueTimeoutMS: 1_000,
        connectTimeoutMS: 1_000,
        directConnection: true
      },
      dbName: randomUUID(),
      signal: t.signal,
      delayBetweenPulls: 10
    })

    let error: unknown

    const worker = engine.createWorker()
      .addHook("onError", err => {
        error = err
      })

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-3",
        handler: ({ state }) => state + 3
      })
      .step({
        name: "disable-proxy",
        handler: async ({ state }) => {
          await proxy.setEnabled(false)
          return state
        }
      })

    await worker.start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 1)

    // Then
    await waitForPredicate(() => error !== undefined)
    t.assert.deepStrictEqual(error instanceof MongoBulkWriteError, true)
  })
})

describe('storage', function () {
  test("should be able to find workflow state by id", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      signal: t.signal,
      delayBetweenPulls: 10,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
    })

    let result: unknown

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (w, s) => {
        result = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 1, { id: "1" })

    // Then
    await waitForPredicate(() => result !== undefined)
    t.assert.deepStrictEqual(await engine.createStorage().findById("1"), {
      id: "1",
      name: "complex-calculation",
      result: 1,
      status: "successful",
      steps: [
        {
          attempts: [
            {
              id: 1,
              status: "successful",
            }
          ],
          name: "add-1"
        }
      ],
      toExecute: {
        areRetryExhausted: false,
        attempt: 1,
        state: 1,
        status: "done",
        step: "add-1"
      }
    })
  })
})

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}
