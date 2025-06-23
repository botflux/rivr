import {after, before, describe, test, TestContext} from "node:test"
import {RabbitMQContainer, StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
import {StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {Network, StartedNetwork} from "testcontainers";
import {createQueue} from "./rabbitmq";
import {randomUUID} from "node:crypto";
import {installUnhandledRejectionHook, Message} from "rivr";

installUnhandledRejectionHook()

describe('rabbitmq resilience test suite', function () {
  let network!: StartedNetwork
  let rabbitmq!: StartedRabbitMQContainer
  let toxiproxy!: StartedToxiProxyContainer

  before(async () => {
    network = await new Network().start()
    rabbitmq = await new RabbitMQContainer("rabbitmq:4.1")
      .withNetwork(network)
      .withNetworkAliases("rabbitmq")
      .start()

    toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
      .withNetwork(network)
      .start()
  })

  after(async () => {
    await toxiproxy?.stop()
    await rabbitmq?.stop()
    await network?.stop()
  })

  test("should be able to disconnect a already disconnected queue", async (t: TestContext) => {
    // Given
    // When
    const mError = await createQueue({ url: "" }).disconnect().catch(e => e)

    // Then
    t.assert.strictEqual(mError, undefined)
  })

  test("should be able to disconnect the queue even if the connection was lost", async (t: TestContext) => {
    // Given
    const proxy = await toxiproxy.createProxy({
      name: `rabbitmq-${randomUUID()}`,
      enabled: true,
      upstream: `rabbitmq:5672`
    })

    t.after(() => proxy.instance.remove())

    const queue = createQueue({
      url: `amqp://${proxy.host}:${proxy.port}?heartbeat=1`,
      queue: randomUUID(),
      exchange: randomUUID()
    })

    await queue.produce([
      randomMessage()
    ])

    // When
    await proxy.setEnabled(false)

    // Then
    const mError = await queue.disconnect().catch(e => e)
    t.assert.deepStrictEqual(mError, undefined)
  })
})

function randomMessage(): Message {
  return {
    type: "foo",
    payload: { msg: "hello world" },
    id: randomUUID(),
    createdAt: new Date()
  }
}