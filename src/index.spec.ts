import { test, before, after, TestContext } from "node:test"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import EventEmitter, { on, once } from "node:events"
import { rivr } from "./core"
import { createEngine } from "./mongodb"
import { randomUUID } from "node:crypto"

let container!: StartedMongoDBContainer

before(async () => {
    container = await new MongoDBContainer("mongo:8").start()
})

after(async () => {
    await container?.stop()
})

test("test execute a workflow", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        signal: t.signal,
        dbName: randomUUID()
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-1",
            handler: ({ state }) => state + 1
        })

    const getEvents = collectEvents(workflow, "workflowCompleted", t.signal)
    const completed = once(workflow, "workflowCompleted")

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 2)

    // Then
    await completed
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{state: 3}]])
})

test("test execute a workflow composed of multiple steps", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        signal: t.signal,
        dbName: randomUUID()
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-1",
            handler: ({ state }) => state + 1
        })
        .step({
            name: "multiply-by-5",
            handler: ({ state }) => state * 5
        })
    
    const getEvents = collectEvents(workflow, "workflowCompleted", t.signal)
    const completed = once(workflow, "workflowCompleted")

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 2)

    // Then
    await completed
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{state: 15}]])
})

test("should be able to return a step result instead of the new state directly", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        signal: t.signal,
        dbName: randomUUID()
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-5",
            handler: ctx => ctx.success(ctx.state + 5)
        })

    const getEvents = collectEvents(workflow, "workflowCompleted", t.signal)
    const completed = once(workflow, "workflowCompleted")

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 5)

    // Then
    await completed
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{ state: 10 }]])
})

test("should be able to catch step errors", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        signal: t.signal,
        dbName: randomUUID()
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "throw",
            handler: ctx => {
                throw "oops"
            }
        })

    const getEvents = collectEvents(workflow, "stepFailed", t.signal)
    const failure = once(workflow, "stepFailed")

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 5)

    // Then
    await failure
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{ error: "oops" }]])
})

test("should be able to declare a step error using the step result", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        signal: t.signal,
        dbName: randomUUID()
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "throw",
            handler: ctx => ctx.fail("oops")
        })

    const getEvents = collectEvents(workflow, "stepFailed", t.signal)
    const failure = once(workflow, "stepFailed")

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 5)

    // Then
    await failure
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{error: "oops"}]])
})

test("should be able to decorate the workflow", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        dbName: randomUUID(),
        url: container.getConnectionString(),
        signal: t.signal
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .decorate("add", (x: number, y: number) => x + y)
        .step({
            name: "add-5",
            handler: ({ workflow, state }) => workflow.add(state, 5)
        })

    const getEvents = collectEvents(workflow, "workflowCompleted", t.signal)
    const completed = once(workflow, "workflowCompleted")

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 5)

    // Then
    await completed
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{ state: 10 }]])
})

test("should be able to skip a step", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-1",
            handler: ctx => ctx.state + 1
        })
        .step({
            name: "skipped",
            handler: ctx => ctx.skip()
        })
        .step({
            name: "multiply-by-2",
            handler: ctx => ctx.state * 2
        })

    const skipped = once(workflow, "stepSkipped")
    const completed = once(workflow, "workflowCompleted")
    
    const getSkipped = collectEvents(workflow, "stepSkipped", t.signal)
    const getWorkflowCompleted = collectEvents(workflow, "workflowCompleted", t.signal)

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 1)

    // Then
    await skipped
    await completed

    t.assert.deepEqual(getSkipped().length, 1)
    t.assert.deepEqual(getWorkflowCompleted().length, 1)
    t.assert.deepStrictEqual(getWorkflowCompleted(), [[{ state: 4 }]])
})

test("should be able to stop a workflow", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-2",
            handler: ctx => ctx.state + 2
        })
        .step({
            name: "stop",
            handler: ctx => ctx.stop()
        })
        .step({
            name: "add-4",
            handler: ctx => ctx.state + 4
        })

    const completed = once(workflow, "workflowCompleted")
    const getCompletedEvents = collectEvents(workflow, "workflowCompleted", t.signal)

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 1)

    // Then
    await completed
    t.assert.deepEqual(getCompletedEvents().length, 1)
    t.assert.deepStrictEqual(getCompletedEvents(), [[{state: 3}]])
})

test("should be able to execute callback returning promises", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-2",
            handler: async ctx => ctx.state + 2
        })

    const completed = once(workflow, "workflowCompleted")
    const getEvents = collectEvents(workflow, "workflowCompleted", t.signal)

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    await completed
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{ state: 6 }]])
})

test("should be able to execute callback returning a promise of a result", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    const workflow = rivr.workflow<number>("complex-calculation")
        .step({
            name: "add-2",
            handler: async ctx => ctx.success(ctx.state + 2)
        })

    const completed = once(workflow, "workflowCompleted")
    const getEvents = collectEvents(workflow, "workflowCompleted", t.signal)

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    await completed
    t.assert.deepEqual(getEvents().length, 1)
    t.assert.deepStrictEqual(getEvents(), [[{ state: 6 }]])
})

test("should be able to execute a hook before handling a job", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    let executed = false

    const workflow = rivr.workflow<number>("complex-calculation")
        .addHook("onStep", () => {
            executed = true
        })
        .step({
            name: "add-2",
            handler: ({ state }) => state + 2
        })
        
    const completed = once(workflow, "workflowCompleted")
    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 2)

    // Then
    await completed
    t.assert.deepEqual(executed, true)
})

function collectEvents (emitter: EventEmitter, event: string, signal: AbortSignal) {
    let events: unknown[][] = []

    function onEvent (...args: unknown[]) {
        events.push(args)
    }

    emitter.on(event, onEvent)
    signal.addEventListener("abort", () => emitter.off(event, onEvent))

    return () => events
}