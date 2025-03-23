import { rivr } from "./workflow"

const workflow = rivr.workflow<number>("complex-calculation")
    .addHook("onStepCompleted", (w, s) => {})
    .step({
        name: "add-3",
        handler: ({ state }) => state + 3
    })
    .register(w => {
        return w
            .decorate("foo", 4)
            .addHook("onStepCompleted", (workflow, state) => {

            })
            .step({
                name: "add-4",
                handler: ({ state }) => state + 4
            })
    })

console.log(Object.getPrototypeOf(workflow))

console.log(Array.from(workflow.getHook("onStepCompleted")))