import {Step, StepResult, Workflow} from "../types";
import {randomUUID} from "crypto";

export type AttemptStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress" | "to_execute"

export type Attempt = {
  id: number
  status: AttemptStatus
  inputState: unknown
  result?: StepResult<unknown>
}

export type StepState = {
  name: string
  attempts: Attempt[]
}

export type WorkflowStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress"

export type NormalizedWorkflowState<State> = {
  id: string
  name: string
  result?: State
  status: WorkflowStatus
  steps: StepState[]
  lastModified: Date
  pickAfter?: Date
}

export class WorkflowState<State> {
  #state: NormalizedWorkflowState<State>

  constructor(state: NormalizedWorkflowState<State>) {
    this.#state = state;
  }

  startProcessing(
    now = new Date()
  ): WorkflowState<State> {
    const stepToExecute = this.#state.steps.find(s => s.attempts.some(a => a.status === "to_execute"))

    if (!stepToExecute) {
      throw new Error("Not implemented at line 53 in state.ts")
    }

    const currentAttempt = stepToExecute.attempts.find(a => a.status === "to_execute");

    if (!currentAttempt) {
      throw new Error("Not implemented at line 59 in state.ts")
    }

    const attempt: Attempt = {
      ...currentAttempt,
      status: "in_progress",
    }

    const newStep: StepState = {
      ...stepToExecute,
      attempts: stepToExecute.attempts.map(a => a.id === attempt.id ? attempt : a)
    }

    const newSteps = this.#state.steps.map(s => s.name === stepToExecute.name ? newStep : s)

    return new WorkflowState({
      ...this.#state,
      lastModified: now,
      steps: newSteps,
    })
  }

  get stepToExecute(): [StepState, Attempt] | undefined {
    return this.#state.steps.map(step => [
      step,
      step.attempts.find(a => a.status === "to_execute")
    ] as const).find(([, attempt ]) => attempt !== undefined) as [ StepState, Attempt ]
  }

  updateFromStepResult(
    step: Step,
    result: StepResult<State>,
    now = new Date()
  ): WorkflowState<State> {
    const currentStepIndex = this.#state.steps.findIndex(s => s.name === step.name)

    if (currentStepIndex === -1) {
      throw new Error("Not implemented at line 87 in state.ts")
    }

    const currentStepState = this.#state.steps[currentStepIndex]
    const nextStepState = currentStepIndex + 1 < this.#state.steps.length
      ? this.#state.steps[currentStepIndex + 1]
      : undefined

    const {
      currentStepUpdated,
      nextStepUpdated,
      newStatus,
      pickAfter
    } = this.#updateCurrentAndNextStep(currentStepState, nextStepState, step, result, now)

    const stepsUpdated = nextStepUpdated === undefined
      ? this.#state.steps.with(currentStepIndex, currentStepUpdated)
      : this.#state.steps
        .with(currentStepIndex, currentStepUpdated)
        .with(currentStepIndex + 1, nextStepUpdated)

    const newState = {
      ...this.#state,
      lastModified: now,
      status: newStatus,
      steps: stepsUpdated,
    }

    delete newState.pickAfter

    return new WorkflowState({
      ...newState,
      ...pickAfter !== undefined && { pickAfter }
    })
  }

  toNormalized(): NormalizedWorkflowState<State> {
    return this.#state
  }

  #updateCurrentAndNextStep(
    currentStepState: StepState,
    nextStepState: StepState | undefined,
    currentStep: Step,
    result: StepResult<State>,
    now: Date
  ): UpdateStateResult {
    const { delayBetweenAttempts: delayFnOrNumber, maxAttempts } = currentStep
    const currentStepAttempts = currentStepState.attempts.length
    const currentAttempt = currentStepState.attempts.find(attempt => attempt.status === "in_progress")

    if (currentAttempt === undefined) {
      throw new Error("Not implemented at line 296 in state.ts")
    }
    
    switch (result.type) {
      case "success": {
        const currentAttemptNewState: Attempt = {
          ...currentAttempt,
          status: "successful",
          result
        }

        return {
          currentStepUpdated: {
            ...currentStepState,
            attempts: currentStepState.attempts.map(attempt => attempt.id === currentAttempt.id ? currentAttemptNewState : attempt)
          },
          nextStepUpdated: nextStepState === undefined
            ? undefined
            : {
              ...nextStepState,
              attempts: [
                ...nextStepState.attempts,
                {
                  id: nextStepState.attempts.length + 1,
                  status: "to_execute",
                  inputState: result.state
                }
              ]
            },
          pickAfter: undefined,
          newStatus: nextStepState === undefined ? "successful" : "in_progress"
        }
      }

      case "stopped": {
        return {
          currentStepUpdated: {
            ...currentStepState,
            attempts: currentStepState.attempts.map(attempt => attempt.id === currentAttempt.id ? {
              ...currentAttempt,
              status: "stopped",
              result
            } : attempt)
          },
          nextStepUpdated: nextStepState,
          pickAfter: undefined,
          newStatus: "stopped"
        }
      }

      case "failure": {
        const areRetryExhausted = currentStepAttempts >= maxAttempts

        if (!areRetryExhausted) {
          const delayBetweenAttempts = typeof delayFnOrNumber === "number"
            ? () => delayFnOrNumber
            : delayFnOrNumber

          const newDelay = delayBetweenAttempts(currentStepAttempts + 1)
          const pickAfter = newDelay === 0 ? undefined : new Date(now.getTime() + newDelay)

          return {
            currentStepUpdated: {
              ...currentStepState,
              attempts: [
                ...currentStepState.attempts.map(attempt => attempt.id === currentAttempt.id ? {
                  ...currentAttempt,
                  status: "failed" as const,
                  result
                } : attempt),
                {
                  status: "to_execute",
                  id: currentStepState.attempts.length + 1,
                  inputState: currentAttempt.inputState
                }
              ]
            },
            nextStepUpdated: nextStepState,
            pickAfter,
            newStatus: "in_progress"
          }
        }

        return {
          currentStepUpdated: {
            ...currentStepState,
            attempts: currentStepState.attempts.map(attempt => attempt.id === currentAttempt.id ? {
              ...currentAttempt,
              status: "failed" as const,
              result
            } : attempt),
          },
          nextStepUpdated: nextStepState,
          pickAfter: undefined,
          newStatus: "failed"
        }
      }
    }
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
      // toExecute: {
      //   state: state as unknown as State,
      //   status: "todo",
      //   step: name as string,
      //   attempt: 1,
      //   areRetryExhausted: false
      // },
      steps: [
        ...previousSteps.map(step => ({
          name: step.name,
          attempts: []
        })),
        {
          name: mStep.name,
          attempts: [
            {
              id: 1,
              status: "to_execute",
              inputState: state
            }
          ]
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

type UpdateStateResult = {
  /**
   * The new state of the step currently in progress.
   */
  currentStepUpdated: StepState

  /**
   * The new state of the next step after the current in progress one.
   */
  nextStepUpdated: StepState | undefined

  /**
   * A date after which the new workflow state should be handled.
   * This is useful in case of a retry delay after a failure.
   */
  pickAfter: Date | undefined

  /**
   * The new state of the workflow state.
   */
  newStatus: WorkflowStatus
}