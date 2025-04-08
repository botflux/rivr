import {describe, test, TestContext} from "node:test";
import {rivr} from "./workflow.ts";
import {createWorkflowState, updateWorkflowState} from "./state.ts";
import {randomUUID} from "crypto";

describe('state', function () {
  test("should be able to create a workflow state", async (t: TestContext) => {
    // Given
    const id = randomUUID()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state
      })

    await workflow.ready()

    // When
    const state = createWorkflowState(workflow, 1, id)

    // Then
    t.assert.deepStrictEqual(state, {
      id,
      name: "calc",
      status: "in_progress",
      toExecute: {
        state: 1,
        status: 'todo',
        step: "add-1",
        attempt: 1,
        areRetryExhausted: false
      },
      steps: [
        {
          name: "add-1",
          attempts: []
        }
      ]
    })
  })

  test("should be able to update based on a successful result", async (t: TestContext) => {
    // Given
    const id = randomUUID()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .step({
        name: "add-6",
        handler: ({ state }) => state + 10
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "success",
      state: 2
    })

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "in_progress",
      toExecute: {
        state: 2,
        status: 'todo',
        step: "add-6",
        attempt: 1,
        areRetryExhausted: false
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "successful",
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ]
    })
  })

  test("should be able to end the workflow state", async (t: TestContext) => {
    const id = randomUUID()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "success",
      state: 2
    })

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "successful",
      toExecute: {
        state: 1,
        status: 'done',
        step: "add-1",
        attempt: 1,
        areRetryExhausted: false
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "successful",
            }
          ]
        },
      ]
    })
  })

  test("should be able to skip a step", async (t: TestContext) => {
    // Given
    const id = randomUUID()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .step({
        name: "add-6",
        handler: ({ state }) => state + 10
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "skipped",
    })

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "in_progress",
      toExecute: {
        state: 1,
        status: 'todo',
        step: "add-6",
        attempt: 1,
        areRetryExhausted: false
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "skipped",
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ]
    })
  })

  test("should be able to stop a workflow", async (t: TestContext) => {
    // Given
    const id = randomUUID()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })
      .step({
        name: "add-6",
        handler: ({ state }) => state + 10
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "stopped",
    })

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "stopped",
      toExecute: {
        state: 1,
        status: 'done',
        step: "add-1",
        attempt: 1,
        areRetryExhausted: false
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "stopped",
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ]
    })
  })

  test("should be able to retry a failed workflow", async (t: TestContext) => {
    // Given
    const id = randomUUID()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1,
        maxAttempts: 2
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "failure",
      error: new Error("oops")
    }, now)

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "in_progress",
      toExecute: {
        state: 1,
        status: 'todo',
        step: "add-1",
        attempt: 2,
        areRetryExhausted: false,
        pickAfter: now
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
            }
          ]
        },
      ]
    })
  })

  test("should be able to stop a workflow if the step's attempts are exhausted", async (t: TestContext) => {
    // Given
    const id = randomUUID()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1,
        maxAttempts: 1
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "failure",
      error: new Error("oops")
    }, now)

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "failed",
      toExecute: {
        state: 1,
        status: 'done',
        step: "add-1",
        attempt: 1,
        areRetryExhausted: true,
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
            }
          ]
        },
      ]
    })
  })

  test("should be able to continue if an optional step fails", async (t: TestContext) => {
    // Given
    const id = randomUUID()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1,
        optional: true
      })
      .step({
        name: "add-6",
        handler: ({ state }) => state + 6
      })

    await workflow.ready()

    // When
    const [ step ] = workflow.getStepAndExecutionContext("add-1")!
    const state = createWorkflowState(workflow, 1, id)
    const newState = updateWorkflowState(state, step, {
      type: "failure",
      error: new Error("oops")
    }, now)

    // Then
    t.assert.deepStrictEqual(newState, {
      id,
      name: "calc",
      status: "in_progress",
      toExecute: {
        state: 1,
        status: 'todo',
        step: "add-6",
        attempt: 1,
        areRetryExhausted: false,
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ]
    })
  })
})