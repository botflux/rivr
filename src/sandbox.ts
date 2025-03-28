import {rivrPlugin} from "./plugin.ts";
import {rivr} from "./workflow.ts";

const pluginA = rivrPlugin((w) => w.decorate("foo", 1), [])
const pluginB = rivrPlugin(w => w.decorate("bar", w.foo + 1), [ pluginA ])

let state: number | undefined

const workflow = rivr.workflow<number>("complex-calculation")
  .register(pluginA)
  .register(pluginB)
  .step({
    name: "add-bar",
    handler: ({ state, workflow }) => state + workflow.bar
  })
  .addHook("onWorkflowCompleted", (w, s) => {
    state = s
  })
