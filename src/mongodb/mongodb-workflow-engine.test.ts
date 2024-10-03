import { test } from "node:test"
import assert from "node:assert"
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb"
import { Workflow } from "../workflow"
import { MongoClient } from "mongodb"
import { MongoDBWorkflowEngine } from "./mongodb-workflow-engine"
import { randomUUID } from "node:crypto"
import { tryUntilSuccess } from "../try-until-success"

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
            pollingIntervalMs: 10
        })

        await engine.start(workflow, { signal: t.signal })
        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(2)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal(result, (2 + 5) * 7)
        }, 3_000)
    })
})