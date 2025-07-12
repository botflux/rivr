import {Step, StepResult, Workflow} from "../types";
import {randomUUID} from "crypto";

export type AttemptStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress"

export type Attempt = {
  id: number
  status: AttemptStatus
  inputState?: unknown
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

export type NormalizedWorkflowState<State> = {
  id: string
  name: string
  toExecute: Task<State>
  result?: State
  status: WorkflowStatus
  steps: StepState[]
  lastModified: Date
}

export class WorkflowState<State> {
  #state: NormalizedWorkflowState<State>

  constructor(state: NormalizedWorkflowState<State>) {
    this.#state = state;
  }

  startProcessing(
    stepName: string,
    inputState: State,
    now = new Date()
  ): WorkflowState<State> {
    const hasAlreadyAnInProgressStep = this.#state.steps.find(s => s.attempts.some(attempt => attempt.status === "in_progress"))

    if (hasAlreadyAnInProgressStep) {
      throw new Error("Not implemented at line 102 in state.ts")
    }

    const mStep = this.#state.steps.find(s => s.name === stepName)

    if (!mStep) {
      throw new Error("Not implemented at line 108 in state.ts")
    }

    const attempt: Attempt = {
      id: mStep.attempts.length + 1,
      status: "in_progress",
      inputState
    }

    const newStep: StepState = {
      ...mStep,
      attempts: [ ...mStep.attempts, attempt ]
    }

    const newSteps = this.#state.steps.map(s => s.name === mStep.name ? newStep : s)

    return new WorkflowState({
      ...this.#state,
      lastModified: now,
      steps: newSteps,
    })
  }

  updateFromStepResult(
    step: Step,
    result: StepResult<State>,
    now = new Date()
  ): WorkflowState<State> {
    const stepStateIndex = this.#state.steps.findIndex(s => s.name === step.name)
    const stepState = this.#state.steps[stepStateIndex]

    if (stepStateIndex === -1) {
      throw new Error("Not implemented at line 54 in state.ts")
    }

    const inProgressAttempt = stepState.attempts.find(attempt => attempt.status === "in_progress")

    if (!inProgressAttempt) {
      throw new Error("Not implemented at line 146 in state.ts")
    }
    const attemptStatus = resultToAttemptStatus(result)
    const newAttempt = { ...inProgressAttempt, status: attemptStatus } satisfies Attempt

    const updatedSteps = this.#state.steps.with(stepStateIndex, {
      ...stepState,
      attempts: stepState.attempts.map(attempt => attempt.id === newAttempt.id ? newAttempt : attempt)
    })

    const [nextTask, newStatus, resultState] = getNextTask(this.#state, step, result, now)

    return new WorkflowState<State>({
      ...this.#state,
      steps: updatedSteps,
      status: newStatus,
      toExecute: nextTask,
      ...resultState !== undefined && {
        result: resultState
      },
      lastModified: now
    })
  }

  toNormalized(): NormalizedWorkflowState<State> {
    return this.#state
  }

  static initialize<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName>(
    workflow: Workflow<State, FirstState, StateByStepName, Record<never, never>>,
    name: Name,
    state: StateByStepName[Name],
    id: string = randomUUID(),
    now: Date = new Date()
  ): WorkflowState<State> {
    const steps = Array.from(workflow.steps()).map(({ item }) => item)
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

    return new WorkflowState<State>({
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
    })
  }

  static reconstitute<State>(state: NormalizedWorkflowState<State>): WorkflowState<State> {
    return new WorkflowState<State>(state)
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
function getNextTask<State>(state: NormalizedWorkflowState<State>, step: Step, result: StepResult<State>, now: Date): [
  newTask: Task<State>,
  newStatus: WorkflowStatus,
  resultState: State | undefined
] {
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
      const nextState = result.type === "skipped"
        ? state.toExecute.state
        : result.state

      if (mNextStep === undefined) {
        return [
          {
            ...state.toExecute,
            state: nextState,
            status: "done",
          },
          "successful",
          nextState
        ]
      }

      return [
        {
          status: "todo",
          step: mNextStep.name,
          state: nextState,
          attempt: 1,
          areRetryExhausted: false
        },
        "in_progress",
        undefined
      ]
    }

    case "stopped": {
      return [
        {
          ...state.toExecute,
          status: "done",
        },
        "stopped",
        undefined
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
            "successful",
            state.toExecute.state
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
          "in_progress",
          undefined
        ]
      }

      if (areRetryExhausted) {
        return [
          {
            ...state.toExecute,
            status: "done",
            areRetryExhausted,
          },
          "failed",
          undefined
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
        "in_progress",
        undefined
      ]
    }
  }
}