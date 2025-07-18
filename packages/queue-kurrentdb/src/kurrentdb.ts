import {
  Consumer,
  ConsumerOpts,
  ConsumptionHooks,
  Message,
  Producer,
  Queue,
  StopReason,
  NormalizedWorkflowState,
  WorkflowStateStorage, CreateMessage
} from "rivr";
import {
  JSONEventType,
  KurrentDBClient,
  PersistentSubscriptionExistsError,
  PersistentSubscriptionToStream,
  PersistentSubscriptionToStreamSettings,
  RecordedEvent,
  SubscribeToPersistentSubscriptionToStreamOptions,
  UnavailableError
} from "@kurrent/kurrentdb-client"
import {JSONEventData} from "@kurrent/kurrentdb-client/dist/types/events";
import {CreatePersistentSubscriptionOpts, CreateQueueOpts} from "./public-types";
import {DuplexOptions} from "node:stream";
import {setTimeout} from "node:timers/promises"
import {Hooks} from "rivr/dist/hooks/hooks";
import {uuidv7} from "uuidv7";

type KurrentDBQueueOpts = {
  connectionString: string
  streamToSubscribe: string
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

class PersistentSubscriptionConsumption<T extends JSONEventType> implements Consumer {
  #getClient: () => KurrentDBClient
  #streamToSubscribe: string
  #groupName: string
  #subscriptionCreationOpts: PersistentSubscriptionToStreamSettings
  #subscribeOpts?: SubscribeToPersistentSubscriptionToStreamOptions
  #duplexOpts?: DuplexOptions
  #handler: (event: RecordedEvent<T>) => Promise<void>

  #subscription?: PersistentSubscriptionToStream<T>
  #stopReconnecting = false
  #hooks = new Hooks<ConsumptionHooks>()

  constructor(getClient: () => KurrentDBClient, streamToSubscribe: string, groupName: string, persistentSubscriptionCreationOpts: PersistentSubscriptionToStreamSettings, subscribeOpts: SubscribeToPersistentSubscriptionToStreamOptions, duplexOpts: DuplexOptions, handler: (event: RecordedEvent<T>) => Promise<void>) {
    this.#getClient = getClient;
    this.#streamToSubscribe = streamToSubscribe;
    this.#groupName = groupName;
    this.#subscriptionCreationOpts = persistentSubscriptionCreationOpts;
    this.#subscribeOpts = subscribeOpts;
    this.#duplexOpts = duplexOpts;
    this.#handler = handler;
  }

  async start(): Promise<void> {
    if (this.#subscription !== undefined) {
      return
    }

    await this.#ensurePersistentSubscriptionCreated()
    this.#stopReconnecting = false
    this.#startConsuming()
    this.#hooks.executeHook("onStart", [])
  }

  async stop(): Promise<void> {
    const alreadyStopped = this.#stopReconnecting

    this.#stopReconnecting = true
    await this.#subscription?.unsubscribe()
    this.#subscription = undefined

    if (!alreadyStopped) {
      this.#hooks.executeHook("onStop", [ "manually_stopped" ])
    }
  }

  addHook(hook: "onError", handler: (error: unknown) => void): this
  addHook(hook: "onStart", handler: () => void): this
  addHook(hook: "onStop", handler: (reason: StopReason, error?: unknown) => void): this
  addHook(hook: string, handler: (...params: any[]) => void): this {
    this.#hooks.addHook(hook as keyof ConsumptionHooks, handler)
    return this
  }

  async #ensurePersistentSubscriptionCreated() {
    const client = this.#getClient()

    try {
      await client.createPersistentSubscriptionToStream(
        this.#streamToSubscribe,
        this.#groupName,
        this.#subscriptionCreationOpts
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

        const subscription = client.subscribeToPersistentSubscriptionToStream<T>(
          this.#streamToSubscribe,
          this.#groupName,
          this.#subscribeOpts,
          this.#duplexOpts
        )

        this.#subscription = subscription

        for await (const event of subscription) {
          try {
            const { event: e } = event

            if (e === undefined) {
              console.warn("event is undefined")
              continue
            }

            await this.#handler(e)
            await subscription.ack(event)
          } catch (error: unknown) {
            await subscription.nack("retry", "failed to process event", event)
          }
        }
      } catch (e: unknown) {
        this.#hooks.executeHook("onError", [ e ])
        if (!(e instanceof UnavailableError)) {
          this.#hooks.executeHook("onStop", [ "unrecoverable_error", e ])
          return
        }

        await setTimeout(500)
      }
    }
  }
}

class KurrentDBProducer implements Producer<never> {
  #client: KurrentDBClient
  #opts: KurrentDBQueueOpts

  constructor(client: KurrentDBClient, opts: KurrentDBQueueOpts) {
    this.#client = client;
    this.#opts = opts;
  }

  async produce(messages: CreateMessage[], opts?: undefined): Promise<Message[]> {
    const messagesToCreate = messages.map(message => ({
      ...message,
      id: message.id ?? uuidv7()
    }))

    const messagesByStream = Array.from(this.#groupMessagesByStream(messagesToCreate).entries())
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
      this.#client.appendToStream(stream, events)))

    return messagesToCreate
  }
  supportsDelayedMessages(): boolean {
      return false
  }

  async disconnect(): Promise<void> {}

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

class KurrentDBQueue implements Queue<never> {
  #opts: KurrentDBQueueOpts
  #client: KurrentDBClient | undefined

  constructor(opts: KurrentDBQueueOpts) {
    this.#opts = opts;
  }

  createProducer(): Producer<never> {
    return new KurrentDBProducer(this.#getClient(), this.#opts)
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

  async disconnect(): Promise<void> {

  }

  createConsumer(opts: ConsumerOpts): Consumer {
    return new PersistentSubscriptionConsumption<MessageEvent>(
      () => this.#getClient(),
      this.#opts.streamToSubscribe,
      this.#opts.groupName,
      this.#opts.persistentSubscriptionCreationOpts,
      this.#opts.subscribeOpts ?? {},
      this.#opts.duplexOpts ?? {},
      async e => {
        const { data } = e
        const { pickAfter, createdAt, ...rest } = data

        await opts.onMessage({
          ...rest,
          ...pickAfter !== undefined && { pickAfter: new Date(pickAfter) },
          createdAt: new Date(createdAt)
        })
      }
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
    streamToSubscribe: `$ce-${streamPrefix}${streamInfix}`,
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

export type ConsumeCustomSubscriptionOpts<T extends JSONEventType> = {
  connectionString: string
  createSubscriptionOpts?: Omit<CreatePersistentSubscriptionOpts, "groupName">
  subscribeOpts?: SubscribeToPersistentSubscriptionToStreamOptions
  subscribeDuplexOpts?: DuplexOptions
  streamName: string
  groupName: string
  handler: (event: RecordedEvent<T>) => Promise<void>
}

export function consumeCustomSubscription<T extends JSONEventType>(opts: ConsumeCustomSubscriptionOpts<T>): Consumer {
  const {
    connectionString,
    groupName,
    streamName,
    handler,
    createSubscriptionOpts: {
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
    subscribeDuplexOpts = {},
    subscribeOpts = {}
  } = opts

  return new PersistentSubscriptionConsumption<T>(
    () => KurrentDBClient.connectionString(connectionString),
    streamName,
    groupName,
    {
      extraStatistics,
      maxRetryCount,
      startFrom: "start",
      checkPointAfter,
      checkPointLowerBound,
      checkPointUpperBound,
      readBatchSize,
      liveBufferSize,
      historyBufferSize,
      consumerStrategyName,
      maxSubscriberCount,
      messageTimeout,
      resolveLinkTos: true,
    },
    subscribeOpts,
    subscribeDuplexOpts,
    async (event) => {
      await handler(event)
    }
  )
}

type CreateStorageOpts = {
  connectionString: string
  streamInfix: string
}

export type WorkflowStateEvent<State> = JSONEventData<JSONEventType<
  "workflow_state_changed",
  NormalizedWorkflowState<State>
>>

const workflowStateStreamPrefix = "RivrWorkflowStates"

class KurrentDBWorkflowStateStorage implements WorkflowStateStorage {
  #opts: CreateStorageOpts
  #client: KurrentDBClient | undefined

  constructor(opts: CreateStorageOpts) {
    this.#opts = opts
  }

  async upsert<State>(states: NormalizedWorkflowState<State>[]): Promise<void> {
    const client = this.#getClient()
    
    const eventsByStream = states.map(state => {
      const streamName = `${workflowStateStreamPrefix}${this.#opts.streamInfix}-${state.id}`
      const event = {
        type: "workflow_state_changed",
        id: state.id,
        contentType: "application/json",
        data: state,
        metadata: {}
      } as WorkflowStateEvent<State>
      
      return [streamName, event] as const
    })

    await Promise.all(eventsByStream.map(([streamName, event]) =>
      client.appendToStream(streamName, [event])
    ))
  }

  async get<State>(id: string): Promise<NormalizedWorkflowState<State> | undefined> {
    const client = this.#getClient()
    const streamName = `${workflowStateStreamPrefix}${this.#opts.streamInfix}-${id}`
    
    try {
      const events = client.readStream<WorkflowStateEvent<State>>(streamName, {
        direction: "backwards",
        fromRevision: "end"
      })

      for await (const event of events) {
        if (event.event?.data) {
          return deserializeWorkflowState(event.event.data)
        }
      }

      return undefined
    } catch (error: unknown) {
      // If the stream doesn't exist, return undefined
      if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'stream-not-found') {
        return undefined
      }
      throw error
    }
  }

  async disconnect(): Promise<void> {}

  #getClient(): KurrentDBClient {
    if (this.#client === undefined) {
      this.#client = KurrentDBClient.connectionString(this.#opts.connectionString)
    }
    return this.#client
  }
}

function deserializeWorkflowState<State>(data: NormalizedWorkflowState<State>): NormalizedWorkflowState<State> {
  return {
    ...data,
    lastModified: new Date(data.lastModified),
  }
}

export function createStorage(opts: CreateStorageOpts): WorkflowStateStorage {
  if (opts.streamInfix.includes("-")) {
    throw new RivrInvalidStreamInfixError(opts.streamInfix)
  }
  
  return new KurrentDBWorkflowStateStorage(opts)
}

export type ConsumeWorkflowStateChangesOpts = Omit<ConsumeCustomSubscriptionOpts<WorkflowStateEvent<unknown>>, "streamName"> & {
  streamInfix: string
}

export function consumeWorkflowStateChanges(opts: ConsumeWorkflowStateChangesOpts): Consumer {
  const {
    connectionString,
    groupName,
    handler,
    streamInfix,
    createSubscriptionOpts: {
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
    subscribeDuplexOpts = {},
    subscribeOpts = {}
  } = opts

  return new PersistentSubscriptionConsumption<WorkflowStateEvent<unknown>>(
    () => KurrentDBClient.connectionString(connectionString),
    `$ce-${workflowStateStreamPrefix}${streamInfix}`,
    groupName,
    {
      extraStatistics,
      maxRetryCount,
      startFrom: "start",
      checkPointAfter,
      checkPointLowerBound,
      checkPointUpperBound,
      readBatchSize,
      liveBufferSize,
      historyBufferSize,
      consumerStrategyName,
      maxSubscriberCount,
      messageTimeout,
      resolveLinkTos: true,
    },
    subscribeOpts,
    subscribeDuplexOpts,
    async (event) => {
      const { data, ...rest } = event

      await handler({
        ...rest,
        data: deserializeWorkflowState(data)
      })
    }
  )
}