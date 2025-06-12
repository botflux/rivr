import {createQueue} from "./redis";
import {trigger, tasks, createWorker} from "rivr";
import {createTask} from "rivr/dist/task/types";

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

  const task = createTask<UserCreated>("notify_user")
    .decorate("sendMail", async (email: string, content: string) => console.log(
      `Sending ${content} to ${email}`
    ))
    .handler({
      handler: async ({ state, task }) => {
        await task.sendMail(state.email, "User created successfully")
      }
    })

  const worker = createWorker({
    primary: queue,
    tasks: [ task ]
  })

  await worker.start()

  await trigger(
    queue,
    task,
    {
      type: "user_created",
      email: "foo@bar.com",
    }
  )
}

sandbox().catch(console.error)