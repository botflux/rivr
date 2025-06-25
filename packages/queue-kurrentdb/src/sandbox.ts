import {createQueue} from "./kurrentdb";
import {Message} from "rivr";
import {randomUUID} from "node:crypto";

async function sandbox(): Promise<void> {
  const queue = createQueue({
    connectionString: 'esdb://localhost:2113?tls=false',
    streamInfix: randomUUID().replace("-", "").substring(0, 7)
  })

  await queue.produce([
    randomMessage()
  ])

  const consumption = queue.consume({
    onMessage: async msg => {
      console.log(msg)
    }
  })

  await consumption.start()

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