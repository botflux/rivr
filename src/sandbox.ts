import { rivr } from "./workflow"

const workflow = rivr.workflow<number>("complex-calculation")
    .addHook("onStepCompleted", (w, s, state) => {
        stepCompletedStates.push(state)
    })
    .addHook("onWorkflowCompleted", )
    .step({
        name: "add-3",
        handler: ({ state }) => state + 3
    })
    .register(w => {
        return w
            .addHook("onStepCompleted", (w, s, state) => {
                stepCompletedStates.push(state)
            })
            .step({
                name: "add-4",
                handler: ({ state }) => state + 4
            })
    })