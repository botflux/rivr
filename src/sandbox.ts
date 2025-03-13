import {rivr} from "./index";
import { Workflow, WorkflowPlugin } from "./workflow";

class Mailer {
  sendMail() {}
}


function mailingPlugin<In extends Workflow> (wf: In) {
  const newWf = wf.decorate("mailer", new Mailer())
  return newWf
}

const wf = rivr.workflow("my-wf")
  .register(mailingPlugin)
  .addHook("onStep", w => w.mailer.sendMail())
  

type MongoEngineContext =  {}

const workflow1 = rivr.workflow("my_workflow")
  .withEngineContext<MongoEngineContext>()
  .register(mailingPlugin)
  .step({
    name: "multiply_by_4",
    handler: ({ state }) => state * 4
  })
  .step({
    name: "add_1",
    handler: ({ state }) => state + 1,
    executeOn: "worker_thread"
  })
  .step({
    name: "send_result_by_mail",
    handler: async ({ state, workflow }) => await workflow.mails.send({
      from: "your_app@world.local",
      to: "hello@world.local",
      subject: "The calculation has finished",
      body: `The result of the calculation is ${state}.`
    })
  })

const job1 = rivr.job("my_job")
  .register(mailingPlugin)
  .handle(async ({ state, job }) => await job.mailing.send({
    from: "your_app@world.local",
    to: "hello@world.local",
    subject: "The calculation has finished",
    body: `The result of the calculation is ${state}.`
  }))

const engine = mongodbEngine({
  uri: "mongodb://localhost:27017/my-db",
})

const worker = engine.createWorker([
  workflow1,
  job1
])

worker.start()
worker.stop()

engine.trigger(job1, 1)
engine.trigger(job1, [
  1,
  2,
  3,
  4
])

engine.trigger(workflow1, 3)
engine.trigger(workflow1, [4, 5, 6, 7])
