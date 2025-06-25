import {ConsumeOpts, Consumption, Message, Queue} from "rivr";
import {
  JSONEventType,
  KurrentDBClient,
  PersistentSubscriptionExistsError,
  PersistentSubscriptionToStream,
  PersistentSubscriptionToStreamSettings, SubscribeToPersistentSubscriptionToStreamOptions, UnavailableError
} from "@kurrent/kurrentdb-client"
import {JSONEventData} from "@kurrent/kurrentdb-client/dist/types/events";
import {CreateQueueOpts} from "./public-types";
import {DuplexOptions} from "node:stream";
import { setTimeout } from "node:timers/promises"

type KurrentDBQueueOpts = {
  connectionString: string
  groupName: string
  persistentSubscriptionCreationOpts: PersistentSubscriptionToStreamSettings
  subscribeOpts?: SubscribeToPersistentSubscriptionToStreamOptions
  duplexOpts?: DuplexOptions
  partitionStream: (msg: Message) => string
  streamInfix: string
}

type RawMessage = Omit<Message, "pickAfter" | "createdAt"> & {
  pickAfter?: string
  createdAt: string
}

const streamPrefix = "RivrMessages"

type MessageEvent = JSONEventData<JSONEventType<
  "rivr_message_created",
  RawMessage
>>

class PersistentSubscriptionConsumption implements Consumption {
  #getClient: () => KurrentDBClient
  #opts: KurrentDBQueueOpts
  #consumeOpts: ConsumeOpts
  #subscription?: PersistentSubscriptionToStream<MessageEvent>
  #stopReconnecting = false

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
    this.#stopReconnecting = false
    this.#startConsuming()
  }

  async stop(): Promise<void> {
    this.#stopReconnecting = true
    await this.#subscription?.unsubscribe()
  }

  async #ensurePersistentSubscriptionCreated() {
    const client = this.#getClient()
    const {
      persistentSubscriptionCreationOpts,
      groupName
    } = this.#opts

    try {
      await client.createPersistentSubscriptionToStream(
        `$ce-${streamPrefix}${this.#opts.streamInfix}`,
        groupName,
        persistentSubscriptionCreationOpts
      )
    } catch (error: unknown) {
      if (!(error instanceof PersistentSubscriptionExistsError)) {
        throw error
      }
    }
  }

  async #startConsuming(): Promise<void> {
    while (!this.#stopReconnecting) {
      try {
        const client = this.#getClient()

        const subscription = client.subscribeToPersistentSubscriptionToStream<MessageEvent>(
          `$ce-${streamPrefix}${this.#opts.streamInfix}`,
          this.#opts.groupName,
          this.#opts.subscribeOpts,
          this.#opts.duplexOpts
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
            const { pickAfter, createdAt, ...rest } = data

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
        if (!(e instanceof UnavailableError)) {
          throw e
        }
        console.log("error consuming the subscription from kurrentdb", e)
        await setTimeout(500)
      }
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
      `${streamPrefix}${this.#opts.streamInfix}-${stream}`,
      messages.map(({ createdAt, pickAfter, ...rest }) => ({
        type: "rivr_message_created",
        id: rest.id,
        contentType: "application/json",
        data: {
          ...rest,
          createdAt: createdAt.toISOString(),
          ...pickAfter !== undefined && { pickAfter: pickAfter.toISOString() },
        },
        metadata: {}
      } as MessageEvent))
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
        const streamName = this.#opts.partitionStream(message)
        const existing = map.get(streamName) ?? []

        return map.set(streamName, [ ...existing, message ])
      },
      new Map<string, Message[]>()
    )
  }
}

export class RivrInvalidStreamInfixError extends Error {
  constructor(invalidInfix: string) {
    super(`Cannot use '${invalidInfix}' as an infix because it contains '-'. This limitation is due to the consumption implementation that is based on category stream ('$ce-')`);
  }
}

export function createQueue(opts: CreateQueueOpts): Queue<never> {
  const {
    partitionStream = shardQueueByHour,
    createSubscriptionOpts: {
      groupName = "rivr-consumers",
      messageTimeout = 30_000,
      checkPointAfter = 2_000,
      checkPointLowerBound = 10,
      checkPointUpperBound = 1_000,
      consumerStrategyName = "RoundRobin",
      extraStatistics = false,
      historyBufferSize = 500,
      liveBufferSize = 500,
      maxRetryCount = 10,
      maxSubscriberCount = "unbounded",
      readBatchSize = 20,
    } = {},
    streamInfix,
    ...rest
  } = opts

  if (streamInfix.includes("-")) {
    throw new RivrInvalidStreamInfixError(streamInfix)
  }

  return new KurrentDBQueue({
    ...rest,
    streamInfix,
    partitionStream: partitionStream,
    groupName,
    persistentSubscriptionCreationOpts: {
      resolveLinkTos: true,
      messageTimeout,
      maxSubscriberCount,
      consumerStrategyName,
      historyBufferSize,
      liveBufferSize,
      readBatchSize,
      checkPointUpperBound,
      checkPointLowerBound,
      checkPointAfter,
      startFrom: "start",
      maxRetryCount,
      extraStatistics,
    }
  })
}

function shardQueueByHour (msg: Message): string {
  return msg.createdAt.toISOString().substring(0, 13)
}