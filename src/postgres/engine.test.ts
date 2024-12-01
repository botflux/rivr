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
    const engine = PostgresWorkflowEngine.create()

    let result: number | undefined

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", s => s + 10)
      w.step("multiply-by-5", s => s * 5)
      w.step("assign", s => {
        result = s
      })
    })

    const poller = await engine.getPoller({
      workflow,
      client,
      pollingIntervalMs: 10,
    })

    const trigger = await engine.getTrigger({
      client,
      workflow,
    })

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

    const engine = PostgresWorkflowEngine.create()

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

    const poller = await engine.getPoller({
      workflow,
      client,
      pollingIntervalMs: 10,
    })

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

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
    const engine = PostgresWorkflowEngine.create()
    let lastAttempt = -1

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("always_throw", (s, { attempt }) => {
        lastAttempt = attempt
        throw new Error("oops")
      })
    })

    const poller = await engine.getPoller({
      workflow,
      client,
      pollingIntervalMs: 10,
      maxAttempts: 10
    })

    poller.start(t.signal)

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

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

    const engine = PostgresWorkflowEngine.create()

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-5", s => success(s + 5))
      w.step("multiply-by-attempt", (s, { attempt }) => attempt === 1
        ? failure(new Error("oops"), { retry: linear(1_000) })
        : success(s * attempt))
      w.step("assign", s => {
        result = s
      })
    })

    const poller = await engine.getPoller({
      workflow,
      pollingIntervalMs: 100,
      maxAttempts: 10,
      client,
      pageSize: 10
    })

    poller.start(t.signal)

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

    // When
    await trigger.trigger(2)

    // Then
    await waitAtLeastForSuccess(async () => {
      assert.strictEqual(result, 14)
    }, 1_000)
  })

  await t.test("should be able to stop a process in the middle of it", async function (t) {
    // Given
    const engine = PostgresWorkflowEngine.create()

    let values: number[] = []
    let i = 0


    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", s => s + 10)
      w.step("assign", s => {
        values.push(s)
      })
      w.step("stopping", () => {
        i++
        if (i === 1)
          return stop()
      })
      w.step("multiple_by_2", s => s * 2)
      w.step("assign 2", s => {
        values.push(s)
      })
    })

    const poller = await engine.getPoller({
      workflow,
      client,
      pollingIntervalMs: 10
    })

    poller.start(t.signal)

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

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
    const engine = PostgresWorkflowEngine.create()
    let values: number[] = []
    let i = 0

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

    const poller = await engine.getPoller({
      workflow,
      client,
      pollingIntervalMs: 10,
    })

    poller.start(t.signal)

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

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
    const engine = PostgresWorkflowEngine.create()

    const workflow = Workflow.create<number>("workflow", w => {
      w.step("add-10", s => s + 10)
      w.step("throw", () => {
        date = new Date()
        throw new Error("oops")
      })
    })

    const poller = await engine.getPoller({
      workflow,
      client,
      pollingIntervalMs: 10,
      maxAttempts: 2,
      timeBetweenRetries: attempt => 3_000
    })

    poller.start(t.signal)

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

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
