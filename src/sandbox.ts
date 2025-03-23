import { rivr } from "./workflow"

const workflow = rivr.workflow<number>("complex-calculation")
    .step({
        name: "add-3",
        handler: ({ state }) => state + 3
    })
    .register(w => {
        return w
            .step({
                name: "add-4",
                handler: ({ state }) => state + 4
            })
    })