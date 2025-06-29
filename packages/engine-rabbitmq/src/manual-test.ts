import {createQueue} from "./rabbitmq";
import {randomUUID} from "node:crypto";
import {RabbitMQContainer} from "@testcontainers/rabbitmq";
import {Network} from "testcontainers";
import {ToxiProxyContainer} from "@testcontainers/toxiproxy";
import { setTimeout } from "node:timers/promises"

export async function manualTest() {
  const network = await new Network().start()

  const rabbitmq = await new RabbitMQContainer("rabbitmq:4.1.0-management")
    .withNetwork(network)
    .withNetworkAliases("rabbitmq")
    .start();

  const toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
    .withNetwork(network)
    .start();

  const proxy = await toxiproxy.createProxy({
    enabled: true,
    name: "rabbitmq",
    upstream: "rabbitmq:5672"
  })

  const queue = createQueue({
    url: `amqp://${proxy.host}:${proxy.port}`,
    queue: randomUUID(),
    exchange: randomUUID()
  })

  const consumption = queue.createConsumers({
    onMessage: async (msg) => console.log(msg),
  })

  try {
    await consumption.start()
    await setTimeout(1000)

    await proxy.setEnabled(false)
    await setTimeout(5_000)
    await proxy.setEnabled(true)

    const producer = queue.createProducer()

    await producer.produce([
      {
        type: "hello",
        id: randomUUID(),
        payload: { msg: "hello world" },
        createdAt: new Date()
      }
    ])
  } finally {
    await consumption.stop()
    await queue.disconnect()
    await proxy.instance.remove()
    await toxiproxy.stop()
    await rabbitmq.stop()
    await network.stop()
  }
}

manualTest().catch(console.error)