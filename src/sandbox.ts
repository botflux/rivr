import { rivr } from "./workflow"

const workflow = rivr.workflow<number>("complex-calculation")
.step({
    name: "divide-by-2",
    handler: ({ state }) => state / 2
})
.register(workflow => workflow
    .decorate("add", (x: number, y: number) => x + y)
    .step({
        name: "add-3",
        handler: ({ state, workflow }) => workflow.add(state, 3)
    })
)
.step({
    name: "multiply-by-2",
    handler: ({ state }) => state * 2
})

// console.log("obj", workflow)
// console.log("proto 1", Object.getPrototypeOf(workflow))
// console.log("proto 2", Object.getPrototypeOf(Object.getPrototypeOf(workflow)))

// workflow.getFirstStep()

console.log(workflow.getFirstStep())
console.log(workflow.getStep("add-3"))
console.log(workflow.getNextStep("add-3"))
console.log(Array.from(workflow.steps()))
// console.log(workflow.graph)

