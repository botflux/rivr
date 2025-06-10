// // import { createWorker, rivr } from "rivr"
// // import { createQueue } from "@rivr/engine-redis"
// // import { createQueue as createMongoQueue } from "@rivr/engine-mongodb"
// //
// // const wf = rivr.workflow("my-workflow")
// //   .step({
// //     name: "add-1",
// //     handler: async ({ state }) => state + 1
// //   })
// //   .step({
// //     name: "minus-3",
// //     handler: async ({ state }) => state - 3
// //   })
// //
// // const redisQueue = createQueue({
// //   redis: {
// //     url: "redis://localhost:6379",
// //   }
// // })
// //
// // const mongoQueue = createMongoQueue({
// //   url: "mongodb://localhost:27017",
// //   dbName: "my-db"
// // })
// //
// // const worker = createWorker({
// //   queues: [
// //     redisQueue
// //   ]
// // })
// //
// // await workflow.trigger(queue, wf, 4)
// // const o = outbox.create({
// //   handler: async ({ state }) => workflow.trigger(wf, state)
// // })
// //
// // await outbox.trigger(mongoQueue, o, 5)
// //
// // await worker.start([ wf ])
// import {AsyncFlow, outbox, trigger, Worker2} from "rivr"
// import {createQueue2} from "@rivr/engine-mongodb";
// import {randomUUID} from "crypto";
//
// async function sandbox() {
//   type UserCreated = {
//     type: "user_created",
//     email: string
//   }
//
//   console.log("before outbox")
//
//   const o = outbox.createOutbox<UserCreated>("send_user_created_email")
//     .register(instance => instance
//       .decorate("sendMail", async (email: string, content: string) => console.log(`Sending email to ${email}`))
//     )
//     .handler({
//       handler: async ({ state, outbox }) => {
//         await outbox.sendMail(
//           state.email,
//           `Your account was successfully created!`
//         )
//       }
//     })
//
//   console.log("before queue")
//
//   const queue = createQueue2({
//     dbName: randomUUID(),
//     url: "mongodb://localhost:27017",
//     collectionName: "foo",
//     delayBetweenEmptyPolls: 4_000,
//   })
//
//   console.log("before worker creation")
//
//   const worker2 = new Worker2([ queue ], [ o ] as unknown as AsyncFlow[])
//
//   console.log("before onError")
//
//   worker2.addHook("onError", err => console.log(err))
//
//   console.log("start worker2")
//
//   await worker2.start()
//
//   console.log("trigger outbox")
//
//   await trigger(
//     queue,
//     o,
//     {
//       type: "user_created",
//       email: "foo@foo.com",
//     }
//   )
// }
//
// sandbox().catch(console.error)