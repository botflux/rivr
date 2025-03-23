import { test, before, after, type TestContext } from "node:test"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import { randomUUID } from "crypto"
import { setTimeout } from "timers/promises"
import { createEngine } from "./mongodb.ts"
import { rivr } from "./workflow.ts"

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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(state, 7)
})

test("skip a step", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
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

    engine.createWorker().start([ workflow ])

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

test("stop a workflow", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!stopped && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(stoppedState, 6)
})

test("execute a workflow made of multiple steps", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
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
        .step({
            name: "multiply-by-3",
            handler: ({ state }) => state * 3
        })
        .addHook("onWorkflowCompleted", (w, s) => {
            hookExecuted = true
            state = s
        })

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 0)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(state, 9)
})

test("decorate workflow", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(state, 6)
})

test("register plugin", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    let hookExecuted = false
    let state

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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(state, 6)
})

test("register step in a plugin", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
        signal: t.signal
    })

    let hookExecuted = false
    let state

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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(state, 10)
})

test("handle step errors", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
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

    engine.createWorker().start([ workflow ])

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

test("return a ok step result", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 4)

    // Then
    let now = new Date().getTime()
    while (!hookExecuted && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }
    t.assert.deepEqual(state, 7)
})

test("return a error step result", async (t) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
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

    engine.createWorker().start([ workflow ])

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

test("execute all the handler", async (t: TestContext) => {
    // Given
    const engine = createEngine({
        url: container.getConnectionString(),
        dbName: randomUUID(),
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

    engine.createWorker().start([ workflow ])

    // When
    await engine.createTrigger().trigger(workflow, 3)

    // Then
    let now = new Date().getTime()
    while (!finished && new Date().getTime() - now < 5_000) {
        await setTimeout(20)
    }

    t.assert.deepStrictEqual(stepCompletedStates, [ 6, 6, 10, 10 ])
})
