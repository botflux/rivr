import {describe, before, after} from "node:test";
import {advancedFlow, basicFlow, installUnhandledRejectionHook} from "rivr"
import {RedisContainer, StartedRedisContainer} from "@testcontainers/redis";
import {createQueue as createRedisQueue} from "./redis";
import {randomUUID} from "node:crypto";

installUnhandledRejectionHook()

describe('redis engine', function () {
  let container!: StartedRedisContainer

  before(async () => {
    container = await new RedisContainer("redis:7").start()
  })
  after(async () => {
    await container?.stop()
  })

  const createQueue = () => createRedisQueue({
    redis: { url: container.getConnectionUrl() },
    stream: randomUUID(),
    group: randomUUID(),
  })

  basicFlow({ createQueue })
  advancedFlow({ createQueue })
})