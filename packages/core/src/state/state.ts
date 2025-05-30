import {Step, StepResult, Workflow} from "../types";
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
  result?: State
  status: WorkflowStatus
  steps: StepState[]
  lastModified: Date
}

export function createWorkflowState<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName>(
  workflow: Workflow<State, FirstState, StateByStepName, Record<never, never>>,
  name: Name,
  state: StateByStepName[Name],
  id: string = randomUUID(),
  now: Date
): WorkflowState<State> {
  const steps = Array.from(workflow.steps())
    .map(({ item }) => item)
  const index = steps.findIndex((step) => step.name === name)

  if (index === -1) {
    throw new Error("Not implemented at line 46 in state.ts")
  }
  
  const previousSteps = steps.slice(0, index)
  const mStep = steps[index]
  const nextSteps = steps.slice(index + 1)
  
  if (mStep === undefined) {
    throw new Error("Cannot create a workflow state from an empty workflow.")
  }

  return {
    name: workflow.name,
    id,
    status: "in_progress",
    toExecute: {
      state: state as unknown as State,
      status: "todo",
      step: name as string,
      attempt: 1,
      areRetryExhausted: false
    },
    steps: [
      ...previousSteps.map(step => ({
        name: step.name,
        attempts: [
          {
            status: "skipped" as const,
            id: 0
          }
        ]
      })),
      {
        name: mStep.name,
        attempts: []
      },
      ...nextSteps.map(step => ({
        name: step.name,
        attempts: []
      }))
    ],
    lastModified: now
  }
}

export function updateWorkflowState<State>(
  state: WorkflowState<State>,
  step: Step,
  result: StepResult<State>,
  now = new Date()
): WorkflowState<State> {
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
    toExecute: nextTask,
    ...newStatus === "successful" && {
      result: nextTask.state
    },
    lastModified: now
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
function getNextTask<State>(state: WorkflowState<State>, step: Step, result: StepResult<State>, now: Date): [Task<State>, WorkflowStatus] {
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

      const newDelay = delayBetweenAttempts(state.toExecute.attempt + 1)
      const pickAfter = newDelay === 0 ? undefined : new Date(now.getTime() + newDelay)

      return [
        {
          ...state.toExecute,
          attempt: state.toExecute.attempt + 1,
          areRetryExhausted,
          ...pickAfter !== undefined && { pickAfter },
        },
        "in_progress"
      ]
    }
  }
}