import {createClient} from "redis";
import {setTimeout} from "node:timers/promises"
import {createEngine} from "./redis";
import {rivr} from "rivr";


async function start () {
  const engine = createEngine({
    redis: { url: "redis://localhost:6379" },
  })

  const worker = engine.createWorker()
  const trigger = engine.createTrigger()

  const w = rivr.workflow<number>("calc")
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .addHook("onWorkflowCompleted", (w, s) => {
      console.log("state", s)
    })

  console.log("starting")
  await worker.start([ w ])

  console.log("triggering")
  await trigger.trigger(w, 9)
  await trigger.trigger(w, 10)
  await trigger.trigger(w, 11)
  await trigger.trigger(w, 12)
  await trigger.trigger(w, 13)
  await trigger.trigger(w, 14)

  // const client = createClient({
  //   url: "redis://localhost:6379",
  // })
  //
  // await client.connect()
  //
  // console.log("waiting")
  // consumer(client)
  // await producer(client, "hello 1")
  // await producer(client, "hello 2")
  // await producer(client, "hello 3")
  // await producer(client, "hello 4")
  // // console.log("waiting 5s...")
  // // await setTimeout(5_000)
  // // console.log("finish waiting")
  //
  //
  // await producer(client, "hello 5")
  // await producer(client, "hello 6")

}

async function producer (client: ReturnType<typeof createClient>, message: string) {
  await client.lPush("foo", message)
}

async function consumer (client: ReturnType<typeof createClient>) {
  try {
    while (true) {
      const value = await client.brPop("foo", 1)

      if (value) {
        console.log("new message", value)
      } else {
        console.log("no new message")
      }
    }
  } catch (error) {
    console.error("error while consuming", error)
  }
}

start().catch(console.error)