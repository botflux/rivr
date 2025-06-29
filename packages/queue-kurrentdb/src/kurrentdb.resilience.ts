import {after, before, describe, test, TestContext} from "node:test"
import {KurrentDbContainer, StartedKurrentDbContainer} from "@testcontainers/kurrentdb"
import {createQueue} from "./kurrentdb"
import {Message} from "rivr"
import {randomUUID} from "node:crypto"
import {setTimeout} from "node:timers/promises"
import {StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {Network, StartedNetwork} from "testcontainers";

describe('kurrentdb resilience', function () {
  let network!: StartedNetwork
  let kurrentdb!: StartedKurrentDbContainer
  let toxiproxy!: StartedToxiProxyContainer

  before(async () => {
    network = await new Network().start()
    kurrentdb = await new KurrentDbContainer("kurrentplatform/kurrentdb:25.0")
      .withNetwork(network)
      .withNetworkAliases("kurrentdb")
      .start()

    toxiproxy = await new ToxiProxyContainer("ghcr.io/shopify/toxiproxy:2.12.0")
      .withNetwork(network)
      .start()
  })

  after(async () => {
    await kurrentdb?.stop()
    await toxiproxy?.stop()
    await network?.stop()
  })

  test("should be able to produce after a connection lose", async (t: TestContext) => {
    // Given
    const proxy = await toxiproxy.createProxy({
      enabled: true,
      name: `kurrentdb-${randomUUID()}`,
      upstream: `kurrentdb:2113`
    })

    t.after(async () => {
      await proxy.instance.remove()
    })

    const queue = createQueue({
      connectionString: `kurrentdb://${proxy.host}:${proxy.port}?tls=false`,
      createSubscriptionOpts: {
        groupName: randomUUID(),
      },
      streamInfix: randomInfix()
    })

    t.after(async () => {
      await queue.disconnect()
    })

    const producer = queue.createProducer()

    t.after(async () => {
      await producer.disconnect()
    })

    const initialMessage = randomMessage()
    const initialError = await producer.produce([initialMessage])
      .then(() => undefined)
      .catch(e => e)

    // When
    await proxy.setEnabled(false)
    const messagesDuringOutage = [randomMessage(), randomMessage()]
    const outageError = await producer.produce(messagesDuringOutage)
      .then(() => undefined)
      .catch(e => e)

    await proxy.setEnabled(true)

    const recoveryMessages = [randomMessage(), randomMessage(), randomMessage()]
    const recoveryError = await producer.produce(recoveryMessages)
      .then(() => undefined)
      .catch(e => e)

    // Then
    t.assert.strictEqual(initialError, undefined)
    t.assert.notStrictEqual(outageError, undefined)
    t.assert.strictEqual(recoveryError, undefined)
  })

  test("should be able to reconnect into the persistent subscription in case of a kurrentdb failure", async (t: TestContext) => {
    // Given
    const proxy = await toxiproxy.createProxy({
      enabled: true,
      name: `kurrentdb-${randomUUID()}`,
      upstream: `kurrentdb:2113`
    })

    t.after(async () => {
      await proxy.instance.remove()
    })

    const groupName = randomUUID();
    const streamInfix = randomInfix();

    const unstable = createQueue({
      connectionString: `kurrentdb://${proxy.host}:${proxy.port}?tls=false`,
      createSubscriptionOpts: {
        groupName
      },
      streamInfix
    })

    t.after(async () => {
      await unstable.disconnect()
    })

    const stable = createQueue({
      connectionString: kurrentdb.getConnectionString(),
      createSubscriptionOpts: {
        groupName
      },
      streamInfix
    })

    t.after(async () => {
      await stable.disconnect()
    })

    const producer = stable.createProducer()

    t.after(async () => {
      await producer.disconnect()
    })

    const receivedMessages: Message[] = []
    const [consumer] = unstable.createConsumers({
      onMessage: async (msg) => {
        receivedMessages.push(msg)
      }
    })

    t.after(async () => {
      await consumer.stop()
    })

    await consumer.start()

    const firstMessage = randomMessage()
    await producer.produce([firstMessage])

    await waitForPredicate(() => receivedMessages.length === 1, 5_000)

    // When
    await proxy.setEnabled(false)
    const secondMessage = randomMessage()
    await producer.produce([secondMessage])

    await proxy.setEnabled(true)

    // Then
    await waitForPredicate(() => receivedMessages.length === 2, 5_000)
    t.assert.strictEqual(receivedMessages.length, 2)
    t.assert.deepStrictEqual(receivedMessages, [ firstMessage, secondMessage ])
  })

  test("should be able to trigger onError hook when connection is lost during consumption", async (t: TestContext) => {
    // Given
    const proxy = await toxiproxy.createProxy({
      enabled: true,
      name: `kurrentdb-${randomUUID()}`,
      upstream: `kurrentdb:2113`
    })

    t.after(async () => {
      await proxy.instance.remove()
    })

    const groupName = randomUUID();
    const streamInfix = randomInfix();

    const unstable = createQueue({
      connectionString: `kurrentdb://${proxy.host}:${proxy.port}?tls=false`,
      createSubscriptionOpts: {
        groupName
      },
      streamInfix
    })

    t.after(async () => {
      await unstable.disconnect()
    })

    const errorEvents: unknown[] = []
    const [consumer] = unstable.createConsumers({
      onMessage: async (msg) => {}
    })

    consumer.addHook("onError", (error) => {
      errorEvents.push(error)
    })

    t.after(async () => {
      await consumer.stop()
    })

    await consumer.start()

    // When
    await proxy.setEnabled(false)

    // Then
    await waitForPredicate(() => errorEvents.length > 0, 5_000)
    await proxy.setEnabled(true)

    // Then
    t.assert.ok(errorEvents.length > 0, "onError hook should have been triggered")
  })
})

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}

function randomInfix() {
  return randomUUID().replace("-", "").substring(0, 7)
}

function randomMessage(): Message {
  return {
    type: "test-message",
    id: randomUUID(),
    payload: { msg: "resilience test", timestamp: Date.now() },
    createdAt: new Date()
  }
}