import {after, before, describe, test, TestContext} from "node:test";
import fastify, {FastifyInstance} from "fastify";
import {createEngine} from "@rivr/engine-mongodb";
import {randomUUID} from "crypto";
import {rivr} from "rivr";
import {MongoDBContainer, StartedMongoDBContainer} from "@testcontainers/mongodb";
import { agent } from "supertest"
import {setTimeout} from "timers/promises";
import {fastifyRivr} from "./plugin";

let container!: StartedMongoDBContainer

before(async () => {
  container = await new MongoDBContainer("mongo:8").start()
})

after(async () => {
  await container?.stop()
})

describe('fastify integration', function () {
  test("should be able to start a worker", async (t: TestContext) => {
    // Given
    let result: number | undefined

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .addHook("onWorkflowCompleted", (w, s) => result = s)

    const app = fastify()
      .register(fastifyRivr, {
        engine: createEngine({
          url: container.getConnectionString(),
          delayBetweenPulls: 100,
          clientOpts: {
            directConnection: true
          },
          dbName: randomUUID(),
        }),
        workflows: [ workflow ]
      })
      .route({
        url: "/:value",
        method: "GET",
        schema: {
          params: {
            type: "object",
            properties: {
              value: { type: "string" }
            }
          }
        },
        handler: async (request, reply) => {
          await request.server.rivr.getTrigger().trigger(workflow, parseInt((request.params as any).value))
          reply.status(200)
        }
      })

    const agent = await startApp(app, t.signal)

    // When
    await agent.get("/1").expect(200)

    // Then
    await waitForPredicate(() => result !== undefined, 5_000)
    t.assert.strictEqual(result, 2)
  })
})

async function startApp (app: FastifyInstance, signal: AbortSignal) {
  await app.listen({
    signal,
    host: "0.0.0.0",
    port: 0
  })

  return agent(app.server)
}

async function waitForPredicate(fn: () => boolean, ms = 5_000) {
  let now = new Date().getTime()
  while (!fn() && new Date().getTime() - now < ms) {
    await setTimeout(20)
  }
}