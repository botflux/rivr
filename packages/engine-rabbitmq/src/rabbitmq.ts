import {Channel, ChannelModel, ConfirmChannel, connect, Replies} from "amqplib"
import {
  ConcreteTrigger,
  ConcreteWorker,
  ConsumeOpts,
  Consumption,
  DefaultTriggerOpts,
  Engine,
  Queue,
  Storage,
  Trigger,
  Worker,
  Write
} from "rivr"
import Consume = Replies.Consume;
import {channel} from "node:diagnostics_channel";
import {write} from "node:fs";

export interface CreateEngineOpts {
  url: string
  exchangeName?: string
  queueName?: string
  routingKey?: string
}

class RabbitMQConsumption implements Consumption {
  #channel: Channel
  #queueName: string
  #opts: ConsumeOpts

  #consume: Consume | undefined

  constructor(channel: Channel, queueName: string, opts: ConsumeOpts) {
    this.#channel = channel
    this.#queueName = queueName
    this.#opts = opts;

    this.#startConsuming()
  }

  async stop(): Promise<void> {
    if (this.#consume === undefined) {
      return
    }

    await this.#channel.cancel(this.#consume.consumerTag)
  }

  async #startConsuming() {
    try {
      this.#consume = await this.#channel.consume(
        this.#queueName,
        async msg => {
          try {
            if (msg === null)
              return

            const { content } = msg
            const string = content.toString("utf-8")
            const payload = JSON.parse(string)

            try {
              await this.#opts.onMessage(payload)
              this.#channel.ack(msg)
            } catch (error: unknown) {
              this.#channel.nack(msg, false, true)
            }
          } catch (error: unknown) {
            console.error("rabbitmq error", error)
          }
        }
      )
    } catch (error: unknown) {
      console.log("failed to consume the queue", error)
    }
  }
}

class RabbitMQQueue implements Queue<Record<never, never>> {
  #channel: ConfirmChannel | undefined
  #createChannel: () => Promise<ConfirmChannel>
  #queue: string
  #exchange: string
  #routingKey: string

  constructor(
    createChannel: () => Promise<ConfirmChannel>,
    queueName: string,
    exchange: string,
    routingQueue: string
  ) {
    this.#createChannel = createChannel;
    this.#queue = queueName;
    this.#exchange = exchange
    this.#routingKey = routingQueue
  }

  async consume(opts: ConsumeOpts): Promise<Consumption> {
    await this.#assertCreated()

    return new RabbitMQConsumption(
      await this.#getChannel(),
      this.#queue,
      opts
    )
  }

  async write<State>(writes: Write<State>[], opts?: Record<never, never> | undefined): Promise<void> {
    const notEndingWrites = writes
      .map(w => w.state)
      .filter(s => s.status === "in_progress")

    await this.#assertCreated()
    const channel = await this.#getChannel()

    for (const write of notEndingWrites) {
      channel.publish(
        this.#exchange,
        this.#routingKey,
        Buffer.from(JSON.stringify(write), "utf-8"),
        {
          persistent: true,
          contentType: "application/json",
        }
      )
    }

    await channel.waitForConfirms()
  }

  disconnect(): Promise<void> {
    return Promise.resolve(undefined);
  }

  async #getChannel(): Promise<ConfirmChannel> {
    if (this.#channel === undefined) {
      this.#channel = await this.#createChannel()
    }

    return this.#channel
  }

  async #assertCreated() {
    const channel = await this.#getChannel()

    await channel.assertExchange(this.#exchange, "direct", {
      durable: true,
    })

    await channel.assertQueue(this.#queue, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum"
      }
    })

    await channel.bindQueue(this.#queue, this.#exchange, this.#routingKey)
  }
}

class RabbitMQEngine implements Engine<DefaultTriggerOpts> {
  #opts: CreateEngineOpts
  #connection: ChannelModel | undefined
  #channels: ConfirmChannel[] = []
  #workers: Worker[] = []

  constructor(opts: CreateEngineOpts) {
    this.#opts = opts;
  }

  createWorker(): Worker {
    const queue = this.#createQueue()
    const w = new ConcreteWorker(queue)

    this.#workers.push(w)

    return w
  }

  createTrigger(): Trigger<DefaultTriggerOpts> {
    const queue = this.#createQueue()
    return new ConcreteTrigger(queue)
  }

  createStorage(): Storage<DefaultTriggerOpts> {
    throw new Error("Method not implemented.")
  }

  async close(): Promise<void> {
    for (const worker of this.#workers) {
      await worker.stop()
    }

    for (const channel of this.#channels) {
      await channel.close()
    }

    await this.#connection?.close()
  }

  #createQueue() {
    const {
      queueName = "rivr-states",
      exchangeName = "rivr-exchange",
      routingKey = "rivr-routing",
    } = this.#opts

    return new RabbitMQQueue(
      this.#createChannel.bind(this),
      queueName,
      exchangeName,
      routingKey,
    )
  }

  async #createConnection() {
    if (this.#connection !== undefined)
      return this.#connection

    const connection = await connect(this.#opts.url)
    this.#connection = connection
    return connection
  }

  async #createChannel(): Promise<ConfirmChannel> {
    const connection = await this.#createConnection()
    const channel = await connection.createConfirmChannel()

    this.#channels.push(channel)
    return channel
  }
}

export function createEngine (opts: CreateEngineOpts) {
  return new RabbitMQEngine(opts)
}