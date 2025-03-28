import {test, before, after, type TestContext, describe, beforeEach, afterEach} from "node:test"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import { randomUUID } from "crypto"
import { setTimeout } from "timers/promises"
import { createEngine } from "./mongodb.ts"
import { rivr } from "./workflow.ts"
import {Network, StartedNetwork} from "testcontainers";
import {CreatedProxy, StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {MongoBulkWriteError} from "mongodb";
import {rivrPlugin} from "./plugin.ts";

let container!: StartedMongoDBContainer

before(async () => {
    container = await new MongoDBContainer("mongo:8").start()
})

after(async () => {
    await container.stop()
})

test("execute a workflow step", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
          directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
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

test("skip a step", {skip: false}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
        signal: t.signal
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

test("stop a workflow", {skip: false}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
        signal: t.signal
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

test("execute a workflow made of multiple steps", {skip: false}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
        signal: t.signal
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

test("decorate workflow", {skip: false}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
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

test("register plugin", {skip: false}, async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
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

test("register step in a plugin", {skip: false, only: true}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
    })

    let hookExecuted = false
    let state: number | undefined

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "divide-by-2",
            handler: ({ state }) => state / 2
        })
        .register(workflow => workflow
            .decorate("add", (x: number, y: number) => x + y)
            .step({
                name: "add-3",
                handler: ({ state, workflow }) => workflow.add(state, 3)
            })
        )
        .step({
            name: "multiply-by-2",
            handler: ({ state }) => state * 2
        })
        .addHook("onWorkflowCompleted", (w, s) => {
            hookExecuted = true
            state = s
        })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    await waitForPredicate(() => state !== undefined)
    t.assert.deepEqual(state, 10)
})

test("register a plugin with dependencies", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    signal: t.signal,
    dbName: randomUUID(),
    clientOpts: {
      directConnection: true
    }
  })

  const pluginA = rivrPlugin((w) => w.decorate("foo", 1), [])
  const pluginB = rivrPlugin(w => w.decorate("bar", w.foo + 1), [ pluginA ])

  let state: number | undefined

  const workflow = rivr.workflow<number>("complex-calculation")
    .register(pluginA)
    .register(pluginB)
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

test("register a plugin with a missing dependency throw an error", {skip: true}, (t) => {
  const plugin1 = rivrPlugin(w => w, [  ])
  const plugin2 = rivrPlugin(w => w, [ plugin1 ])

  t.assert.throws(() => {
    rivr.workflow("my-workflow").register(plugin2)
  }, new Error("A plugin is missing its dependency"))
})

test("handle step errors", {skip: true}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
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

test("return a ok step result", {skip: true}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
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

test("return a error step result", {skip: true}, async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
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

test("execute all the handler", {skip: true}, async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
        signal: t.signal
    })

    const stepCompletedStates: number[] = []
    let finished = false

    const workflow = rivr.workflow<number>("complex-calculation")
        .addHook("onStepCompleted", (w, s, state) => {
            stepCompletedStates.push(state)
        })
        .addHook("onWorkflowCompleted", (w, s) => {
            finished = true
        })
        .step({
            name: "add-3",
            handler: ({ state }) => state + 3
        })
        .register(w => {
            return w
                .addHook("onStepCompleted", (w, s, state) => {
                    stepCompletedStates.push(state)
                })
                .step({
                    name: "add-4",
                    handler: ({ state }) => state + 4
                })
        })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!finished && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }

    t.assert.deepStrictEqual(stepCompletedStates, [ 6, 6, 10, 10 ])
})

test("execute onWorkflowCompleted hooks in order", {skip: true}, async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
        dbName: randomUUID(),
        signal: t.signal
    })

    let elements: number[] = []
    let finished = false

    const workflow = rivr.workflow<number>("complex-calculation")
      .addHook("onWorkflowCompleted", (w, s) => {
          elements.push(1)
      })
      .step({
          name: "add-1",
          handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (w, s) => {
          elements.push(2)
      })
      .register(w => {
          return w
            .addHook("onWorkflowCompleted", (w, s) => {
                elements.push(3)
            })
            .step({
                name: "add-4",
                handler: ({ state }) => state + 4
            })
      })
      .addHook("onWorkflowCompleted", (w, s) => {
          elements.push(4)
          finished = true
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    await waitForPredicate(() => finished)
    t.assert.deepEqual(finished, true)
    t.assert.deepStrictEqual(elements, [ 1, 2, 3, 4 ])
})

test("should be able to execute a hook in the correct context", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    clientOpts: {
      directConnection: true
    },
    dbName: randomUUID(),
    signal: t.signal
  })

  let hookValue: number | undefined

  const workflow = rivr.workflow<number>("complex-calculation")
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .register(w => {
      return w.decorate("foo", 4)
        .addHook("onStepCompleted", function (workflow1, step, state) {
          hookValue = workflow1.foo + state
        })
    })

  await engine.createWorker().start([ workflow ])

  // When
  await engine.createTrigger().trigger(workflow, 1)

  // Then
  await waitForPredicate(() => hookValue !== undefined)
  t.assert.deepEqual(hookValue, 6)
})

test("should be able to execute async handler", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    dbName: randomUUID(),
    clientOpts: {
      directConnection: true
    },
    signal: t.signal
  })

  let state: number | undefined

  const workflow = rivr.workflow<number>("complex-calculation")
    .step({
      name: "add-1-async",
      handler: async ({ state }) => state + 1
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

test("should be able to handle hook failure", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    clientOpts: {
      directConnection: true
    },
    dbName: randomUUID(),
    signal: t.signal
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

test("should be able to execute the write in a transaction", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    clientOpts: {
      directConnection: true
    },
    dbName: randomUUID(),
    signal: t.signal
  })

  const db = randomUUID()

  let state: number | undefined

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

test("should be able to retry a failed step", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    clientOpts: {
      directConnection: true,
    },
    dbName: randomUUID(),
    signal: t.signal
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

test("should be able to not retry failed steps by default", {skip: true}, async (t) => {
  // Given
  const engine = createEngine({
    url: container.getConnectionString(),
    clientOpts: {
      directConnection: true,
    },
    dbName: randomUUID(),
    signal: t.signal
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

describe("resilience", {skip: true}, () => {
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

  test("should be able to survive a mongodb crash", {skip: true}, async (t) => {
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
      signal: t.signal
    })

    let state: number | undefined

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

  test("should be able to survive a write error", async (t: TestContext) => {
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
      signal: t.signal
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

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
    let now = new Date().getTime()
    while (!fn() && new Date().getTime() - now < ms) {
        await setTimeout(20)
    }
}