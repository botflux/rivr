import { test } from "node:test"
import assert from "node:assert"
import { Workflow } from "../src/workflow"
import { TriggerInterface } from "../src/trigger.interface"

class TestTrigger<State> implements TriggerInterface<State> {
    constructor(
        private readonly workflow: Workflow<State>
    ) {}
    
    async trigger(state: State): Promise<void> {
        let currentState = state

        for (const step of this.workflow.getSteps()) {
            currentState = (await step.handler(currentState)) ?? currentState 
        }
    }
}

class TestWorkflow<State> {
    private constructor(
        private readonly workflow: Workflow<State>
    ) {}

    getTrigger(): TriggerInterface<State> {
        return new TestTrigger(this.workflow)
    }

    static create<State>(workflow: Workflow<State>): TestWorkflow<State> {
        return new TestWorkflow(workflow)
    }
}

test("sync workflow", async function (t) {
    await t.test("should be able to create a workflow composed of a step", async function () {
        // Given
        let myValue = undefined

        const workflow = Workflow.create<number>("my-workflow", w => {
            w.step("dummy", (state) => {
                myValue = state
            })
        })

        const manager = TestWorkflow.create(workflow)
        const trigger = manager.getTrigger()

        // When
        await trigger.trigger(2)

        // Then
        assert.equal(myValue, 2)
    })

    await t.test("should be able to execute a workflow composed of multiple steps", async function () {
        // Given
        let result = undefined

        const workflow = Workflow.create<number>("my-workflow", w => {
            w.step("add 1", s => s + 1)
            w.step("multiply by 4", s => s * 4)
            w.step("divide by 2", s => s / 2)
            w.step("assign value", s => {
                result = s
            })
        })

        const manager = TestWorkflow.create(workflow)
        const trigger = manager.getTrigger()

        // When
        await trigger.trigger(5)

        // Then
        assert.equal(result, ((5 + 1) * 4) / 2)
    })

    await t.test("should be able to execute steps asynchronously", async function () {
        // Given
        let result = undefined

        const workflow = Workflow.create<number>("some-workflow", w => {
            w.step("add_4_async", async s => s + 3)
            w.step("multiply_by_5_async", async s => s * 5)
            w.step("assignation", async s => result = s)
        })

        const manager = TestWorkflow.create(workflow)
        const trigger = manager.getTrigger()

        // When
        await trigger.trigger(7)

        // Then
        assert.equal(result, (7 + 3) * 5)
    })
})