import { test } from "node:test"
import assert from "node:assert"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import { Workflow } from "../workflow"
import { MongoClient } from "mongodb"
import { MongoDBWorkflowEngine } from "./mongodb-workflow-engine"
import { randomUUID } from "node:crypto"
import { tryUntilSuccess } from "../try-until-success"
import { StepStateCollection } from "./step-state-collection"

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
})

function getState(client: MongoClient, db: string, workflow: string, step: string, collection: string = "workflows") {
    return new StepStateCollection(client.db(db).collection(collection)).findStepStates(workflow, step)
}