import {ConsumeOpts, Consumption, ConsumptionHooks, Message, Producer, Queue, StopReason} from "rivr";
import {Channel, ChannelModel, ConfirmChannel} from "amqplib";
import {AmqpConnectionManager, AmqpConnectionManagerOptions, ChannelWrapper, connect} from "amqp-connection-manager";
import {Hooks} from "rivr/dist/hooks/hooks";

class RabbitMQConsumption implements Consumption {
  #channelWrapper: ChannelWrapper
  #opts: RabbitMQQueueOpts
  #consumeOpts: ConsumeOpts
  #hooks = new Hooks<ConsumptionHooks>()

  constructor(channelManager: AmqpConnectionManager, opts: RabbitMQQueueOpts, consumeOpts: ConsumeOpts) {
    this.#opts = opts;
    this.#consumeOpts = consumeOpts;
    this.#channelWrapper = channelManager.createChannel({
      name: "consuming",
      setup: async (channel: ConfirmChannel) => {
        await ensureQueuesExists(channel, opts)
      }
    })
  }

  addHook(hook: "onError", handler: (error: unknown) => void): this
  addHook(hook: "onStart", handler: () => void): this
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this
  addHook(hook: string, handler: (...params: any[]) => void): this {
    this.#hooks.addHook(hook as keyof ConsumptionHooks, handler)
    return this
  }

  async start(): Promise<void> {
    this.#startConsuming()
  }

  async #startConsuming() {
    await this.#channelWrapper.consume(
      this.#opts.queue,
      async msg => {
        if (msg === null) {
          console.warn("message is null")
          return
        }

        try {
          const { content, properties } = msg
          const stringified = content.toString("utf8")
          const payload = JSON.parse(stringified)

          const { type, messageId, headers: { createdAt, pickAfter, "x-delay": xDelay } = {} } = properties

          const message: Message = {
            payload,
            createdAt: new Date(createdAt),
            id: messageId,
            type,
            ...pickAfter !== undefined && {
              pickAfter: new Date(pickAfter),
            }
          }

          await this.#consumeOpts.onMessage(message)
          this.#channelWrapper.ack(msg, false)
        } catch(error: unknown) {
          this.#channelWrapper.nack(msg, false, true)
        }
      }
    )
  }

  async stop(): Promise<void> {
    await this.#channelWrapper.close()
  }
}

type RabbitMQQueueOpts = {
  url: string
  connectionManagerOpts?: AmqpConnectionManagerOptions
  exchange: string
  delayedExchange: string
  queue: string
  enableDelayedMessageExchange: boolean
}

class RabbitMQProducer implements Producer<never> {
  #connection: AmqpConnectionManager
  #opts: RabbitMQQueueOpts
  #channel: ChannelWrapper | undefined

  constructor(connection: AmqpConnectionManager, opts: RabbitMQQueueOpts) {
    this.#connection = connection;
    this.#opts = opts;
  }

  async produce(messages: Message[], opts?: undefined): Promise<void> {
    const channel = this.#getChannel()

    for (const message of messages) {
      if (message.pickAfter === undefined) {
        await this.#publishMessage(channel, this.#opts.exchange, message)
      } else {
        if (!this.#opts.enableDelayedMessageExchange) {
          throw new Error("Cannot publish a delayed message in the RabbitMQ queue without `enabledDelayedMessageExchange` set to `true`.")
        }

        await this.#publishMessage(channel, this.#opts.delayedExchange, message)
      }
    }
  }

  supportsDelayedMessages(): boolean {
    return this.#opts.enableDelayedMessageExchange
  }

  async disconnect(): Promise<void> {
    await this.#channel?.close()
  }

  #getChannel(): ChannelWrapper {
    if (this.#channel === undefined) {
      this.#channel = this.#connection.createChannel({
        setup: async (ch: ConfirmChannel) => {
          await ensureQueuesExists(ch, this.#opts)
        }
      })
    }

    return this.#channel
  }

  async #publishMessage(channel: ChannelWrapper, exchange: string, message: Message): Promise<void> {
    await channel.publish(
      exchange,
      "",
      Buffer.from(JSON.stringify(message.payload)),
      {
        messageId: message.id,
        type: message.type,
        contentType: "application/json",
        persistent: true,
        headers: {
          createdAt: message.createdAt.toISOString(),
          ...message.pickAfter !== undefined && {
            "x-delay": this.#calculateDelay(message.pickAfter),
            pickAfter: message.pickAfter.toISOString()
          },
        }
      }
    )
  }

  #calculateDelay(pickAfter: Date, now: Date = new Date()): number {
    return pickAfter.getTime() - now.getTime();
  }

}

class RabbitMQQueue implements Queue<never> {
  #opts: RabbitMQQueueOpts
  #channelManager: AmqpConnectionManager

  constructor(opts: RabbitMQQueueOpts) {
    this.#opts = opts;
    this.#channelManager = connect(opts.url, opts.connectionManagerOpts)
  }

  createProducer(): Producer<never> {
    return new RabbitMQProducer(this.#channelManager, this.#opts)
  }

  async produce(messages: Message[], opts?: undefined): Promise<void> {
    const channel = this.#channelManager.createChannel({
      setup: async (ch: ConfirmChannel) => {
        await ensureQueuesExists(ch, this.#opts)
      }
    })


    for (const message of messages) {
      if (message.pickAfter === undefined) {
        await this.#publishMessage(channel, this.#opts.exchange, message)
      } else {
        if (!this.#opts.enableDelayedMessageExchange) {
          throw new Error("Cannot publish a delayed message in the RabbitMQ queue without `enabledDelayedMessageExchange` set to `true`.")
        }

        await this.#publishMessage(channel, this.#opts.delayedExchange, message)
      }
    }
  }

  supportsDelayedMessages(): boolean {
    return this.#opts.enableDelayedMessageExchange
  }

  async disconnect(): Promise<void> {
    try {
      await this.#channelManager.close()
    } catch (e: unknown) {
      if (!isUnexpectedCloseError(e)) {
        throw e
      }
    }
  }

  consume(opts: ConsumeOpts): Consumption {
    return new RabbitMQConsumption(
      this.#channelManager,
      this.#opts,
      opts
    )
  }

  async #publishMessage(channel: ChannelWrapper, exchange: string, message: Message): Promise<void> {
    await channel.publish(
      exchange,
      "",
      Buffer.from(JSON.stringify(message.payload)),
      {
        messageId: message.id,
        type: message.type,
        contentType: "application/json",
        persistent: true,
        headers: {
          createdAt: message.createdAt.toISOString(),
          ...message.pickAfter !== undefined && {
            "x-delay": this.#calculateDelay(message.pickAfter),
            pickAfter: message.pickAfter.toISOString()
          },
        }
      }
    )
  }

  #calculateDelay(pickAfter: Date, now: Date = new Date()): number {
    return pickAfter.getTime() - now.getTime();
  }
}

async function ensureQueuesExists(channel: Channel, opts: RabbitMQQueueOpts) {
  await channel.assertQueue(opts.queue, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum"
    }
  })

  await channel.assertExchange(opts.exchange, "direct", { durable: true })
  await channel.bindQueue(opts.queue, opts.exchange, "")

  if (opts.enableDelayedMessageExchange) {
    await channel.assertExchange(opts.delayedExchange, "x-delayed-message", {
      durable: true,
      arguments: {
        "x-delayed-type": "direct"
      }
    })
    await channel.bindQueue(opts.queue, opts.delayedExchange, "")
  }
}

export type CreateRabbitMQQueueOpts = {
  /**
   * The URL to connect to RabbitMQ.
   */
  url: string

  /**
   * The option passed as second argument of `require("amqp-connection-manager").connect`.
   */
  connectionManagerOpts?: AmqpConnectionManagerOptions

  /**
   * The exchange used for publishing non-delayed messages.
   *
   * @default {'rivr-exchange'}
   */
  exchange?: string

  /**
   * The exchange used for publishing delayed messages.
   *
   * Please note that the `enableDelayedMessageExchange` flag must be enabled
   * in order to publish delayed messages.
   *
   * @default {'rivr-delayed-exchange'}
   */
  delayedExchange?: string

  /**
   * The queue bound to the `exchange` and `delayedExchange`.
   *
   * @default {'rivr-queue'}
   */
  queue?: string

  /**
   * True to enable delayed message publishing.
   * Your RabbitMQ instance must have the [delayed message plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange) enabled.
   *
   * As of june 2025, the plugin is not recommended for production use,
   * and the README states that the delayed messages are stored in an un-replicated mnesia table.
   *
   * When false, you'll need another queue implementation to store the delayed exchange.
   * Rivr supports consuming from multiple `Queue` implementation out of the box.
   *
   * @default {false}
   */
  enableDelayedMessageExchange?: boolean
}

export function createQueue(opts: CreateRabbitMQQueueOpts): Queue<never> {
  const {
    delayedExchange = "rivr-delayed-exchange",
    exchange = "rivr-exchange",
    queue = "rivr-messages",
    enableDelayedMessageExchange = false,
    ...rest
  } = opts

  return new RabbitMQQueue({
    ...rest,
    delayedExchange,
    exchange,
    queue,
    enableDelayedMessageExchange,
  })
}

function isError(error: unknown): error is Error {
  return typeof error === "object" && error !== null
    && "message" in error && typeof error.message === "string"
}

function isUnexpectedCloseError(error: unknown): boolean {
  if (!isError(error)) {
    return false
  }

  const possibilities = [
    "Unexpected close",
    "Channel closed",
    "Channel ended",
    "Socket closed abruptly",
    /Connection closed/
  ]

  return possibilities.some(element => (error.message as string).match(element))
}