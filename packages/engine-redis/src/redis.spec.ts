import {describe, before, after} from "node:test";
import { basicFlowControl, advancedFlowControl, extension } from "rivr"
import {RedisContainer, StartedRedisContainer} from "@testcontainers/redis";
import {createEngine} from "./redis";

describe('redis engine', function () {
  let container!: StartedRedisContainer

  before(async () => {
    container = await new RedisContainer("redis:7").start()
  })
  after(async () => {
    await container?.stop()
  })

  const makeEngine = () => createEngine({
    redis: { url: container.getConnectionUrl() }
  })

  basicFlowControl({ createEngine: makeEngine })
})