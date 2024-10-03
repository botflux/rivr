import { MongoClient } from "mongodb"
import { MongoDBWorkflowEngine } from "../src/mongodb/mongodb-workflow-engine"
import { Workflow } from "../src/workflow"
import { setTimeout } from "timers/promises"

const abort = new AbortController()

async function start () {
    const client = new MongoClient("mongodb://root:example@localhost:27017")

    abort.signal.addEventListener("abort", () => client.close(true).catch(console.error))

    const engine = MongoDBWorkflowEngine.create({
        client,
        dbName: "my-db",
    })

    let val = undefined

    const workflow = Workflow.create<number>("workflow", w => {
        w.step("add_2", s => s + 2)
        w.step("multiply_by_4", s => s * 4),
        w.step("assign", s => val = s)
    })

    await engine.start(workflow, { signal: abort.signal })
    
    const trigger = await engine.getTrigger(workflow)

    await trigger.trigger(3)

    while (val === undefined) {
        console.log("waiting for val to be defined")
        await setTimeout(300)
    }

    console.log(val)
}

start().catch(console.error)