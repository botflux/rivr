# Rivr (Work in progress, not published yet)

Rivr is a TypeScript/JavaScript library for managing asynchronous workflows in a simple and efficient way. Unlike traditional systems that rely on message queues, Rivr uses standard databases (such as MongoDB) to manage task queues and workflow states.

## Features

- **Asynchronous workflows**: Define workflows composed of multiple steps.
- **State management**: Automatically track workflow states in a database.
- **Custom hooks**: Add hooks to react to specific events in the workflow lifecycle.
- **Easy integration**: Compatible with databases like MongoDB.
- **Extensible**: Add your own steps and handlers to meet specific needs.

## Core concepts

- **Workflow**: A sequence of steps that define a process.
- **Step**: A single unit of work within a workflow.
- **Engine**: The core component that manages the execution of workflows and their steps. This is the database-specific component.

## Installation

```bash
npm install rivr
```

## Example

### Creating a workflow

A rivr workflow is a collection of step executed in sequence.

```typescript
import { rivr } from "rivr"

const workflow = rivr.workflow<number>("computation")
  .step({
    name: "add-4",
    handler: ({ state }) => state + 4
  })
  .step({
    name: "multiply-by-5",
    handler: ({ state }) => state * 5
  })
  .step({
    name: "format-result",
    handler: ({ state }) => `Result is '${state}'`
  })
```

Once the workflow is created, you need an engine to run the workflow.
Engines are facade that allows to create:
- **triggers** allow you to, well, trigger workflows. They are the producers in Kafka terms.
- **workers** execute the actual workflows. They are the consumers in Kafka terms.

> Engines implementation are database/messaging system specific.

```typescript
import { createEngine } from "@rivr/engine-mongodb"

const engine = createEngine({
  url: "mongo://localhost:27017",
  dbName: "my-db"
})

// As mentionned before, workers executes the actual workflow that 
// were triggered.
const worker = engine.createWorker()
await worker.start([ workflow ])

// On the other hand, triggers start workflow executions.
const trigger = engine.getTrigger()
await trigger.trigger(workflow, 5)
```

### MongoDB engine

```shell
npm i @rivr/mongodb
```

### Fastify integration

You can integrate Rivr to your fastify project thanks to the fastify rivr plugin.

```shell
npm i @rivr/fastify
```

#### Quick example

```typescript
import { fastify } from "fastify"
import { rivr } from "rivr"
import { createEngine } from "@rivr/mongodb"
import { fastifyRivr } from "@rivr/fastify"

const myWorkflow = rivr.workflow<number>("my-workflow")
  .step({
    name: "add-1",
    handler: ({ state }) => state + 1
  })

const app = fastify()
  .register(fastifyRivr, {
    engine: createEngine({
      uri: "mongodb://localhost:27017",
      dbName: "my-db",
    }),
    workflows: [ myWorkflow ]
  })

app.route({
  method: "GET",
  url: "/",
  handler: async (req, res) => {
    await app.rivr.getTrigger().trigger(myWorkflow, 10)
  }
})

await app.listen({
  host: "0.0.0.0",
  port: 3000
})
```

#### Fastify plugin options

```typescript
export type FastifyRivrOpts<TriggerOpts extends Record<never, never>> = {
  /**
   * An engine instance that will be used to create the trigger and worker.
   */
  engine: Engine<TriggerOpts>
  /**
   * Workflows to be started by the worker.
   */
  workflows: Workflow<any, any>[]
}
```


