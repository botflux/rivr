// import { createWorker, rivr } from "rivr"
// import { createQueue } from "@rivr/engine-redis"
// import { createQueue as createMongoQueue } from "@rivr/engine-mongodb"
//
// const wf = rivr.workflow("my-workflow")
//   .step({
//     name: "add-1",
//     handler: async ({ state }) => state + 1
//   })
//   .step({
//     name: "minus-3",
//     handler: async ({ state }) => state - 3
//   })
//
// const redisQueue = createQueue({
//   redis: {
//     url: "redis://localhost:6379",
//   }
// })
//
// const mongoQueue = createMongoQueue({
//   url: "mongodb://localhost:27017",
//   dbName: "my-db"
// })
//
// const worker = createWorker({
//   queues: [
//     redisQueue
//   ]
// })
//
// await workflow.trigger(queue, wf, 4)
// const o = outbox.create({
//   handler: async ({ state }) => workflow.trigger(wf, state)
// })
//
// await outbox.trigger(mongoQueue, o, 5)
//
// await worker.start([ wf ])
