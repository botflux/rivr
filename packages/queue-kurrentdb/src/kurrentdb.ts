import {ConsumeOpts, Consumption, Message, Queue} from "rivr";
import {
  JSONEventType,
  KurrentDBClient, PersistentSubscriptionExistsError,
  PersistentSubscriptionToStream,
  PersistentSubscriptionToStreamSettings
} from "@kurrent/kurrentdb-client"
import {JSONEventData} from "@kurrent/kurrentdb-client/dist/types/events";

type KurrentDBQueueOpts = {
  connectionString: string
  createPersistentSubscriptionOpts: CreatePersistentSubscriptionOpts
  streamNameFromMessage: (msg: Message) => string
}

const eventType = "rivr-message" as const

type KurrentEventType = JSONEventType<typeof eventType, Record<never, never>, Record<string, never>>

class PersistentSubscriptionConsumption implements Consumption {
  #getClient: () => KurrentDBClient
  #opts: KurrentDBQueueOpts
  #consumeOpts: ConsumeOpts
  #subscription?: PersistentSubscriptionToStream<JSONEventData<KurrentEventType>>

  constructor(getClient: () => KurrentDBClient, opts: KurrentDBQueueOpts, consumeOpts: ConsumeOpts) {
    this.#getClient = getClient;
    this.#opts = opts;
    this.#consumeOpts = consumeOpts;
  }

  async start(): Promise<void> {
    if (this.#subscription !== undefined) {
      return
    }

    await this.#ensurePersistentSubscriptionCreated()
    this.#startConsuming()
  }

  async stop(): Promise<void> {
    await this.#subscription?.unsubscribe()
  }

  async #ensurePersistentSubscriptionCreated() {
    const client = this.#getClient()
    const {
      createPersistentSubscriptionOpts: {
        groupName = "rivr-messages",
        ...rest
      }
    } = this.#opts

    try {
      await client.createPersistentSubscriptionToStream(
        `$et-${eventType}`,
        groupName,
        rest
      )
    } catch (error: unknown) {
      if (!(error instanceof PersistentSubscriptionExistsError)) {
        throw error
      }
    }
  }

  async #startConsuming(): Promise<void> {
    try {
      const client = this.#getClient()

      const subscription = client.subscribeToPersistentSubscriptionToStream<JSONEventData<KurrentEventType>>(
        `$et-${eventType}`,
        this.#opts.createPersistentSubscriptionOpts.groupName ?? "rivr-consumers",
        {
          bufferSize: 100,
        },
      )

      this.#subscription = subscription

      for await (const event of subscription) {
        try {
          const { event: e } = event

          if (e === undefined) {
            console.warn("event is undefined")
            continue
          }

          const { data } = e
          const { pickAfter, createdAt, ...rest } = data as Message

          await this.#consumeOpts.onMessage({
            ...rest,
            ...pickAfter !== undefined && { pickAfter: new Date(pickAfter) },
            createdAt: new Date(createdAt)
          })
          await subscription.ack(event)
        } catch (error: unknown) {
          await subscription.nack("retry", "failed to process event", event)
        }
      }
    } catch (e: unknown) {
      console.error("error while consuming a kurrentdb stream", e)
    }
  }
}

class KurrentDBQueue implements Queue<never> {
  #opts: KurrentDBQueueOpts
  #client: KurrentDBClient | undefined

  constructor(opts: KurrentDBQueueOpts) {
    this.#opts = opts;
  }

  async produce(messages: Message[], opts?: undefined): Promise<void> {
    const client = this.#getClient()
    const messagesByStream = Array.from(this.#groupMessagesByStream(messages).entries())
    const eventsByStream = messagesByStream.map(([ stream, messages ]) => [
      stream,
      messages.map(msg => ({
        type: "rivr-message",
        id: msg.id,
        contentType: "application/json",
        data: msg,
        metadata: {}
      } as JSONEventData<KurrentEventType>))
    ] as const)

    await Promise.all(eventsByStream.map(([ stream, events ]) =>
      client.appendToStream(stream, events)))
  }

  supportsDelayedMessages(): boolean {
    return false
  }

  async disconnect(): Promise<void> {

  }

  consume(opts: ConsumeOpts): Consumption {
    return new PersistentSubscriptionConsumption(
      () => this.#getClient(),
      this.#opts,
      opts
    )
  }

  #getClient(): KurrentDBClient {
    if (this.#client === undefined) {
      this.#client = KurrentDBClient.connectionString(this.#opts.connectionString);
    }

    return this.#client
  }

  #groupMessagesByStream(messages: Message[]): Map<string, Message[]> {
    return messages.reduce(
      (map, message) => {
        const streamName = this.#opts.streamNameFromMessage(message)
        const existing = map.get(streamName) ?? []

        return map.set(streamName, [ ...existing, message ])
      },
      new Map<string, Message[]>()
    )
  }
}

export type CreateQueueOpts = {
  connectionString: string
  createPersistentSubscriptionOpts: CreatePersistentSubscriptionOpts
  /**
   * Build the stream name from a message.
   * This function allows to shard the queue in multiple streams.
   * Sharding the queue enables you to delete old stream easily.
   *
   * By default, the queue is sharded by hour.
   *
   * Depending on your workload, you may want to select another
   * suffix, such as a stream per minute, or a stream per day.
   *
   * @param msg
   */
  streamNameFromMessage?: (msg: Message) => string
}

export type CreatePersistentSubscriptionOpts = {
  groupName?: string
} & PersistentSubscriptionToStreamSettings

export function createQueue(opts: CreateQueueOpts): Queue<never> {
  const {
    streamNameFromMessage = shardQueueByHour,
    ...rest
  } = opts

  return new KurrentDBQueue({
    ...rest,
    streamNameFromMessage
  })
}

function shardQueueByHour (msg: Message): string {
  const date = msg.createdAt.toISOString().substring(0, 13)

  return `rivr-messages-${date}`
}