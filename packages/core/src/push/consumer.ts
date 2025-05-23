import {Consumption, WorkflowTask} from "./consumption";
import {DefaultTriggerOpts, OnErrorHook, Trigger, Worker} from "../engine"
import {ReadyWorkflow, Step, StepResult, Workflow} from "../types";
import { WorkflowState } from "../pull/state";
import {randomUUID} from "crypto";

export class Consumer implements Worker {
  #consumption: Consumption
  #onErrorHooks: OnErrorHook[] = []

  constructor(consumption: Consumption) {
    this.#consumption = consumption
  }

  async start<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<void> {
    const readyWorkflows = await Promise.all(workflows.map(w => w.ready()))

    ;(async () => {
      for await (const task of this.#consumption.consume(readyWorkflows)) {
        const mWorkflow = readyWorkflows.find(w => w.name === task.workflow)

        if (!mWorkflow) {
          continue
        }

        const mStepAndContext = mWorkflow.getStepByName(task.step)

        if (!mStepAndContext) {
          continue
        }

        const {item: step, context: executionContext} = mStepAndContext

        const result = await this.#handleStep(step, task, executionContext)
        const mNextTask = this.#getNextTask(task, result, mWorkflow, step, new Date())

        if (mNextTask) {
          await this.#consumption.write([mNextTask])
        }
      }
    })().catch(err => {
      this.#executeErrorHooks(err)
    })
  }

  addHook(hook: "onError", handler: OnErrorHook): this {
    this.#onErrorHooks.push(handler)
    return this
  }

  async stop(): Promise<void> {
    await this.#consumption.disconnect()
  }

  #executeErrorHooks(err: unknown): void {
    for (const hook of this.#onErrorHooks) {
      hook(err)
    }
  }

  async #handleStep(
    step: Step,
    task: WorkflowTask<unknown>,
    workflow: ReadyWorkflow<unknown, unknown, Record<never, never>, Record<never, never>>
  ): Promise<StepResult<unknown>> {
    try {
      const nextStateOrResult = await step.handler({
        state: task.state,
        attempt: task.attempt,
        workflow,
        ok: state => ({
          type: "success",
          state
        }),
        err: error => ({
          type: "failure",
          error
        }),
        skip: () => ({
          type: "skipped"
        }),
        stop: () => ({
          type: "stopped"
        })
      })

      if (this.#isStepResult(nextStateOrResult)) {
        return nextStateOrResult
      }

      return ({
        type: "success",
        state: nextStateOrResult
      })
    } catch (error: unknown) {
      return ({type: "failure", error})
    }
  }

  #isStepResult(value: unknown): value is StepResult<unknown> {
    return typeof value === "object" && value !== null &&
      "type" in value && typeof value["type"] === "string"
  }

  #getNextTask<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(
    task: WorkflowTask<unknown>,
    result: StepResult<unknown>,
    workflow: Workflow<State, FirstState, StateByStepName, Decorators>,
    step: Step,
    now: Date
  ): WorkflowTask<unknown> | undefined {
    const {delayBetweenAttempts: delayFnOrNumber, maxAttempts, optional} = step

    const mNextStep = workflow.getNextStep(task.step)

    switch (result.type) {
      case "skipped":
      case "success": {
        if (mNextStep === undefined) {
          return undefined
        }

        const nextState = result.type === "skipped"
          ? task.state
          : result.state

        return {
          workflow: workflow.name,
          step: mNextStep?.name,
          state: nextState,
          attempt: 1,
        }
      }

      case "stopped": {
        return undefined
      }

      case "failure": {
        const areRetryExhausted = maxAttempts < task.attempt + 1

        if (areRetryExhausted && optional && mNextStep) {
          return {
            attempt: 1,
            state: task.state,
            step: mNextStep.name,
            workflow: workflow.name
          }
        }

        if (areRetryExhausted) {
          return undefined
        }

        if (areRetryExhausted) {
          return undefined
        }

        const delayBetweenAttempts = typeof delayFnOrNumber !== "function"
          ? () => delayFnOrNumber
          : delayFnOrNumber

        const retryAfter = new Date(now.getTime() + delayBetweenAttempts(task.attempt + 1))

        return {
          attempt: task.attempt + 1,
          workflow: workflow.name,
          step: step.name,
          state: task.state,
          retryAfter,
        }
      }
    }
  }
}

export class Producer<TriggerOpts extends DefaultTriggerOpts> implements Trigger<TriggerOpts> {
  #consumption: Consumption

  constructor(consumption: Consumption) {
    this.#consumption = consumption
  }

  async trigger<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflow: Workflow<State, FirstState, StateByStepName, Decorators>, state: FirstState, opts?: (TriggerOpts & DefaultTriggerOpts) | undefined): Promise<WorkflowState<State>> {
    const mFirstStep = workflow.getFirstStep()

    if (!mFirstStep) {
      throw new Error("Cannot trigger a workflow that has no step")
    }

    await this.#consumption.write([
      {
        state,
        step: mFirstStep.name,
        workflow: workflow.name,
        attempt: 1,
      }
    ])

    return {
      name: workflow.name,
      id: randomUUID(),
      status: "in_progress",
      steps: [],
      toExecute: {
        status: "done",
        step: mFirstStep.name,
        attempt: 1,
        areRetryExhausted: false,
        state: state as unknown as State,
      }
    }
  }

  async triggerFrom<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName, Decorators extends Record<never, never>>(
    workflow: Workflow<State, FirstState, StateByStepName, Decorators>,
    name: Name,
    state: StateByStepName[Name],
    opts?: (TriggerOpts & DefaultTriggerOpts) | undefined
  ): Promise<WorkflowState<State>> {
    const mStep = workflow.getStepByName(name as string)?.item

    if (!mStep) {
      throw new Error("Not implemented at line 81 in poller.ts")
    }

    await this.#consumption.write([
      {
        state,
        step: mStep.name,
        attempt: 1,
        workflow: workflow.name
      }
    ])

    return {
      name: workflow.name,
      id: randomUUID(),
      status: "in_progress",
      steps: [],
      toExecute: {
        status: "done",
        step: mStep.name,
        attempt: 1,
        areRetryExhausted: false,
        state: state as unknown as State,
      }
    }
  }
}