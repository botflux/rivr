import {fastify, FastifyInstance} from "fastify";
import fastifyMongodb from "@fastify/mongodb";
import fastifyPlugin from "fastify-plugin";
import {MongoDBWorkflowEngine} from "../mongodb/engine";
import {MongoClient} from "mongodb";
import {Workflow} from "../workflow";
import {EngineInterface} from "../engine.interface";
import {WorkerInterface} from "../worker.interface";

export type FastifyRivrOpts = {
  client: (instance: FastifyInstance) => MongoClient
  workflow: Workflow<any>
}

declare module "fastify" {
  interface FastifyInstance {
    engine: EngineInterface
    worker?: WorkerInterface | undefined
  }
}

const fastifyRivr = fastifyPlugin((instance, opts: FastifyRivrOpts, done) => {
  const engine = MongoDBWorkflowEngine.create({
    client: opts.client(instance),
    dbName: "fastify",
  })

  instance.decorate("engine", engine)
  instance.decorate("worker", undefined)

  instance.addHook("onReady", function (this: FastifyInstance) {
    this.worker = this.engine.getWorker(opts.workflow)
    this.worker.start()
  })

  instance.addHook("onClose", function (this: FastifyInstance) {
    return this.engine.stop()
  })

  done()
}, {
  name: "fastify-rivr",
})

export async function manualTest () {
  const app = fastify({
    logger: true
  })

  const workflow = Workflow.create<number>("my_workflow", w => {
    w.step("multiply_by_10", ({ state }) => state * 10)
    w.step("persist", async ({ state }) => {
      app.log.info("writing in mongodb")
      await app.mongo.client.db("foo").collection("baz").insertOne({ result: state })
      app.log.info("written in mongodb")
    })
  })

  app
    .register(fastifyMongodb, {
      forceClose: true,
      url: "mongodb://root:example@localhost:27017"
    })
    .register(fastifyRivr, {
      client: instance => instance.mongo.client,
      workflow
    })
    .route({
      url: "/foo",
      method: "GET",
      handler: async function (this: FastifyInstance, request, reply) {
        return this.mongo.client.db("foo").collection("bar").findOneAndUpdate({
          n: 1,
        }, {
          $set: {
            n: 1
          }
        }, {
          upsert: true
        })
      }
    })
    .route({
      url: "/bar",
      method: "GET",
      handler: async function (this: FastifyInstance, request, reply) {
        const trigger = this.engine.getTrigger(workflow)
        await trigger.trigger(10)
        return "triggered"
      }
    })

  await app.listen({
    port: 8888,
    host: "0.0.0.0"
  })
}

manualTest().catch(console.error)