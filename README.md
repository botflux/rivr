# Rivr

An async workflow library that sits on top of your project's database.

With Rivr, you can create async workflows without introducing a complex messaging system
such as Kafka, or RabbitMQ.

Rivr also provide a nice, high-level abstraction to execute complex async workflow.

Because Rivr is built on top of your data&base, you can trigger workflow, and persist your domain data using the 
same transaction.

# Quick start

Rivr decouples your workflow from the engine (the DB abstraction) it runs on top.
The following example shows a workflow made of three steps, each executed one after the other.

```typescript
import { rivr } from "rivr"
import { createEngine } from "@rivr/engine-mongodb"

const workflow = rivr.workflow<number>("complex-calculation")
  .step({
    name: "add-3",
    handler: ({ state }) => state + 3
  })
  .step({
    name: "multiply-by-4",
    handler: ({ state }) => state * 4
  })
  .step({
    name: "save-result",
    handler: async ({ state }) => await saveResultInDb(state) 
  })

const engine = createEngine({
  url: "mongo://localhost",
  dbName: "my-db",
})

// starts an infinite loop that will pull new workflow tasks periodically.
await engine.createWorker().start([ workflow ])

// trigger the workflow with the start value 10.
await engine.createTrigger().trigger(workflow, 10)
```