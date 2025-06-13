import {createPlugin} from "./extension/plugins/base";

const a = createPlugin({
  name: "a",
  handler: instance => instance.decorate("a", 10)
})

const b = createPlugin({
  name: "b",
  deps: [ a ],
  handler: instance => {
    return instance.decorate("b", 1 + instance.a)
    // return instance
  }
})

const c = createPlugin({
  name: "c",
  handler: instance => {
    return instance.decorate("c", 4)
  }
})

const d = createPlugin({
  name: "d",
  deps: [ b, c ],
  handler: instance => instance.decorate("d", instance.c + instance.b)
})
