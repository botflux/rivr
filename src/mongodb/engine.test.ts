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
import { once } from "node:events"
import {Poller} from "../poll/poller";

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
            w.step("add_5", ({state}) => state + 5)
            w.step("multiply_by_7", ({state}) => state * 7)
            w.step("assign", ({state}) => result = state)
        })

        const engine = MongoDBWorkflowEngine.create({ 
            client,
            dbName: randomUUID(),
        })

        const poller = await engine.getPoller(workflow, {
            pollingIntervalMs: 10 
        })
        const trigger = await engine.getTrigger(workflow)

        const getErrors = collectErrors(poller)
        poller.start(t.signal)

        // When
        await trigger.trigger(2)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal(result, (2 + 5) * 7)
        }, 3_000)
        assert.deepEqual(getErrors(), [])
    })

    await t.test("should be able to retry a step", async function (t) {
        // Given
        let result: number | undefined = undefined

        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName: randomUUID()
        })

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add_5", ({ state, metadata: { attempt } }) => {
                if (attempt <= 1)
                    throw new Error("oops something went wrong")

                return state + 5
            })
            w.step("assign", ({state}) => {
                result = state
            })
        })

        const poller = await engine.getPoller(workflow, {
            pollingIntervalMs: 10
        })

        const trigger = await engine.getTrigger(workflow)

        const getErrors = collectErrors(poller)
        poller.start(t.signal)

        // When
        await trigger.trigger(5)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal(result, 5 + 5)
        }, 3_000)
        assert.deepEqual(getErrors(), [])
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

        const poller = await engine.getPoller(workflow, {
            pollingIntervalMs: 10,
            maxAttempts: 10
        })

        const trigger = await engine.getTrigger(workflow)

        const getErrors = collectErrors(poller)
        poller.start(t.signal)

        // When
        await trigger.trigger(10)

        // Then
        await tryUntilSuccess(async () => {
            assert.equal((await getState(client, dbName, "workflow", "always_throw"))[0]?.context.attempt, 10)
        }, 3_000)
        assert.deepEqual(getErrors(), [])
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
            w.step("add-5", ({state}) => success(state + 5))
            w.step("multiply-by-attempt", ({ state, metadata: { attempt } }) => attempt === 1
              ? failure(new Error("oops"), { retry: linear(1_000) })
              : success(state * attempt))
            w.step("assign", ({state}) => {
                result = state
            })
        })

        const poller = await engine.getPoller(workflow, {
            maxAttempts: 10,
            pollingIntervalMs: 100
        })

        const trigger = await engine.getTrigger(workflow)

        const getErrors = collectErrors(poller)
        poller.start(t.signal)

        // When
        await trigger.trigger(2)

        // Then
        await waitAtLeastForSuccess(async () => {
            assert.strictEqual(result, 14)
        }, 1_000)
        assert.deepEqual(getErrors(), [])
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
            w.step("add-10", ({state}) => state + 10)
            w.step("assign", ({state}) => {
                values.push(state)
            })
            w.step("stopping", () => {
                i ++
                if (i === 1)
                    return stop()
            })
            w.step("multiple_by_2", ({state}) => state * 2)
            w.step("assign 2", ({state}) => {
                values.push(state)
            })
        })

        const poller = await engine.getPoller(workflow, {
            pollingIntervalMs: 10,
        })
        const getErrors = collectErrors(poller)
        const trigger = await engine.getTrigger(workflow)

        poller.start(t.signal)

        // When
        await trigger.trigger(10)
        await trigger.trigger(20)

        // Then
        await tryUntilSuccess(async () => {
            assert.deepStrictEqual(values, [ 20, 30, 60 ])
        }, 1_000)
        assert.deepEqual(getErrors(), [])
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
            w.step("add-10", ({state}) => state + 10)
            w.step("add-20-or-skip", ({state}) => {
                i++

                if (i === 1)
                    return skip()

                return state + 20
            })
            w.step("multiply", ({state}) => state * 2)
            w.step("assign", ({state}) => {
                values.push(state)
            })
        })

        const poller = await engine.getPoller(workflow, {
            pollingIntervalMs: 100,
        })

        const trigger = await engine.getTrigger(workflow)

        const getErrors = collectErrors(poller)
        poller.start(t.signal)

        // When
        await trigger.trigger(10)
        await trigger.trigger(20)

        // Then
        await tryUntilSuccess(async () => {
            assert.deepStrictEqual(values, [ 20, 100 ])
        }, 1_000)
        assert.deepEqual(getErrors(), [])
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
            w.step("add-10", ({state}) => state + 10)
            w.step("throw", () => {
                date = new Date()
                throw new Error("oops")
            })
        })

        const poller = await engine.getPoller(workflow, {
            maxAttempts: 2,
            timeBetweenRetries: attempt => 3_000,
            pollingIntervalMs: 100
        })

        const trigger = await engine.getTrigger(workflow)

        const getErrors = collectErrors(poller)
        poller.start(t.signal)

        // When
        await trigger.trigger(10)

        // Then
        await waitAtLeastForSuccess(async () => {
            assert.deepStrictEqual(
              (await getState(client, dbName, "workflow", "throw"))[0]?.minDateBeforeNextAttempt!.getTime() >= dateAdd(date!, 3_000).getTime(),
              true)
        }, 5_000)
        assert.deepEqual(getErrors(), [])
    })

    await t.test("should be able to split work across multiple pollers", async function (t) {
        // Given
        const dbName = randomUUID()
        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName,
        })

        let results: number[] = []
        let countByPoller = new Map<string, number>()

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add-10", ({state}) => state + 10)
            w.step("multiply-by-5", ({state}) => state * 5)
            w.step("assign", ({ state, metadata: { pollerId } }) => {
                results.push(state)
                countByPoller.set(pollerId, (countByPoller.get(pollerId) ?? 0) + 1)
            })
        })

        const poller1 = await engine.getPoller(workflow, {
            pollingIntervalMs: 1_000,
            pageSize: 2,
            replicated: true
        })
        const poller2 = await engine.getPoller(workflow, {
            pollingIntervalMs: 1_000,
            pageSize: 2,
            replicated: true
        })

        poller1.start(t.signal)
        poller2.start(t.signal)

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(1)
        await trigger.trigger(2)
        await trigger.trigger(3)
        await trigger.trigger(4)
        await trigger.trigger(5)
        await trigger.trigger(6)
        await trigger.trigger(7)
        await trigger.trigger(8)
        await trigger.trigger(9)

        // Then
        await tryUntilSuccess(async () => {
            assert.deepStrictEqual(results.toSorted(), [55, 60, 65, 70, 75, 80, 85, 90, 95])

            const [ poller1Count, poller2Count ] = countByPoller.values()
            assert.notEqual(poller1Count, 0)
            assert.notEqual(poller2Count, 0)
        }, 3_000)
    })

    await t.test("should be able to pick locked jobs if a worker did not handle it on time", async function (t) {
        // Given
        const dbName = randomUUID()
        const engine = MongoDBWorkflowEngine.create({
            client,
            dbName,
        })

        let poller1: Poller<number> | undefined
        let resultByWorker = new Map<string, number[]>()

        const workflow = Workflow.create<number>("workflow", w => {
            w.step("add-10", async ({ state, metadata: { pollerId } }) => {
                if (pollerId === "poller-1") {
                    poller1?.stop()
                    return failure(new Error("oops"))
                }

                return state + 10
            })
            w.step("multiply-by-5", ({state}) => state * 5)
            w.step("assign", ({ state, metadata: { pollerId } }) => {
                implace(resultByWorker, pollerId, v => [...v, state].toSorted(), [])
            })
        })

        poller1 = await engine.getPoller(workflow, {
            pollingIntervalMs: 100,
            pageSize: 1,
            replicated: true,
            pollerId: "poller-1",
            maxAttempts: 100,
            lockDurationMs: 500
        })
        const poller2 = await engine.getPoller(workflow, {
            pollingIntervalMs: 100,
            lockDurationMs: 500,
            pageSize: 1,
            replicated: true,
            maxAttempts: 100,
            pollerId: "poller-2"
        })

        poller1.start(t.signal)
        poller2.start(t.signal)

        const trigger = await engine.getTrigger(workflow)

        // When
        await trigger.trigger(1)
        await trigger.trigger(2)
        await trigger.trigger(3)
        await trigger.trigger(4)
        await trigger.trigger(5)
        await trigger.trigger(6)
        await trigger.trigger(7)
        await trigger.trigger(8)
        await trigger.trigger(9)

        // Then
        await waitAtLeastForSuccess(async () => {
            assert.deepEqual(Array.from(resultByWorker.entries()), [
                [
                    "poller-2",
                    [ 55, 60, 65, 70, 75, 80, 85, 90, 95 ],
                ]
            ])
        }, 10_000)
    })

    await t.test("mongodb workflow engine - multi tenancy", async function (t) {
        await t.test("should be able to support multiple tenant in the same collection", async function (t) {
            // Given
            const dbName = randomUUID()
            const engine = MongoDBWorkflowEngine.create({
                client,
                dbName,
            })

            let results: number[] = []

            const workflow = Workflow.create<number>("workflow", w => {
                w.step("add-10", async ({ state, metadata: { tenant } }) => {
                    if (tenant === "tenant-1") {
                        return state + 10
                    }

                    return state
                })
                w.step("multiply-by-20", ({ state, metadata: { tenant } }) => {
                    if (tenant === "tenant-1") {
                        return state * 20
                    }

                    return state
                })
                w.step("assign", ({ state }) => results.push(state))
            })

            const poller = await engine.getPoller(workflow, {
                pollingIntervalMs: 100,
                pageSize: 20,
            })

            const trigger = await engine.getTrigger(workflow)

            poller.start(t.signal)

            // When
            await trigger.trigger(5, "tenant-1")
            await trigger.trigger(15, "tenant-2")
            await trigger.trigger(10, "tenant-2")

            // Then
            await tryUntilSuccess(async () => {
                assert.deepStrictEqual(results.toSorted(), [ 10, 15, 300 ])
            }, 10_000)
        })
    })
})

function getState(client: MongoClient, db: string, workflow: string, step: string, collection: string = "workflows") {
    return new StepStateCollection(client.db(db).collection(collection)).findStepStates(workflow, step)
}

function collectErrors<T> (poller: Poller<T>) {
    let errors: unknown[] = []

    poller.on("error", e => errors.push(e))

    return () => errors
}

function dateAdd (date: Date, ms: number): Date {
    return new Date(date.getTime() + ms)
}

function implace<K, V> (map: Map<K, V>, key: K, fn: (v: V) => V, defaultValue: V): Map<K, V> {
    const value = map.get(key) ?? defaultValue
    const newValue = fn(value)
    map.set(key, newValue)
    return map
}