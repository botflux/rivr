import { test } from "node:test"
import { Client } from "pg"
import {PostgreSqlContainer, StartedPostgreSqlContainer} from "@testcontainers/postgresql";
import {randomUUID} from "node:crypto";
import {failure, skip, stop, success, Workflow} from "../workflow";
import {waitAtLeastForSuccess} from "../wait-at-least-for-success";
import assert from "node:assert";
import {PostgresWorkflowEngine} from "./engine";
import {tryUntilSuccess} from "../try-until-success";
import {linear} from "../retry";
import {StorageInterface} from "../poll/storage.interface";
import {PostgresStorage} from "./storage";

test("postgres workflow engine", async function (t) {
  let startedContainer!: StartedPostgreSqlContainer
  let client!: Client

  t.before(async function () {
    startedContainer = await new PostgreSqlContainer()
      .start()
  })

  t.after(async function () {
    await client?.end()
    await startedContainer?.stop()
  })

  t.beforeEach(async () => {
    const clientToCreateDb = new Client(startedContainer.getConnectionUri())
    await clientToCreateDb.connect()

    const [ database, error ] = await createDb(clientToCreateDb)
      .then(dbName => [ dbName, undefined ] as const)
      .catch(error => [ undefined, error ] as const)

    if (error) {
      await clientToCreateDb.end()
      throw error
    }

    await clientToCreateDb.end()

    client = new Client({
      connectionString: startedContainer.getConnectionUri(),
      database
    })
    await client.connect()
  })

  t.afterEach(async () => {
    await client?.end()
  })

  await t.test("should be able to execute a workflow", async function (t) {
    // Given
    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10
    })

    let result: number | undefined

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", ({state}) => state + 10)
      w.step("multiply-by-5", ({state}) => state * 5)
      w.step("assign", ({state}) => {
        result = state
      })
    })

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

    // When
    await trigger.trigger(5)

    // Then
    await waitAtLeastForSuccess(
      async () => {
        assert.strictEqual(result, 75)
      },
      5_000
    )
  })

  await t.test("should be able to retry a step", async function (t) {
    // Given
    let result: number | undefined = undefined

    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10
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

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

    // When
    await trigger.trigger(5)

    // Then
    await tryUntilSuccess(async () => {
      assert.equal(result, 5 + 5)
    }, 3_000)
  })

  await t.test("should be able to retry a step until the max retry is reached", async function (t) {
    // Given
    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10,
      maxAttempts: 10
    })
    let lastAttempt = -1

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("always_throw", ({state, metadata: { attempt } }) => {
        lastAttempt = attempt
        throw new Error("oops")
      })
    })

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

    // When
    await trigger.trigger(10)

    // Then
    await tryUntilSuccess(async () => {
      assert.equal(lastAttempt, 10)
    }, 3_000)
  })

  await t.test("should be able to return a state from each step to control the process flow", async function (t) {
    // Given
    let result: number | undefined

    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10
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

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

    // When
    await trigger.trigger(2)

    // Then
    await waitAtLeastForSuccess(async () => {
      assert.strictEqual(result, 14)
    }, 1_000)
  })

  await t.test("should be able to stop a process in the middle of it", async function (t) {
    // Given
    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10
    })

    let values: number[] = []
    let i = 0


    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", ({state}) => state + 10)
      w.step("assign", ({state}) => {
        values.push(state)
      })
      w.step("stopping", () => {
        i++
        if (i === 1)
          return stop()
      })
      w.step("multiple_by_2", ({state}) => state * 2)
      w.step("assign 2", ({state}) => {
        values.push(state)
      })
    })

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

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
    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10
    })
    let values: number[] = []
    let i = 0

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", ({ state }) => state + 10)
      w.step("add-20-or-skip", ({ state }) => {
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

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

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
    const engine = PostgresWorkflowEngine.create({
      client,
      pollingIntervalMs: 10,
      timeBetweenRetries: () => 3_000
    })

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", ({ state }) => state + 10)
      w.step("throw", () => {
        date = new Date()
        throw new Error("oops")
      })
    })

    const poller = await engine.getPoller(workflow)
    const trigger = engine.getTrigger(workflow)

    poller.start(t.signal)

    // When
    await trigger.trigger(10)

    // Then
    await waitAtLeastForSuccess(async () => {
      assert.deepStrictEqual(
        ((await getRows(client, workflow, "throw"))[0])?.min_date_before_next_attempt.getTime() >= dateAdd(date!, 3_000),
        true
      )
    }, 5_000)
  })
})

async function getRows<T> (client: Client, workflow: Workflow<T>, step: string): Promise<any[]> {
  const { rows } = await client.query('SELECT * FROM "public"."workflow_messages" ' +
    'WHERE workflow_name = $1 ' +
    'AND step_name = $2', [
      workflow.name,
      step
  ])

  return rows
}

export function dateAdd(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

async function createDb (client: Client) {
  const uuid = randomUUID().replaceAll("-", "")
  await client.query(`CREATE DATABASE "${uuid}"`)
  return uuid
}
