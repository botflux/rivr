import {Step, StepResult, Workflow} from "./types.ts";
import {randomUUID} from "crypto";

export type AttemptStatus = "successful" | "failed" | "skipped" | "stopped"

export type Attempt = {
  id: number
  status: AttemptStatus
}

export type StepState = {
  name: string
  attempts: Attempt[]
}

export type WorkflowStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress"

export type Task<State> = {
  status: "todo" | "done"
  step: string
  state: State
  attempt: number
  areRetryExhausted: boolean
  pickAfter?: Date
}

export type WorkflowState<State> = {
  id: string
  name: string
  toExecute: Task<State>
  status: WorkflowStatus
  steps: StepState[]
}

export function createWorkflowState<State>(workflow: Workflow<State, Record<never, never>>, state: State, id: string = randomUUID()): WorkflowState<State> {
  const [ mFirst, ...rest ] = Array.from(workflow.steps()).map(([ step ]) => step)

  if (mFirst === undefined) {
    throw new Error("Cannot create a workflow state from an empty workflow.")
  }

  return {
    name: workflow.name,
    id,
    status: "in_progress",
    toExecute: {
      state,
      status: "todo",
      step: mFirst.name,
      attempt: 1,
      areRetryExhausted: false
    },
    steps: [
      {
        name: mFirst.name,
        attempts: []
      },
      ...rest.map(step => ({
        name: step.name,
        attempts: []
      }))
    ]
  }
}

export function updateWorkflowState<State>(state: WorkflowState<State>, step: Step<State, any>, result: StepResult<State>, now = new Date()): WorkflowState<State> {
  const stepStateIndex = state.steps.findIndex(s => s.name === step.name)
  const stepState = state.steps[stepStateIndex]
  
  if (stepStateIndex === -1) {
    throw new Error("Not implemented at line 54 in state.ts")
  }

  const attemptId = stepState.attempts.length + 1
  const attemptStatus = resultToAttemptStatus(result)
  const newAttempt = { id: attemptId, status: attemptStatus } satisfies Attempt

  const updatedSteps = state.steps.with(stepStateIndex, { ...stepState, attempts: [ ...stepState.attempts, newAttempt ] })

  const [nextTask, newStatus] = getNextTask(state, step, result, now)

  return {
    ...state,
    steps: updatedSteps,
    status: newStatus,
    toExecute: nextTask
  }
}

function resultToAttemptStatus (result: StepResult<unknown>): AttemptStatus {
  switch (result.type) {
    case "success": return "successful"
    case "failure": return "failed"
    case "skipped": return "skipped"
    case "stopped": return "stopped"
  }
}

/**
 * Return the next task from the current workflow state and step result.
 *
 * @param state
 * @param step
 * @param result
 * @param now
 */
function getNextTask<State>(state: WorkflowState<State>, step: Step<State, unknown>, result: StepResult<State>, now: Date): [Task<State>, WorkflowStatus] {
  const { delayBetweenAttempts: delayFnOrNumber, maxAttempts, optional } = step
  const currentStepIndex = state.steps.findIndex(s => s.name === step.name)

  if (currentStepIndex === -1) {
    throw new Error("Cannot find the step")
  }

  const mNextStep = currentStepIndex + 1 >= state.steps.length
    ? undefined
    : state.steps[currentStepIndex + 1]

  switch (result.type) {
    case "skipped":
    case "success": {
      if (mNextStep === undefined) {
        return [
          {
            ...state.toExecute,
            status: "done",
          },
          "successful"
        ]
      }

      const nextState = result.type === "skipped"
        ? state.toExecute.state
        : result.state

      return [
        {
          status: "todo",
          step: mNextStep.name,
          state: nextState,
          attempt: 1,
          areRetryExhausted: false
        },
        "in_progress"
      ]
    }

    case "stopped": {
      return [
        {
          ...state.toExecute,
          status: "done",
        },
        "stopped"
      ]
    }

    case "failure": {
      const areRetryExhausted = maxAttempts < state.toExecute.attempt + 1

      if (areRetryExhausted && optional) {
        if (mNextStep === undefined) {
         return [
           {
             ...state.toExecute,
             status: "done"
           },
           "successful"
         ]
        }

        return [
          {
            status: "todo",
            attempt: 1,
            areRetryExhausted: false,
            state: state.toExecute.state,
            step: mNextStep.name,
          },
          "in_progress"
        ]
      }

      if (areRetryExhausted) {
        return [
          {
            ...state.toExecute,
            status: "done",
            areRetryExhausted,
          },
          "failed"
        ]
      }

      const delayBetweenAttempts = typeof delayFnOrNumber === "number"
        ? () => delayFnOrNumber
        : delayFnOrNumber

      const retryAfter = new Date(now.getTime() + delayBetweenAttempts(state.toExecute.attempt + 1))

      return [
        {
          ...state.toExecute,
          attempt: state.toExecute.attempt + 1,
          areRetryExhausted,
          pickAfter: retryAfter,
        },
        "in_progress"
      ]
    }
  }
}
