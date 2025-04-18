// const proto = {
//   a: 1,
//   printA() {
//     console.log(this.a)
//   }
// }
//
// const obj = {
//   a: 2
// }
// Object.setPrototypeOf(obj, proto)
//
// // @ts-expect-error
// obj.printA()

import {rivr} from "./workflow.ts";

async function start() {
  const workflow = await rivr.workflow<number>("foo")
    .addHook("onWorkflowCompleted", (w) => {})
    .step({
      name: "add-1",
      handler: ({ state }) => state + 1
    })
    .register(w => w
      .decorate("foo", 2)
      .step({
        name: "sub-2",
        handler: ({state, workflow}) => state - workflow.foo
      }))
    .step({
      name: "multiply-by-2",
      handler: ({ state }) => state * 2
    })
    .ready()

  // @ts-expect-error
  console.log(workflow.globalList)
}

start().catch(console.error)