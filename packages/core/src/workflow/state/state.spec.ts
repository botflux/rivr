import {describe, test, TestContext} from "node:test";
import {rivr} from "../workflow";
import {WorkflowState} from "./state";
import {randomUUID} from "crypto";
import {omit} from "../../utils/omit";

describe('state', function () {
  test("should be able to create a workflow state", async (t: TestContext) => {
    // Given
    const id = randomUUID()
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
    t.assert.deepStrictEqual(state.toNormalized(), {
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
      ],
      lastModified: now
    })
  })

  test("should be able to mark a step as 'in_progress'", async (t: TestContext) => {
    // Given
    const id = randomUUID()
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
      .startProcessing("add-1", 4, now)

    // Then
    t.assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
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
          attempts: [
            {
              id: 1,
              status: "in_progress",
              inputState: 4
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

  test("should be able to update based on a successful result", async (t: TestContext) => {
    // Given
    const id = randomUUID()
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
      .startProcessing(step.name, 4, now)
      .updateFromStepResult(step, { type: "success", state: 2 }, now)

    // Then
    t.assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
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
              inputState: 4
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

  test("should be able to end the workflow state", async (t: TestContext) => {
    const id = randomUUID()
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
      .startProcessing("add-1", 4, now)
      .updateFromStepResult(step, { type: "success", state: 2 }, now)

    // Then
    t.assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
      id,
      name: "calc",
      status: "successful",
      result: 2,
      toExecute: {
        state: 2,
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
              inputState: 4
            }
          ]
        },
      ],
    })
  })

  test("should be able to skip a step", async (t: TestContext) => {
    // Given
    const id = randomUUID()
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
      .startProcessing("add-1", 4, now)
      .updateFromStepResult(step, { type: "skipped" }, now)

    // Then
    t.assert.deepStrictEqual(state.toNormalized(), {
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
              inputState: 4
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ],
      lastModified: now
    })
  })

  test("should be able to stop a workflow", async (t: TestContext) => {
    // Given
    const id = randomUUID()
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
      .startProcessing("add-1", 4, now)
      .updateFromStepResult(step, { type: "stopped" }, now)

    // Then
    t.assert.deepStrictEqual(omit(state.toNormalized(), [ "lastModified" ]), {
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
              inputState: 4
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
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing(step.name, 4, now)
      .updateFromStepResult(step, { type: "failure", error: new Error("oops") }, now)

    // Then
    t.assert.deepStrictEqual(state.toNormalized(), {
      id,
      name: "calc",
      status: "in_progress",
      toExecute: {
        state: 1,
        status: 'todo',
        step: "add-1",
        attempt: 2,
        areRetryExhausted: false,
      },
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
              inputState: 4
            }
          ]
        },
      ],
      lastModified: now
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
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing("add-1", 4, now)
      .updateFromStepResult(step, { type: "failure", error: new Error("oops") }, now)

    // Then
    t.assert.deepStrictEqual(state.toNormalized(), {
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
              inputState: 4
            }
          ]
        },
      ],
      lastModified: now
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
    const { item: step } = workflow.getStepByName("add-1")!
    const state = WorkflowState.initialize(workflow, "add-1", 1, id, now)
      .startProcessing("add-1", 4, now)
      .updateFromStepResult(step, { type: "failure", error: new Error("oops") }, now)

    // Then
    t.assert.deepStrictEqual(state.toNormalized(), {
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
              inputState: 4
            }
          ]
        },
        {
          name: "add-6",
          attempts: []
        }
      ],
      lastModified: now
    })
  })
})