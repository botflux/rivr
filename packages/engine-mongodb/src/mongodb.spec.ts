
import {test, before, after, type TestContext, describe, beforeEach, afterEach} from "node:test"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import { randomUUID } from "crypto"
import { setTimeout } from "timers/promises"
import { createEngine } from "./mongodb"
import {advancedFlowControl, basicFlowControl, extension, rivr, rivrPlugin} from "rivr"
import {Network, StartedNetwork} from "testcontainers";
import {CreatedProxy, StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {MongoBulkWriteError, MongoServerSelectionError} from "mongodb";

let container!: StartedMongoDBContainer

before(async () => {
  container = await new MongoDBContainer("mongo:8").start()
})

after(async () => {
  await container?.stop()
})

describe('mongodb', function () {
  const makeEngine = () => createEngine({
    url: container.getConnectionString(),
    clientOpts: {
      directConnection: true
    },
    dbName: randomUUID(),
    delayBetweenEmptyPolls: 100,
  })

  basicFlowControl({ createEngine: makeEngine })
  advancedFlowControl({ createEngine: makeEngine })
  extension({ createEngine: makeEngine })
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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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

  test("should be able to register a plugin with a step", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      delayBetweenEmptyPolls: 10,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      }
    })

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

  test("register step in a plugin",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

    let state: unknown

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
        state = s
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    await waitForPredicate(() => state !== undefined)
    t.assert.deepEqual(state, 10)
  })

  test("register a plugin without step does not break the current state's tracking",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenEmptyPolls: 10
    })

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

  test("register a plugin with dependencies",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenEmptyPolls: 10
    })

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

  test("register a plugin with options",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenEmptyPolls: 10
    })

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
    t.assert.deepStrictEqual(state, "Hello, Daneel!")
  })

  test("register a plugin with a missing dependency throw an error",  async (t) => {
    const plugin1 = rivrPlugin({
      deps: [],
      name: "plugin-1",
      plugin: p => p.input()
    })
    const plugin2 = rivrPlugin({
      deps: [ plugin1 ],
      name: "plugin-2",
      plugin: p => p.input()
    })

    await t.assert.rejects(
      rivr.workflow("my-workflow").register(plugin2).ready(),
      new Error(`Plugin "plugin-2" needs "plugin-1" to be registered`)
    )
  })

  test("should be able to list all the missing dependencies", async (t) => {
    // Given
    const p1 = rivrPlugin({
      name: "plugin-1",
      plugin: p => p.input()
    })

    const p2 = rivrPlugin({
      name: "plugin-2",
      plugin: p => p.input()
    })

    const p3 = rivrPlugin({
      name: "plugin-3",
      plugin: p => p.input()
    })

    const p4 = rivrPlugin({
      name: "plugin-4",
      deps: [ p1, p2, p3 ],
      plugin: p => p.input()
    })

    const workflow = rivr.workflow("p")
      .register(p2)
      .register(p4)

    // When
    // Then
    await t.assert.rejects(
      workflow.ready(),
      new Error('Plugin "plugin-4" needs "plugin-1", "plugin-3" to be registered')
    )
  })

  test("declare a plugin options as a function",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenEmptyPolls: 10
    })

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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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
    t.assert.deepStrictEqual(states.toSorted(), [ 2, 3 ])
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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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

  test("emit a workflow completed if the last step is optional and is failing",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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

  test("execute all the handler",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

    const stepCompletedStates: unknown[] = []
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
    await waitForPredicate(() => finished)
    t.assert.deepStrictEqual(stepCompletedStates, [ 6, 6, 10, 10 ])
  })

  test("execute onWorkflowCompleted hooks in order",  async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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

  test("should be able to execute a hook in the correct context",  async (t) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      clientOpts: {
        directConnection: true
      },
      dbName: randomUUID(),
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

    let hookValue: unknown

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .register(w => {
        return w.decorate("foo", 4)
          .addHook("onStepCompleted", function (workflow1, step, state) {
            hookValue = workflow1.foo + (state as number)
          })
      })

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 1)

    // Then
    await waitForPredicate(() => hookValue !== undefined)
    t.assert.deepEqual(hookValue, 6)
  })
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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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
      delayBetweenEmptyPolls: 10
    })

    t.after(() => engine.close())

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

    t.assert.deepStrictEqual(
      error instanceof MongoBulkWriteError || error instanceof MongoServerSelectionError ||
      (typeof error === "object" && error !== null && "message" in error && error.message === "This socket has been ended by the other party"),
      true,
      `${(error as any)?.constructor?.name} "${(error as any)?.message}" does not match the expected error`
    )
  })
})

describe('storage', function () {
  test("should be able to find workflow state by id", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      delayBetweenEmptyPolls: 10,
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true
      },
    })
    const now = new Date()

    t.after(() => engine.close())

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
    await engine.createTrigger().trigger(workflow, 1, { id: "1", now })

    // Then
    await waitForPredicate(() => result !== undefined)
    const mState = await engine.createStorage().findById("1")

    t.assert.deepStrictEqual(mState ? omit(mState, [ "lastModified" ]) : mState, {
      id: "1",
      name: "complex-calculation",
      result: 2,
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
      },
    })
  })

  test("should be able to find a list of workflow", async (t: TestContext) => {
    // Given
    const engine = createEngine({
      url: container.getConnectionString(),
      dbName: randomUUID(),
      clientOpts: {
        directConnection: true,
      },
    })

    t.after(() => engine.close())

    let doneCount = 0

    const workflow = rivr.workflow<number>("complex-calculation")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (w, s) => doneCount++)

    await engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 10)
    await engine.createTrigger().trigger(workflow, 20)
    await engine.createTrigger().trigger(workflow, 30)

    // Then
    await waitForPredicate(() => doneCount === 3)
    const states = await engine.createStorage().findAll({
      workflows: [ workflow ]
    })
    t.assert.deepStrictEqual(states.map(s => omit(s, [ "lastModified", "id" ])), [
      {
        name: "complex-calculation",
        result: 11,
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
          state: 10,
          status: "done",
          step: "add-1"
        }
      },
      {
        name: "complex-calculation",
        result: 21,
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
          state: 20,
          status: "done",
          step: "add-1"
        }
      },
      {
        name: "complex-calculation",
        result: 31,
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
          state: 30,
          status: "done",
          step: "add-1"
        }
      }
    ])
  })
})

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}

function omit<Object extends Record<never, never>, Key extends keyof Object>(
  o: Object,
  keys: Key[]
): Omit<Object, Key> {
  const shallowCopy = { ...o }

  for (const key of keys) {
    delete shallowCopy[key]
  }

  return shallowCopy
}