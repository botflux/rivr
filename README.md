# Rivr

Rivr is a workflow management library that sits on top on your project's database.

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