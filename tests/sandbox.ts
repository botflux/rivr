import { MongoClient } from "mongodb"
import { MongoDBWorkflowEngine } from "../src/mongodb/mongodb-workflow-engine"
import {failure, success, Workflow} from "../src/workflow"
import { setTimeout } from "timers/promises"
import {linear} from "../src/retry";

const abort = new AbortController()

async function start () {
    const client = new MongoClient("mongodb://root:example@localhost:27017")

    abort.signal.addEventListener("abort", () => client.close(true).catch(console.error))

    const engine = MongoDBWorkflowEngine.create({
        client,
        dbName: "my-db",
    })

    let val = undefined

    // const workflow = Workflow.create<number>("workflow", w => {
    //     w.step("add_2", s => success(s + 2))
    //     w.step("multiply_by_4", s => s * 4)
    //     w.step("assign", s => val = s)
    // })

    const workflow = Workflow.create<number>("workflow", w => {
        w.step("add-5", s => {
            console.log("add 5")

            return s + 5
        })
        w.step("multiply-by-attempt", (s, { attempt }) => {
            console.log("multiple-by-attempt")

            return attempt === 1
              ? failure(new Error("oops"), { retry: linear(1_000) })
              : success(s * attempt)
        })
        w.step("assign", s => {
            console.log("assign")
            val = s
        })
    })


    await engine.start(workflow, { signal: abort.signal })
    
    const trigger = await engine.getTrigger(workflow)

    await trigger.trigger(3)

    while (val === undefined) {
        console.log("waiting for val to be defined")
        await setTimeout(300)
    }

    console.log(val)

    abort.abort()
}

start().catch(console.error)