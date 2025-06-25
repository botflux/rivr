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

    const initialMessage = randomMessage()
    const initialError = await queue.produce([initialMessage])
      .then(() => undefined)
      .catch(e => e)

    // When
    await proxy.setEnabled(false)
    const messagesDuringOutage = [randomMessage(), randomMessage()]
    const outageError = await queue.produce(messagesDuringOutage)
      .then(() => undefined)
      .catch(e => e)

    await proxy.setEnabled(true)

    const recoveryMessages = [randomMessage(), randomMessage(), randomMessage()]
    const recoveryError = await queue.produce(recoveryMessages)
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

    const receivedMessages: Message[] = []
    const consumption = unstable.consume({
      onMessage: async (msg) => {
        receivedMessages.push(msg)
      }
    })

    t.after(async () => {
      await consumption.stop()
    })

    await consumption.start()

    const firstMessage = randomMessage()
    await stable.produce([firstMessage])

    await waitForPredicate(() => receivedMessages.length === 1, 5_000)

    // When
    await proxy.setEnabled(false)
    const secondMessage = randomMessage()
    await stable.produce([secondMessage])

    await proxy.setEnabled(true)

    // Then - should be able to receive messages after reconnection
    await waitForPredicate(() => receivedMessages.length === 2, 5_000)
    t.assert.strictEqual(receivedMessages.length, 2)
    t.assert.deepStrictEqual(receivedMessages, [ firstMessage, secondMessage ])
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