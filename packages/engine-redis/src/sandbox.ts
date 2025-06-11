import {createQueue} from "./redis";
import {createOutbox} from "rivr/dist/outbox/types";
import {createWorker} from "rivr/dist/worker";
import {trigger} from "rivr";

async function sandbox () {
  const queue = createQueue({
    redis: {
      url: "redis://localhost:6379"
    }
  })

  type UserCreated = {
    type: "user_created"
    email: string
  }

  const outbox = createOutbox<UserCreated>("notify_user")
    .decorate("sendMail", async (email: string, content: string) => console.log(
      `Sending ${content} to ${email}`
    ))
    .handler({
      handler: async ({ state, outbox }) => {
        await outbox.sendMail(state.email, "User created successfully")
      }
    })

  const worker = createWorker({
    primary: queue,
    outboxes: [ outbox ]
  })

  await worker.start()

  await trigger(
    queue,
    outbox,
    {
      type: "user_created",
      email: "foo@bar.com",
    }
  )
}

sandbox().catch(console.error)