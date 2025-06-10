// import { fastifyPlugin } from "fastify-plugin"
// import {Engine, Trigger, Worker} from "rivr";
// import {Workflow} from "rivr";
// import {FastifyInstance} from "fastify";
//
// export type RivrObject = {
//   getEngine<TriggerOpts extends Record<never, never>>(): Engine<TriggerOpts>
//
//   /**
//    * Get the shared trigger instance.
//    */
//   getTrigger<TriggerOpts extends Record<never, never>>(): Trigger<TriggerOpts>
// }
//
// export type FastifyRivrOpts<TriggerOpts extends Record<never, never>> = {
//   /**
//    * An engine instance that will be used to create the trigger and worker.
//    */
//   engine: Engine<TriggerOpts>
//   /**
//    * Workflows to be started by the worker.
//    */
//   workflows: Workflow<any, any, any, any>[]
// }
//
// declare module "fastify" {
//   interface FastifyInstance {
//     rivr: RivrObject
//   }
// }
//
// export const fastifyRivr = fastifyPlugin((instance, opts: FastifyRivrOpts<Record<never, never>>) => {
//   let trigger: Trigger<Record<never, never>> | undefined
//   let worker: Worker | undefined
//
//   instance.decorate("rivr", {
//     getEngine<TriggerOpts extends Record<never, never>>() {
//       return opts.engine as Engine<TriggerOpts>
//     },
//     getTrigger<TriggerOpts extends Record<never, never>>() {
//       if (trigger === undefined) {
//         trigger = opts.engine.createTrigger()
//       }
//
//       return trigger as Trigger<TriggerOpts>
//     }
//   })
//
//   instance.addHook("onReady", async function (this: FastifyInstance) {
//     worker = this.rivr.getEngine().createWorker()
//     await worker.start(opts.workflows)
//   })
//
//   instance.addHook("onClose", async function (this: FastifyInstance) {
//     await worker?.stop()
//     await this.rivr.getEngine().close()
//   })
// }, {
//   name: "fastify-rivr",
// })