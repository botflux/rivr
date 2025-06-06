import {createClient, RedisClientOptions} from "redis"
import {
  ConcreteTrigger,
  ConcreteWorker, ConsumeOpts, Consumption,
  DefaultTriggerOpts,
  Engine, Queue,
  Storage,
  Trigger,
  Worker,
  Write
} from "rivr";
import {randomUUID} from "node:crypto";
import { setTimeout } from "node:timers/promises"

class RedisStreamConsumption implements Consumption {
  #redis: ReturnType<typeof createClient>
  #queueOpts: RedisQueueOpts
  #consumerOpts: ConsumeOpts

  #stopped = false
  #consumptionId = randomUUID()
  #xAutoClaimIntervalAbort = new AbortController()

  constructor(
    redis: ReturnType<typeof createClient>,
    queueOpts: RedisQueueOpts,
    consumerOpts: ConsumeOpts
  ) {
    this.#redis = redis;
    this.#queueOpts = queueOpts;
    this.#consumerOpts = consumerOpts;

    this.#startConsuming()
    this.#startAutoClaimLoop()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#xAutoClaimIntervalAbort.abort()
  }

  async #startConsuming() {
    try {
      await this.#redis.xGroupCreate(
        this.#queueOpts.stream,
        this.#queueOpts.group,
        "0",
        {
          MKSTREAM: true,
        }
      )
        .catch(error => error.message.includes("BUSYGROUP") ? Promise.resolve() : Promise.reject(error))

      while (!this.#stopped) {
        const result = await this.#redis.xReadGroup(
          this.#queueOpts.group,
          this.#consumptionId,
          { key: this.#queueOpts.stream, id: ">" },
          {
            COUNT: this.#queueOpts.itemCount,
            BLOCK: this.#queueOpts.waitTime
          }
        )

        if (result === null || result === undefined) {
          continue
        }

        if (!this.#isArray(result)) {
          console.log("unrecognized value returned by redis")
          continue
        }

        if (result.length === 0)
          continue

        const [ first ] = result

        if (!this.#looksLikeRedisStreamResult(first)) {
          console.log("unrecognized stream result item")
          continue
        }

        const { messages } = first

        for (const message of messages) {
          if (!this.#looksLikeRedisStreamMessage(message)) {
            console.log("message does not look like a redis stream message", message)
            continue
          }

          try {
            const state = JSON.parse(message.message.msg)
            await this.#consumerOpts.onMessage(state)
            await this.#redis.xAck(this.#queueOpts.stream, this.#queueOpts.group, message.id)
          } catch (error: unknown) {
            console.error("error while handling the message", error, message)
          }
        }
      }
    } catch (error: unknown) {
      console.error("error while listening to redis stream", error)
    }
  }

  async #startAutoClaimLoop() {
    try {
      while (!this.#stopped) {
        await this.#redis.xAutoClaim(
          this.#queueOpts.stream,
          this.#queueOpts.group,
          this.#consumptionId,
          this.#queueOpts.xAutoClaimPendingMinTime,
          "0",
          {
            COUNT: this.#queueOpts.xAutoClaimLimit
          }
        )

        await setTimeout(this.#queueOpts.xAutoClaimInterval, 0, { signal: this.#xAutoClaimIntervalAbort.signal })
      }
    } catch (error: unknown) {
      if (!this.#isAbortError(error)) {
        console.log("something went wrong in the auto claim loop")
      }
    }
  }

  #isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      && error.message.includes("was aborted")
  }

  #isArray(result: unknown): result is unknown[] {
    return Array.isArray(result)
  }

  #looksLikeRedisStreamResult(data: unknown): data is { name: string, messages: unknown[] } {
    return typeof data === "object" && data !== null
      && "name" in data && "messages" in data
      && typeof data.name === "string"
      && Array.isArray(data.messages)
  }

  #looksLikeRedisStreamMessage(message: unknown): message is { id: string, message: { msg: string } } {
    return typeof message === "object" && message !== null
      && "message" in message && "id" in message
      && typeof message.id === "string"
      && typeof message.message === "object" && message.message !== null
      && "msg" in message.message && typeof message.message.msg === "string"
  }
}

type RedisQueueOpts = {
  redis: RedisClientOptions
  group: string
  stream: string
  itemCount: number
  waitTime: number
  xAutoClaimInterval: number
  xAutoClaimPendingMinTime: number
  xAutoClaimLimit: number
}

class RedisQueue implements Queue<DefaultTriggerOpts> {
  #opts: RedisQueueOpts

  #client?: ReturnType<typeof createClient>
  #consumptions: Consumption[] = []

  constructor(opts: RedisQueueOpts) {
    this.#opts = opts
  }

  async consume(opts: ConsumeOpts): Promise<Consumption> {
    const client = await this.#getClient()
    const c = new RedisStreamConsumption(
      client,
      this.#opts,
      opts
    )

    this.#consumptions.push(c)

    return c
  }

  async write<State>(writes: Write<State>[], opts?: DefaultTriggerOpts | undefined): Promise<void> {
    const client = await this.#getClient()
    const writesToPublish = this.#filterWritesToPublish(writes)

    await Promise.all([
      writesToPublish.map(write => client.xAdd(this.#opts.stream, "*", { msg: JSON.stringify(write.state) }))
    ])
  }

  async disconnect(): Promise<void> {
    for (const c of this.#consumptions) {
      await c.stop()
    }
    await this.#client?.close()
  }

  async #getClient() {
    if (this.#client === undefined) {
      this.#client = createClient(this.#opts.redis)

      if (!this.#client.isOpen) {
        await this.#client.connect()
      }
    }

    return this.#client
  }

  /**
   * We only publish the writes that will trigger a workflow's step.
   *
   * We won't trigger another step if a new state has `status === "successful"`.
   *
   * @param writes
   * @private
   */
  #filterWritesToPublish(writes: Write<unknown>[]): Write<unknown>[] {
    return writes.filter(w => w.state.status === "in_progress")
  }
}

class RedisEngine implements Engine<DefaultTriggerOpts> {
  #opts: CreateEngineOpts
  #queues: Queue<unknown>[] = []

  constructor(opts: CreateEngineOpts) {
    this.#opts = opts;
  }

  createWorker(): Worker {
    return new ConcreteWorker(this.#createQueue())
  }
  createTrigger(): Trigger<DefaultTriggerOpts> {
    return new ConcreteTrigger(this.#createQueue())
  }
  createStorage(): Storage<DefaultTriggerOpts> {
    throw new Error("Method not implemented.");
  }

  async close(): Promise<void> {
    for (const queue of this.#queues) {
      await queue.disconnect()
    }
  }

  #createQueue() {
    const {
      redis,
      stream = "rivr:workflows",
      group = "rivr:workflows-group",
      itemCount = 10,
      waitTime = 3,
      xAutoClaimLimit = 25,
      xAutoClaimMinTime = 60000,
      xAutoClaimLoopInterval = 10000,
    } = this.#opts

    const queue = new RedisQueue({
      redis,
      group,
      stream,
      itemCount,
      waitTime,
      xAutoClaimInterval: xAutoClaimLoopInterval,
      xAutoClaimPendingMinTime: xAutoClaimMinTime,
      xAutoClaimLimit,
    })

    this.#queues.push(queue)

    return queue
  }
}

export type CreateEngineOpts = {
  redis: RedisClientOptions
  group?: string
  stream?: string
  itemCount?: number
  waitTime?: number

  xAutoClaimLoopInterval?: number
  xAutoClaimMinTime?: number
  xAutoClaimLimit?: number
}

export function createEngine(opts: CreateEngineOpts) {
  return new RedisEngine(opts)
}