import {Client} from "pg";
import {createTables} from "../src/postgres/create-tables";
import {PostgresWorkflowEngine} from "../src/postgres/engine";
import {Workflow} from "../src/workflow";
import closeWithGrace from "close-with-grace";

async function test() {
  const abort = new AbortController()

  const clientToCreateDB = new Client({
    connectionString: "postgres://postgres:example@localhost:5433",
  })

  await clientToCreateDB.connect()

  const [, error] = await inlineCatch(clientToCreateDB.query("CREATE DATABASE mydb"))

  if (error && !error.message.match(/database ".*" already exists/)) {
    console.log(error)
    await clientToCreateDB.end()
    return
  }

  await clientToCreateDB.end()

  const client = new Client({
    connectionString: "postgres://postgres:example@localhost:5433/mydb",
  })

  await client.connect()

  // closeWithGrace(async () => {
  //   abort.abort()
  //   await client.end()
  //   console.log("closing the script")
  // })

  await createTables(client)

  const workflow = Workflow.create<number>("w", w => {
    w.step("add-5", s => s + 5)
    w.step("log", s => {
      console.log("s", s)
      return s
    })
  })

  const engine = PostgresWorkflowEngine.create()
  const trigger = await engine.getTrigger({
    workflow,
    client
  })

  await trigger.trigger(5)

  console.log("before start")
  engine.getPoller({
    client,
    pollingIntervalMs: 1000,
    signal: abort.signal,
    workflow
  }).catch(error => console.log("Error", error))

  console.log("after start")
}

function inlineCatch<T> (promise: Promise<T>): Promise<readonly [T | undefined, Error | undefined]> {
  return promise
    .then(data => [ data, undefined ] as const)
    .catch(error => [ undefined, error ] as const)
}

test().catch(console.error)