import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {rivr} from "../workflow";
import {WorkflowState} from "./state";
import {omit} from "../../utils/omit";
import {uuidv7} from "uuidv7";

describe('state', function () {
  test("should be able to create a workflow state", async () => {
    // Given
    const id = uuidv7()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state
      })

    await workflow.ready()

    // When
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)

    // Then
    assert.deepStrictEqual(state.toNormalized(), {
      id,
      name: "calc",
      status: "in_progress",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "to_execute",
              inputState: 1
            }
          ]
        }
      ],
      lastModified: now
    })
  })

  test("should be able to mark a step as 'in_progress'", async () => {
    // Given
    const id = uuidv7()
    const now = new Date()

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
    const state = WorkflowState
      .initialize(workflow, "add-1", 1, id, now)
      .startProcessing(now)

    // Then
    assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
      id,
      name: "calc",
      status: "in_progress",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "in_progress",
              inputState: 1
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ],
    })
  })

  test("should be able to update based on a successful result", async () => {
    // Given
    const id = uuidv7()
    const now = new Date()

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
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing(now)
      .updateFromStepResult(step, { type: "success", state: 2 }, now)

    // Then
    assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
      id,
      name: "calc",
      status: "in_progress",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "successful",
              inputState: 1,
              result: {
                state: 2,
                type: "success"
              }
            }
          ]
        },
        {
          name: "add-6",
          attempts: [
            {
              id: 1,
              status: "to_execute",
              inputState: 2
            }
          ]
        }
      ],
    })
  })

  test("should be able to end the workflow state", async () => {
    const id = uuidv7()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1
      })

    await workflow.ready()

    // When
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing(now)
      .updateFromStepResult(step, { type: "success", state: 2 }, now)

    // Then
    assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
      id,
      name: "calc",
      status: "successful",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "successful",
              inputState: 1,
              result: {
                type: "success",
                state: 2
              }
            }
          ]
        },
      ],
    })
  })

  test("should be able to stop a workflow", async () => {
    // Given
    const id = uuidv7()
    const now = new Date()

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
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing(now)
      .updateFromStepResult(step, { type: "stopped" }, now)

    // Then
    assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
      id,
      name: "calc",
      status: "stopped",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "stopped",
              inputState: 1,
              result: {
                type: "stopped"
              }
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ],
    })
  })

  test("should be able to retry a failed workflow", async () => {
    // Given
    const id = uuidv7()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1,
        maxAttempts: 2
      })

    await workflow.ready()

    const error = new Error("oops")

    // When
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing(now)
      .updateFromStepResult(step, { type: "failure", error }, now)

    // Then
    assert.deepStrictEqual(state.toNormalized(), {
      id,
      name: "calc",
      status: "in_progress",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
              inputState: 1,
              result: {
                type: "failure",
                error: {
                  name: error.name,
                  message: error.message,
                  stack: error.stack
                }
              }
            },
            {
              id: 2,
              status: "to_execute",
              inputState: 1
            }
          ]
        },
      ],
      lastModified: now
    })
  })

  test("should be able to stop a workflow if the step's attempts are exhausted", async () => {
    // Given
    const id = uuidv7()
    const now = new Date()

    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: ({ state }) => state + 1,
        maxAttempts: 1
      })

    await workflow.ready()

    const error = new Error("oops")

    // When
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing(now)
      .updateFromStepResult(step, { type: "failure", error }, now)

    // Then
    assert.deepStrictEqual(state.toNormalized(), {
      id,
      name: "calc",
      status: "failed",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
              inputState: 1,
              result: {
                type: "failure",
                error: {
                  name: "Error",
                  message: error.message,
                  stack: error.stack
                }
              }
            }
          ]
        },
      ],
      lastModified: now
    })
  })
})