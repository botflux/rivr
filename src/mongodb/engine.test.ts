import {it, test} from "node:test"
import assert from "node:assert"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import {failure, skip, stop, success, Workflow} from "../workflow"
import { MongoClient } from "mongodb"
import { MongoDBWorkflowEngine } from "./engine"
import { randomUUID } from "node:crypto"
import { tryUntilSuccess } from "../try-until-success"
import { StepStateCollection } from "./step-state-collection"
import { waitAtLeastForSuccess } from "../wait-at-least-for-success"
import {linear} from "../retry";
import {waitAtLeastOrTimeout} from "../wait-at-least-or-timeout";

test("mongodb workflow engine", async function (t) {
    let mongo: StartedMongoDBContainer = undefined!
    let client: MongoClient = undefined!

    t.before(async () => {
        mongo = await new MongoDBContainer().start()
        client = await new MongoClient(mongo.getConnectionString(), {
            directConnection: true
        }).connect()
    })

    t.after(async () => {
        await mongo?.stop()
        await client?.close(true)
    })

    await t.test("should be able to execute a workflow using mongodb as the workflow engine", async function (t) {
        // Given
        let result: number | undefined = undefined

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add_5", s => s + 5)
            w.step("multiply_by_7", s => s * 7)
            w.step("assign", s => result = s)
        })

        const engine = MongoDBWorkflowEngine.create({ 
            client,
            dbName: randomUUID(),
        })

        await engine.start(workflow, { 
            signal: t.signal,
            pollingIntervalMs: 10 
        })
        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(2)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal(result, (2 + 5) * 7)
        }, 3_000)
    })

    await t.test("should be able to retry a step", async function (t) {
        // Given
        let result: number | undefined = undefined

        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName: randomUUID()
        })

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add_5", (s, { attempt }) => {
                if (attempt <= 1)
                    throw new Error("oops something went wrong")

                return s + 5
            })
            w.step("assign", s => {
                result = s
            })
        })

        await engine.start(workflow, {
            signal: t.signal,
            pollingIntervalMs: 10
        })

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(5)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal(result, 5 + 5)
        }, 3_000)
    })

    await t.test("should be able to retry a step until the max retry is reached", async function (t) {
        // Given
        const dbName = randomUUID()

        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName
        })

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("always_throw", () => {
                throw new Error("oops")
            })
        })

        await engine.start(workflow, {
            signal: t.signal,
            pollingIntervalMs: 10,
            maxAttempts: 10
        })

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(10)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal((await getState(client, dbName, "workflow", "always_throw"))[0]?.context.attempt, 10)
        }, 3_000)
    })

    await t.test("should be able to return a state from each step to control the process flow", async function (t) {
        // Given
        const dbName = randomUUID()
        let result: number | undefined

        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName
        })

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add-5", s => success(s + 5))
            w.step("multiply-by-attempt", (s, { attempt }) => attempt === 1
              ? failure(new Error("oops"), { retry: linear(1_000) })
              : success(s * attempt))
            w.step("assign", s => {
                result = s
            })
        })

        await engine.start(workflow, {
            maxAttempts: 10,
            signal: t.signal,
            pollingIntervalMs: 100
        })

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(2)

        // Then
        await waitAtLeastForSuccess(async () => {
            assert.strictEqual(result, 14)
        }, 1_000)
    })

    await t.test("should be able to stop a process in the middle of it", async function (t) {
        // Given
        const dbName = randomUUID()

        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName
        })

        let values: number[] = []

        let i = 0

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add-10", s => s + 10)
            w.step("assign", s => {
                values.push(s)
            })
            w.step("stopping", () => {
                i ++
                if (i === 1)
                    return stop()
            })
            w.step("multiple_by_2", s => s * 2)
            w.step("assign 2", s => {
                values.push(s)
            })
        })

        await engine.start(workflow, {
            signal: t.signal,
            pollingIntervalMs: 10,
        })

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(10)
        await trigger.trigger(20)

        // Then
        await tryUntilSuccess(async () => {
            assert.deepStrictEqual(values, [ 20, 30, 60 ])
        }, 1_000)
    })

    await t.test("should be able to skip a step", async function (t) {
        // Given
        const dbName = randomUUID()
        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName
        })

        let i = 0
        const values: number[] = []

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add-10", s => s + 10)
            w.step("add-20-or-skip", s => {
                i++

                if (i === 1)
                    return skip()

                return s + 20
            })
            w.step("multiply", s => s * 2)
            w.step("assign", s => {
                values.push(s)
            })
        })

        await engine.start(workflow, {
            signal: t.signal,
            pollingIntervalMs: 100,
        })

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(10)
        await trigger.trigger(20)

        // Then
        await tryUntilSuccess(async () => {
            assert.deepStrictEqual(values, [ 20, 100 ])
        }, 1_000)
    })

    await t.test("should be able to space attempt based on a time function", async function (t) {
        // Given
        let date: Date | undefined = undefined
        const dbName = randomUUID()
        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName,
        })

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add-10", s => s + 10)
            w.step("throw", () => {
                date = new Date()
                throw new Error("oops")
            })
        })

        await engine.start(workflow, {
            maxAttempts: 2,
            timeBetweenRetries: attempt => 3_000,
            signal: t.signal,
            pollingIntervalMs: 100
        })

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(10)

        // Then
        await waitAtLeastForSuccess(async () => {
            assert.deepStrictEqual(
              (await getState(client, dbName, "workflow", "throw"))[0]?.minDateBeforeNextAttempt!.getTime() >= dateAdd(date!, 3_000).getTime(),
              true)
        }, 5_000)
    })
})

function getState(client: MongoClient, db: string, workflow: string, step: string, collection: string = "workflows") {
    return new StepStateCollection(client.db(db).collection(collection)).findStepStates(workflow, step)
}

function dateAdd (date: Date, ms: number): Date {
    return new Date(date.getTime() + ms)
}