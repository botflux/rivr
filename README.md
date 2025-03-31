# Rivr

An async job/workflow library that sits on top of your project's database.

With Rivr, you can create async jobs and workflows without having to introduce 
a queueing system in your deployment.

Also, Rivr allows you to trigger async tasks, and persist your domain data using the 
same transaction.

```typescript
import { rivr } from "rivr"

const workflow = rivr.workflow<number>()
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
```