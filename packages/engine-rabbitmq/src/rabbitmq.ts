import {ConsumeOpts, Consumption, Message, Queue} from "rivr";
import {SocketOptions} from "node:dgram";
import {Channel, ChannelModel, ConfirmChannel, connect} from "amqplib";

class RabbitMQConsumption implements Consumption {
  #getConnection: () => Promise<ChannelModel>
  #opts: RabbitMQQueueOpts
  #consumeOpts: ConsumeOpts

  #consumingChannel: ConfirmChannel | undefined
  #consumerTag: string | undefined

  constructor(getConnection: () => Promise<ChannelModel>, opts: RabbitMQQueueOpts, consumeOpts: ConsumeOpts) {
    this.#getConnection = getConnection;
    this.#opts = opts;
    this.#consumeOpts = consumeOpts;
  }

  async start(): Promise<void> {
    const consumingChannel = await this.#getConsumingChannel()
    await ensureQueuesExists(consumingChannel, this.#opts)

    this.#startConsuming(consumingChannel)
  }

  async #startConsuming(consumingChannel: ConfirmChannel) {
    try {
      const { consumerTag } = await consumingChannel.consume(
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
            consumingChannel.ack(msg, false)
          } catch(error: unknown) {
            consumingChannel.nack(msg, false, true)
          }
        },
      )

      this.#consumerTag = consumerTag
    } catch (error: unknown) {
      console.warn("error while consuming a rabbitmq queue", error)
    }
  }

  async stop(): Promise<void> {
    if (this.#consumerTag) {
      await this.#consumingChannel?.cancel(this.#consumerTag)
    }

    await this.#consumingChannel?.close()
  }

  async #getConsumingChannel(): Promise<ConfirmChannel> {
    if (this.#consumingChannel === undefined) {
      this.#consumingChannel = await (await this.#getConnection()).createConfirmChannel()
    }

    return this.#consumingChannel
  }
}

type RabbitMQQueueOpts = {
  url: string
  socketOpts?: SocketOptions
  exchange: string
  delayedExchange: string
  queue: string
}

class RabbitMQQueue implements Queue<never> {
  #opts: RabbitMQQueueOpts
  #connection: ChannelModel | undefined
  #publishChannel: ConfirmChannel | undefined

  constructor(opts: RabbitMQQueueOpts) {
    this.#opts = opts;
  }

  async produce(messages: Message[], opts?: undefined): Promise<void> {
    const channel = await this.#getPublishChannel()
    await ensureQueuesExists(channel, this.#opts)

    for (const message of messages) {
      if (message.pickAfter === undefined) {
        this.#publishMessage(channel, this.#opts.exchange, message)
      } else {
        this.#publishMessage(channel, this.#opts.delayedExchange, message)
      }
    }

    await channel.waitForConfirms()
  }

  async disconnect(): Promise<void> {
    await this.#publishChannel?.close()
    await this.#connection?.close()
  }

  consume(opts: ConsumeOpts): Consumption {
    return new RabbitMQConsumption(
      () => this.#getConnection(),
      this.#opts,
      opts
    )
  }

  async #getConnection(): Promise<ChannelModel> {
    if (this.#connection === undefined) {
      this.#connection = await connect(this.#opts.url, this.#opts.socketOpts)
    }

    return this.#connection
  }

  async #getPublishChannel(): Promise<ConfirmChannel> {
    if (this.#publishChannel === undefined) {
      this.#publishChannel = await (await this.#getConnection()).createConfirmChannel()
    }

    return this.#publishChannel
  }

  #publishMessage(channel: Channel, exchange: string, message: Message): void {
    channel.publish(
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
  await channel.assertExchange(opts.delayedExchange, "x-delayed-message", {
    durable: true,
    arguments: {
      "x-delayed-type": "direct"
    }
  })

  await channel.bindQueue(opts.queue, opts.exchange, "")
  await channel.bindQueue(opts.queue, opts.delayedExchange, "")
}

export type CreateRabbitMQQueueOpts = {
  url: string
  socketOpts?: SocketOptions
  exchange?: string
  delayedExchange?: string
  queue?: string
}

export function createQueue(opts: CreateRabbitMQQueueOpts): Queue<never> {
  const {
    delayedExchange = "rivr-delayed-exchange",
    exchange = "rivr-exchange",
    queue = "rivr-messages",
    socketOpts,
    ...rest
  } = opts

  return new RabbitMQQueue({
    ...rest,
    delayedExchange,
    exchange,
    queue,
    socketOpts
  })
}