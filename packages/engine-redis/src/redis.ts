import {createClient, RedisClientOptions, RedisClientType} from "redis"
import {
  ConcreteTrigger,
  ConcreteWorker, ConsumeOpts, Consumption,
  DefaultTriggerOpts,
  Engine, OnMessage,
  Queue,
  Storage,
  Trigger,
  Worker,
  Write
} from "rivr";
import {write} from "node:fs";

class RedisQueueConsumption implements Consumption {
  #redis: ReturnType<typeof createClient>
  #queueName: string
  #brPopTimeoutSeconds: number
  #opts: ConsumeOpts

  #stopped = false

  constructor(
    redis: ReturnType<typeof createClient>,
    queueName: string,
    brPopTimeoutSeconds: number,
    opts: ConsumeOpts
  ) {
    this.#redis = redis;
    this.#queueName = queueName
    this.#brPopTimeoutSeconds = brPopTimeoutSeconds
    this.#opts = opts;
    this.#startConsuming()
  }

  async stop(): Promise<void> {
      this.#stopped = true
  }

  async #startConsuming() {
    try {

      console.log(this.#queueName, this.#brPopTimeoutSeconds)
      while (!this.#stopped) {
        const mMessage = await this.#redis.brPop(
          this.#queueName,
          this.#brPopTimeoutSeconds
        )

        if (!mMessage) {
          continue
        }

        const { key, element } = mMessage
        console.log("message found", key)
        const payload = JSON.parse(element)

        await this.#opts.onMessage(payload)
      }
    } catch (error: unknown) {
      console.error("error while consuming the redis queue", error)
    }
  }
}

class RedisQueue implements Queue<DefaultTriggerOpts> {
  #redis: RedisClientOptions
  #queueName: string
  #brPopTimeoutSeconds: number

  #client?: ReturnType<typeof createClient>
  #consumptions: Consumption[] = []

  constructor(redis: RedisClientOptions, queueName: string, brPopTimeoutSeconds: number) {
    this.#redis = redis;
    this.#queueName = queueName;
    this.#brPopTimeoutSeconds = brPopTimeoutSeconds;
  }

  async consume(opts: ConsumeOpts): Promise<Consumption> {
    const client = await this.#getClient()
    const c = new RedisQueueConsumption(
      client,
      this.#queueName,
      this.#brPopTimeoutSeconds,
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
      await client.lPush(this.#queueName, JSON.stringify(state))
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
      queueName = "rivr-queue",
      popTimeoutSeconds = 1
    } = this.#opts

    const queue = new RedisQueue(
      redis,
      queueName,
      popTimeoutSeconds
    )

    this.#queues.push(queue)

    return queue
  }
}

export type CreateEngineOpts = {
  redis: RedisClientOptions
  queueName?: string
  popTimeoutSeconds?: number
}

export function createEngine(opts: CreateEngineOpts) {
  return new RedisEngine(opts)
}