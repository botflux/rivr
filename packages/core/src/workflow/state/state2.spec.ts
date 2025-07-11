import { describe, test } from "node:test"
import {rivr} from "../workflow";
import {randomUUID} from "crypto";
import * as assert from "node:assert";
import {StepResult, Workflow} from "../types";

type WorkflowStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress" | "not_started_yet"

type StepStatus =  "skipped" | "to_be_retried" | "not_ran_yet" | "in_progress" | "successful" | "failed"

type StepRun = {
  name: string
  status: StepStatus
  inputState?: unknown
  outputState?: unknown
}

type WorkflowRun = {
  status: WorkflowStatus
  id: number
  steps: StepRun[]
}

type NormalizedWorkflowState = {
  id: string
  workflowName: string
  lastModified: Date
  runs: WorkflowRun[]
}

class WorkflowState {
  #state: NormalizedWorkflowState

  constructor(state: NormalizedWorkflowState) {
    this.#state = state;
  }

  static fromInitialStep<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName>(
    workflow: Workflow<State, FirstState, StateByStepName, Record<never, never>>,
    name: Name,
    state: StateByStepName[Name],
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
      runs: [
        {
          id: 1,
          status: "not_started_yet",
          steps: [
            ...stepsBeforeStartingStep.map(s => ({ name: s.name, status: "skipped" as const })),
            ...otherSteps.map(s => ({ name: s.name, status: "not_ran_yet" as const })),
          ]
        }
      ]
    })
  }

  normalize (): NormalizedWorkflowState {
    return this.#state
  }

  startProcessing(runId: number, stepName: string, inputState: unknown, now: Date): [newState: WorkflowState, run: WorkflowRun, step: StepRun] {
    const run = this.#state.runs.find(run => run.id === runId)

    if (!run) {
      throw new Error(`There is no run matching id '${runId}' in workflow state '${this.#state.id}'`)
    }

    const step = run.steps.find(step => step.name === stepName)

    if (!step) {
      throw new Error(`There is no step '${stepName}' in run '${runId}' of workflow '${this.#state.id}'`)
    }

    const newStep: StepRun = {
      ...step,
      status: "in_progress",
      inputState
    }

    const newRun: WorkflowRun = {
      ...run,
      status: "in_progress",
      steps: run.steps.map(step => step.name === newStep.name ? newStep : step)
    }

    const newWorkflow: NormalizedWorkflowState = {
      ...this.#state,
      runs: this.#state.runs.map(run => run.id === newRun.id ? newRun : run)
    }

    return [
      new WorkflowState(newWorkflow),
      newRun,
      newStep
    ]
  }

  updateRunFromStepResult(runId: number, stepName: string, result: StepResult<unknown>): [ newState: WorkflowState ] {
    const run = this.#state.runs.find(run => run.id === runId)

    if (!run) {
      throw new Error(`There is no run matching id '${runId}' in workflow state '${this.#state.id}'`)
    }

    const step = run.steps.find(step => step.name === stepName)

    if (!step) {
      throw new Error(`There is no step '${stepName}' in run '${runId}' of workflow '${this.#state.id}'`)
    }

    if (step.status !== "in_progress") {
      throw new Error(`Cannot update run '${stepName}' because it is not in progress`)
    }

    if (result.type !== "success") {
      throw new Error("Not implemented at line 125 in state2.spec.ts")
    }

    const newStep: StepRun = {
      ...step,
      status: "successful",
      outputState: result.state
    }

    const newRun: WorkflowRun = {
      ...run,
      status: "successful",
      steps: run.steps.map(step => step.name === newStep.name ? newStep : step)
    }
    const newWorkflow: NormalizedWorkflowState = {
      ...this.#state,
      runs: this.#state.runs.map(run => run.id === newRun.id ? newRun : run)
    }

    return [new WorkflowState(newWorkflow)]
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
      5,
      id,
      now
    )

    // Then
    assert.deepStrictEqual(state.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      runs: [
        {
          id: 1,
          status: "not_started_yet",
          steps: [
            {
              name: "add-1",
              status: "not_ran_yet",
            }
          ]
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
      5,
      id,
      now
    )

    // Then
    assert.deepStrictEqual(state.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      runs: [
        {
          id: 1,
          status: "not_started_yet",
          steps: [
            {
              name: "add-1",
              status: "skipped"
            },
            {
              name: "minus-2",
              status: "not_ran_yet",
            },
            {
              name: "add-4",
              status: "not_ran_yet",
            }
          ]
        }
      ],
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
      5,
      id,
      now
    )
    const [ newState ] = state.startProcessing(1, "add-1", 4, now)

    // Then
    assert.deepStrictEqual(newState.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      runs: [
        {
          id: 1,
          status: "in_progress",
          steps: [
            {
              name: "add-1",
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

    const [state, run, step] = WorkflowState.fromInitialStep(
      workflow,
      "add-1",
      5,
      id,
      now
    ).startProcessing(1, "add-1", 4, now)

    // When
    const [ newState ] = state.updateRunFromStepResult(run.id, step.name, { type: "success", state: 9 })

    // Then
    assert.deepStrictEqual(newState.normalize(), {
      id,
      lastModified: now,
      workflowName: workflow.name,
      runs: [
        {
          id: 1,
          status: "successful",
          steps: [
            {
              name: "add-1",
              status: "successful",
              inputState: 4,
              outputState: 9
            }
          ]
        }
      ]
    })
  })
})