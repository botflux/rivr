import {consumeCustomSubscription, createQueue} from "./kurrentdb";
import {createWorker, Message, rivr, trigger} from "rivr";
import {randomUUID} from "node:crypto";
import {jsonEvent, JSONEventType, KurrentDBClient, RecordedEvent} from "@kurrent/kurrentdb-client";

async function sandbox(): Promise<void> {
  type MyEvent = JSONEventType<"record_created", { value: number }>
  const infix = randomUUID().replace("-", "").substring(0, 5)

  const queue = createQueue({
    connectionString: "esdb://localhost:2113?tls=false",
    streamInfix: infix,
  })

  const workflow = rivr.workflow<number>("calc")
    .step({
      name: "add-1",
      handler: async ({ state }) => {
        console.log("received state", state)
        return state + 1
      }
    })

  const worker = createWorker({
    primary: queue,
    workflows: [ workflow ]
  })

  await worker.start()
  worker.addHook("error", console.error)

  const producer = queue.createProducer()

  const consumption = consumeCustomSubscription<MyEvent>({
    connectionString: "esdb://localhost:2113?tls=false",
    streamName: `$ce-Record${infix}`,
    groupName: randomUUID(),
    handler: async (event) => {
      console.log(event)
      await trigger(
        producer,
        workflow,
        2
      )
    }
  })

  await consumption.start()

  await KurrentDBClient
    .connectionString("esdb://localhost:2113?tls=false")
    .appendToStream(`Record${infix}-${randomUUID()}`, [ jsonEvent<MyEvent>({ type: "record_created", data: { value: 2 } }) ])


  // const queue = createQueue({
  //   connectionString: 'esdb://localhost:2113?tls=false',
  //   streamInfix: randomUUID().replace("-", "").substring(0, 7)
  // })
  //
  // await queue.produce([
  //   randomMessage()
  // ])
  //
  // const consumption = queue.consume({
  //   onMessage: async msg => {
  //     console.log(msg)
  //   }
  // })
  //
  // await consumption.start()

  // await queue.disconnect()
}

function randomMessage(): Message {
  return {
    createdAt: new Date(),
    payload: { msg: "hello world" },
    type: "hello",
    id: randomUUID()
  }
}

sandbox().catch(console.error)