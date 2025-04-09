import {fastify, FastifyInstance} from "fastify";
import {fastifyPlugin} from "fastify-plugin";
import {Engine, Trigger} from "./core.ts";
import {createEngine} from "./mongodb.ts";
import {Workflow} from "./types.ts";
import {rivr} from "./workflow.ts";
import { errWithCause } from "pino-std-serializers"

declare module "fastify" {
  interface FastifyInstance {
    getEngine<TriggerOpts extends Record<never, never>>(): Engine<TriggerOpts>
    getTrigger<TriggerOpts extends Record<never, never>>(): Trigger<TriggerOpts>
  }
}

type PluginOpts = {
  engine: Engine<Record<never, never>>
  workflows: Workflow<any, Record<never, never>>[]
}

const rivrPlugin = fastifyPlugin(async (instance, opts: PluginOpts) => {
  let trigger: Trigger<any> | undefined

  instance
    .decorate("getEngine", function getEngine() {
      return opts.engine
    })
    .decorate("getTrigger", function getTrigger() {
      if (trigger === undefined)
        trigger = opts.engine.createTrigger()

      return trigger
    })
    .addHook("onReady", async function (this: FastifyInstance) {
      const worker = this.getEngine().createWorker()

      worker.addHook("onError", (err: unknown) => {
        this.log.error({
          msg: "the rivr workflow worker has emitted an error",
          error: serializeError(err)
        })
      })

      await worker.start(opts.workflows)
    })
    .addHook("onClose", async function (this: FastifyInstance) {
      await this.getEngine().close()
    })
}, {
  name: "fastify-rivr"
})

async function sandbox() {
  const app = fastify({
    logger: true
  })

  const workflow = rivr.workflow<number>("complexe-calculation")
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .step({
      name: "add-5",
      handler: ({ state }) => state + 5
    })
    .step({
      name: "log-result",
      handler: ({ state }) => {
        app.log.info({
          msg: `workflow finished with state '${state}'`
        })

        return state
      }
    })

  app.register(rivrPlugin, {
    engine: createEngine({
      url: "mongodb://root:example@localhost:27017",
      dbName: "db",
    }),
    workflows: [
      workflow
    ]
  })

  app.route({
    method: "GET",
    url: "/:initialState",
    handler: async (req, res) => {
      const initialStateStr = (req.params as Record<string, string>).initialState
      const initialState = Number.parseInt(initialStateStr)

      const trigger = req.server.getTrigger()

      await trigger.trigger(workflow, initialState)

      res.status(204)
    }
  })

  await app.listen({
    host: "0.0.0.0",
    port: 3000
  })
}

function serializeError (err: unknown): unknown {
  if (isErrorObject(err)) {
    return errWithCause(err)
  } else {
    return err
  }
}

function isErrorObject(err: unknown): err is Error {
  return typeof err === "object" && err !== null && "message" in err && typeof err.message === "string"
}

sandbox().catch(console.error);