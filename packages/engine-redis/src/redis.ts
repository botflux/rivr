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

class RedisStreamConsumption implements Consumption {
  #redis: ReturnType<typeof createClient>
  #group: string
  #stream: string
  #itemCount: number
  #waitTime: number
  #consumerOpts: ConsumeOpts

  #stopped = false
  #consumptionId = randomUUID()

  constructor(redis: ReturnType<typeof createClient>, group: string, stream: string, itemCount: number, waitTime: number, consumerOpts: ConsumeOpts) {
    this.#redis = redis;
    this.#group = group;
    this.#stream = stream;
    this.#itemCount = itemCount;
    this.#waitTime = waitTime;
    this.#consumerOpts = consumerOpts;

    this.#startConsuming()
  }

  async stop(): Promise<void> {
    this.#stopped = true
  }

  async #startConsuming() {
    try {
      await this.#redis.xGroupCreate(
        this.#stream,
        this.#group,
        "0",
        {
          MKSTREAM: true,
        }
      )
        .catch(error => error.message.includes("BUSYGROUP") ? Promise.resolve() : Promise.reject(error))

      while (!this.#stopped) {
        const result = await this.#redis.xReadGroup(
          this.#group,
          this.#consumptionId,
          { key: this.#stream, id: ">" },
          {
            COUNT: this.#itemCount,
            BLOCK: this.#waitTime
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
            await this.#redis.xAck(this.#stream, this.#group, message.id)
          } catch (error: unknown) {
            console.error("error while handling the message", error, message)
          }
        }
      }
    } catch (error: unknown) {
      console.error("error while listening to redis stream", error)
    }
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

class RedisQueue implements Queue<DefaultTriggerOpts> {
  #redis: RedisClientOptions
  #group: string
  #stream: string
  #itemCount: number
  #waitTime: number

  #client?: ReturnType<typeof createClient>
  #consumptions: Consumption[] = []

  constructor(redis: RedisClientOptions, group: string, stream: string, itemCount: number, waitTime: number) {
    this.#redis = redis;
    this.#group = group;
    this.#stream = stream;
    this.#itemCount = itemCount;
    this.#waitTime = waitTime;
  }

  async consume(opts: ConsumeOpts): Promise<Consumption> {
    const client = await this.#getClient()
    const c = new RedisStreamConsumption(
      client,
      this.#group,
      this.#stream,
      this.#itemCount,
      this.#waitTime,
      opts
    )

    this.#consumptions.push(c)

    return c
  }

  async write<State>(writes: Write<State>[], opts?: DefaultTriggerOpts | undefined): Promise<void> {
    const client = await this.#getClient()
    const notEndingWrites = writes
      .map(write => write.state)
      .filter(s => s.status === "in_progress")

    for (const state of notEndingWrites) {
      // await client.xAdd(this.#queueName, JSON.stringify(state))
      await client.xAdd(this.#stream, "*", { msg: JSON.stringify(state) })
    }
  }

  async disconnect(): Promise<void> {
    for (const c of this.#consumptions) {
      await c.stop()
    }
    await this.#client?.close()
  }

  async #getClient() {
    if (this.#client === undefined) {
      this.#client = createClient(this.#redis)

      if (!this.#client.isOpen) {
        await this.#client.connect()
      }
    }

    return this.#client
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
    } = this.#opts

    const queue = new RedisQueue(
      redis,
      group,
      stream,
      itemCount,
      waitTime
    )

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
}

export function createEngine(opts: CreateEngineOpts) {
  return new RedisEngine(opts)
}