import {RabbitMQContainer} from "@testcontainers/rabbitmq";
import {ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {Network} from "testcontainers";
import {createQueue} from "./rabbitmq";
import {randomUUID} from "node:crypto";

async function start () {
  const network = await new Network().start();

  const rabbitmq = await new RabbitMQContainer("rabbitmq:4.1")
    .withNetwork(network)
    .withNetworkAliases("rabbitmq")
    .start()

  const toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
    .withNetwork(network)
    .start()

  const proxy = await toxiproxy.createProxy({
    name: "rabbitmq",
    enabled: true,
    upstream: `rabbitmq:5672`
  })

  const queue = createQueue({
    url: `amqp://guest:guest@${proxy.host}:${proxy.port}`,
  })

  await queue.produce([
    {
      type: "foo",
      createdAt: new Date(),
      id: randomUUID(),
      payload: { foo: "bar" }
    }
  ])

  await proxy.setEnabled(false)

  await queue.produce([
    {
      type: "foo",
      createdAt: new Date(),
      id: randomUUID(),
      payload: { foo: "bar" }
    }
  ])

  await queue.disconnect()
  await toxiproxy.stop()
  await rabbitmq.stop()
  await network.stop()
}

start().catch(console.error)