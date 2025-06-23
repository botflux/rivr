import {after, before, describe, test, TestContext} from "node:test"
import {RabbitMQContainer, StartedRabbitMQContainer} from "@testcontainers/rabbitmq";
import {StartedToxiProxyContainer, ToxiProxyContainer} from "@testcontainers/toxiproxy";
import {Network, StartedNetwork} from "testcontainers";
import {createQueue} from "./rabbitmq";
import {randomUUID} from "node:crypto";
import {installUnhandledRejectionHook, Message} from "rivr";
import {ChannelModel, connect} from "amqplib";
import {createConnection} from "node:net";

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

  describe('produce', function () {
    test("should be able to fail fast", async (t: TestContext) => {
      // Given
      const proxy = await toxiproxy.createProxy({
        name: `rabbitmq-${randomUUID()}`,
        enabled: true,
        upstream: "rabbitmq:5672"
      })

      t.after(() => proxy.instance.remove())

      const queue = createQueue({
        url: `amqp://${proxy.host}:${proxy.port}`,
      })

      // produce a message to warmup the queue.
      await queue.produce([ randomMessage(), ])

      // When
      await proxy.setEnabled(false)

      // Then
      const mError = await queue.produce([ randomMessage() ]).catch(e => e)
      t.assert.match((mError as Error).message, /closed/, `${(mError as Error)?.message} does not match '/closed/'`)
    })
  })

  describe('connection wrapper', function () {
    class ConnectionWrapper {
      #createConnection: () => Promise<ChannelModel>
      #connection: ChannelModel | undefined
      #closed = true

      constructor(createConnection: () => Promise<ChannelModel>) {
        this.#createConnection = createConnection;
      }

      async getConnection(): Promise<ChannelModel> {
        if (this.#connection === undefined) {
          this.#connection = await this.#createConnection()
          this.#connection.on("error", () => {})
          this.#connection.on("close", () => {
            this.#closed = true
          })
          this.#closed = false
        }

        if (this.#closed) {
          this.#connection = undefined
          return await this.getConnection()
        }

        return this.#connection
      }

      async disconnect(): Promise<void> {
        try {
          await this.#connection?.close()
        } catch (e: unknown) {
          if (!this.#isUnexpectedCloseError(e)) {
            throw e
          }
        }
        this.#connection = undefined
      }

      #isUnexpectedCloseError(error: unknown): boolean {
        if (!this.#isError(error)) {
          return false
        }

        const possibilities = [
          "Unexpected close",
          "Channel closed",
          /Connection closed/
        ]

        return possibilities.some(element => (error.message as string).match(element))
      }

      #isError(error: unknown): error is Error {
        return typeof error === "object" && error !== null
          && "message" in error && typeof error.message === "string"
      }
    }

    test("should be able to reconnect", async (t: TestContext) => {
      // Given
      const proxy = await toxiproxy.createProxy({
        name: `rabbitmq-${randomUUID()}`,
        enabled: true,
        upstream: "rabbitmq:5672"
      })

      t.after(() => proxy.instance.remove())

      const wrapper = new ConnectionWrapper(() => connect(`amqp://${proxy.host}:${proxy.port}`))

      t.after(async () => {
        await wrapper.disconnect()
      })

      const conn1 = await wrapper.getConnection()
      const ch1 = await conn1.createConfirmChannel()

      await ch1.assertQueue("foo")

      // When
      await proxy.setEnabled(false)
      const mError1 = await ch1.assertQueue("foo")
        .then(() => {})
        .catch(e => e)

      await proxy.setEnabled(true)

      const conn2 = await wrapper.getConnection()
      const ch2 = await conn2.createConfirmChannel()

      // Then
      const mError2 = await ch2.assertQueue("foo")
        .then(() => {})
        .catch(e => e)
      t.assert.strictEqual(mError2, undefined)
      t.assert.match((mError1 as Error)?.message, /Channel closed/)
    })
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