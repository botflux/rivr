import { test, before, after } from "node:test"
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

test("decorate workflow", {only: true}, async (t) => {
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
