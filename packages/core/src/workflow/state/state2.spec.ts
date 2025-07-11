import { describe, test } from "node:test"
import {rivr} from "../workflow";
import {randomUUID} from "crypto";
import * as assert from "node:assert";
import {StepResult, Workflow} from "../types";
import {AttemptStatus} from "./state";

type WorkflowStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress" | "not_started_yet"

type StepStatus =  "skipped" | "to_be_retried" | "not_ran_yet" | "in_progress" | "successful" | "failed"

type Attempt = {
  id: number
  status: StepStatus
  inputState?: unknown
  result?: StepResult<unknown>
}

type StepRun = {
  name: string
  attempts: Attempt[]
}

type NormalizedWorkflowState = {
  id: string
  workflowName: string
  lastModified: Date
  status: WorkflowStatus
  steps: StepRun[]
}

class WorkflowState {
  #state: NormalizedWorkflowState

  constructor(state: NormalizedWorkflowState) {
    this.#state = state;
  }

  static fromInitialStep<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName>(
    workflow: Workflow<State, FirstState, StateByStepName, Record<never, never>>,
    name: Name,
    id: string ,
    now: Date
  ): WorkflowState {
    const steps = Array.from(workflow.steps()).map(step => step.item)
    const startingStepIndex = steps.findIndex(s => s.name === name)
    const stepsBeforeStartingStep = steps.slice(0, startingStepIndex)
    const otherSteps = steps.slice(startingStepIndex)

    return new WorkflowState({
      id,
      workflowName: workflow.name,
      lastModified: now,
      status: "not_started_yet",
      steps: [
        ...stepsBeforeStartingStep.map(step => ({
          name: step.name,
          attempts: [
            {
              id: 1,
              status: "skipped" as const,
            }
          ]
        })),
        ...otherSteps.map(step => ({
          name: step.name,
          attempts: []
        })),
      ]
    })
  }

  normalize (): NormalizedWorkflowState {
    return this.#state
  }

  startProcessing(stepName: string, inputState: unknown, now: Date): [newState: WorkflowState, step: StepRun, inProgress: Attempt] {
    const step = this.#state.steps.find(step => step.name === stepName)

    if (!step) {
      throw new Error(`There is no step '${stepName}' in run '${this.#state.id}'`)
    }

    const attempt: Attempt = {
      id: 1,
      status: "in_progress",
      inputState
    }

    const newStep: StepRun = {
      ...step,
      attempts: [ attempt ]
    }

    const newWorkflow: NormalizedWorkflowState = {
      ...this.#state,
      status: "in_progress",
      steps: this.#state.steps.map(step => step.name === newStep.name ? newStep : step),
    }

    return [
      new WorkflowState(newWorkflow),
      newStep,
      attempt
    ]
  }

  updateRun(stepName: string, attemptId: number, result: StepResult<unknown>): [ newState: WorkflowState ] {
    const step = this.#state.steps.find(step => step.name === stepName)

    if (!step) {
      throw new Error(`There is no step '${stepName}' of workflow '${this.#state.id}'`)
    }

    const attempt = step.attempts.find(a => a.id === attemptId)

    if (!attempt) {
      throw new Error("Not implemented at line 112 in state2.spec.ts")
    }

    if (attempt.status !== "in_progress") {
      throw new Error(`Cannot update run '${stepName}' because it is not in progress`)
    }

    const newAttempt: Attempt = {
      ...attempt,
      result,
      status: this.#stepResultToAttemptStatus(result),
    }

    const newStep: StepRun = {
      ...step,
      attempts: step.attempts.map(attempt => attempt.id === attemptId ? newAttempt : attempt),
    }

    const newWorkflow: NormalizedWorkflowState = {
      ...this.#state,
      status: newAttempt.status === "successful" ? "successful" : "failed",
      steps: this.#state.steps.map(step => step.name === newStep.name ? newStep : step),
    }

    return [new WorkflowState(newWorkflow)]
  }

  #stepResultToAttemptStatus(result: StepResult<unknown>): StepStatus {
    switch (result.type) {
      case "success": return "successful"
      case "failure": return "failed"
      case "skipped": return "skipped"
      case "stopped": return "skipped"
    }
  }
}

describe('workflow state', function () {
  test("should be able to create a workflow state", (t) => {
    // Given
    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: opts => opts.state + 1
      })

    const id = randomUUID()
    const now = new Date()

    // When
    const state = WorkflowState.fromInitialStep(
      workflow,
      "add-1",
      id,
      now
    )

    // Then
    assert.deepStrictEqual(state.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      status: "not_started_yet",
      steps: [
        {
          name: "add-1",
          attempts: []
        }
      ]
    })
  })

  test("should be able to create a workflow state from a specific step", (t) => {
    // Given
    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: opts => opts.state + 1
      })
      .step({
        name: "minus-2",
        handler: opts => opts.state - 2
      })
      .step({
        name: "add-4",
        handler: opts => opts.state + 4
      })

    const id = randomUUID()
    const now = new Date()

    // When
    const state = WorkflowState.fromInitialStep(
      workflow,
      "minus-2",
      id,
      now
    )

    // Then
    assert.deepStrictEqual(state.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      status: "not_started_yet",
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
          name: "minus-2",
          attempts: []
        },
        {
          name: "add-4",
          attempts: [],
        }
      ]
    })
  })

  test("should be able to report a step processing' start", (t) => {
    // Given
    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: opts => opts.state + 1
      })

    const id = randomUUID()
    const now = new Date()

    // When
    const state = WorkflowState.fromInitialStep(
      workflow,
      "add-1",
      id,
      now
    )
    const [ newState ] = state.startProcessing("add-1", 4, now)

    // Then
    assert.deepStrictEqual(newState.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      status: "in_progress",
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
        }
      ]
    })
  })

  test("should be able to report a step's success", (t) => {
    // Given
    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: opts => opts.state + 1
      })

    const id = randomUUID()
    const now = new Date()

    const [state, step, attempt] = WorkflowState.fromInitialStep(
      workflow,
      "add-1",
      id,
      now
    ).startProcessing("add-1", 4, now)

    // When
    const [ newState ] = state.updateRun(step.name, attempt.id, { type: "success", state: 9 })

    // Then
    assert.deepStrictEqual(newState.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      status: "successful",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "successful",
              inputState: 4,
              result: { type: "success", state: 9 }
            }
          ]
        }
      ]
    })
  })

  test("should be able to report a step's failure", (t) => {
    // Given
    const workflow = rivr.workflow<number>("calc")
      .step({
        name: "add-1",
        handler: opts => opts.state + 1
      })

    const id = randomUUID()
    const now = new Date()

    const [ state, step, attempt ] = WorkflowState.fromInitialStep(
      workflow,
      "add-1",
      id,
      now
    ).startProcessing("add-1", 4, now)

    // When
    const [ newState ] = state.updateRun(step.name, attempt.id, { type: "failure", error: "oops" })

    // Then
    assert.deepStrictEqual(newState.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      status: "failed",
      steps: [
        {
          name: "add-1",
          attempts: [
            {
              id: 1,
              status: "failed",
              inputState: 4,
              result: { type: "failure", error: "oops" }
            }
          ]
        }
      ]
    })
  })
})