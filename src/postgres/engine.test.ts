import { test } from "node:test"
import { Client } from "pg"
import {PostgreSqlContainer, StartedPostgreSqlContainer} from "@testcontainers/postgresql";
import {randomUUID} from "node:crypto";
import {Workflow} from "../workflow";
import {waitAtLeastForSuccess} from "../wait-at-least-for-success";
import assert from "node:assert";
import {PostgresWorkflowEngine} from "./engine";
import {tryUntilSuccess} from "../try-until-success";

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

    engine.start({
      workflow,
      client,
      pollingIntervalMs: 10,
      signal: t.signal,
    }).catch(error => console.log("Error", error))

    const trigger = await engine.getTrigger({
      client,
      workflow,
    })

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

    engine.start({
      workflow,
      client,
      signal: t.signal,
      pollingIntervalMs: 10,
    }).catch(error => console.log("Error", error))

    const trigger = await engine.getTrigger({
      client,
      workflow
    })

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

    engine.start({
      workflow,
      client,
      pollingIntervalMs: 10,
      signal: t.signal,
      maxAttempts: 10
    }).catch(error => console.log("Error", error))

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
})

async function createDb (client: Client) {
  const uuid = randomUUID().replaceAll("-", "")
  await client.query(`CREATE DATABASE "${uuid}"`)
  return uuid
}
