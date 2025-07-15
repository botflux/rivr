import {MessageHandler} from "./message-handler";
import {
  Attempt,
  NormalizedWorkflowState, StepState,
  WorkflowState
} from "../../workflow/state/state";
import {ReadyWorkflow, Step, StepResult, Workflow} from "../../workflow/types";
import {WorkflowStateStorage} from "../../workflow/state/storage";
import {Message} from "../../queue";
import {randomUUID} from "crypto";
import {Logger} from "../../logger/logger";

export class WorkflowMessageHandler implements MessageHandler<NormalizedWorkflowState<unknown>> {
  #workflows: Workflow<any, any, Record<string, never>, Record<never, never>>[]
  #stateStorage?: WorkflowStateStorage
  #logger?: Logger

  constructor(
    workflows: Workflow<any, any, Record<string, never>, Record<never, never>>[],
    stateStorage?: WorkflowStateStorage,
    logger?: Logger
  ) {
    this.#workflows = workflows;
    this.#stateStorage = stateStorage;
    this.#logger = logger;
  }

  support(message: Message): message is Message & { payload: NormalizedWorkflowState<unknown> } {
    const {payload} = message

    return typeof payload === "object" && payload !== null
      && "name" in payload && typeof payload.name === "string"
  }

  async handle(message: Message & { payload: NormalizedWorkflowState<unknown> }): Promise<Message[]> {
    const {payload: state} = message
    const mWorkflow = this.#workflows.find(w => w.name === state.name)

    if (!mWorkflow) {
      this.#logger?.warn(`State '${state.id}' references to workflow '${state.name}' that the worker doesn't know about.`, {
        type: "unknown_workflow",
        stateId: state.id,
        stateName: state.name
      })
      return []
    }

    const reconstitutedState = WorkflowState.reconstitute(state)
    const toExecute = reconstitutedState.stepToExecute

    if (toExecute === undefined) {
      this.#logger?.warn(`There is no step to execute within the workflow '${state.name}'`, {
        type: "no_step_to_execute",
        stateId: state.id,
        stateName: state.name
      })
      return []
    }

    const [ toExecuteStep, toExecuteAttempt ] = toExecute

    const mStepAndExecutionContext = mWorkflow.getStepByName(toExecuteStep.name)

    if (!mStepAndExecutionContext) {
      this.#logger?.warn(`State '${state.id}' references an unknown step '${toExecuteStep.name}'`, {
        type: "unknown_step",
        stateId: state.id,
        stateName: state.name,
        stepName: toExecuteStep.name
      })
      return []
    }

    const processingState = reconstitutedState.startProcessing()

    await this.#stateStorage?.upsert([ processingState.toNormalized() ])
    const {item: step, context} = mStepAndExecutionContext

    for (const {context, item: hook} of mWorkflow.getHook("preStepHandler")) {
      await hook(context, step, toExecuteAttempt.inputState)
    }

    const result = await this.#executeHandler(step, context, toExecuteStep, toExecuteAttempt)
    const newState = processingState.updateFromStepResult(step, result)

    const newStateNormalized = newState.toNormalized()

    for (const {context, item: hook} of mWorkflow.getHook("onStepHandled")) {
      await hook(context, step, result, newStateNormalized)
    }

    await this.#stateStorage?.upsert([newStateNormalized])

    if (newStateNormalized.status === "successful") {
      for (const {context, item: hook} of mWorkflow.getHook("onWorkflowCompleted")) {
        await hook(context, result)
      }
    } else if (newStateNormalized.status === "stopped") {
      for (const {context, item: hook} of mWorkflow.getHook("onWorkflowStopped")) {
        await hook(context, step, toExecuteAttempt.inputState)
      }
    } else if (newStateNormalized.status === "failed" && result.type === "failure") {
      for (const {context, item: hook} of mWorkflow.getHook("onWorkflowFailed")) {
        await hook(result.error, context, step, toExecuteAttempt.inputState)
      }
    }

    if (newStateNormalized.status === "in_progress") {
      return [
        {
          id: randomUUID(),
          type: "workflow",
          payload: newStateNormalized,
          createdAt: new Date(),
          pickAfter: newStateNormalized.pickAfter
        }
      ]
    }

    return []
  }

  async #executeHandler(
    step: Step,
    context: ReadyWorkflow<unknown, unknown, Record<string, never>, Record<never, never>>,
    stepState: StepState,
    attemptState: Attempt
  ): Promise<StepResult<unknown>> {
    try {
      const stepResultOrResult = await step.handler({
        stop: () => ({type: "stopped"}),
        err: (error: unknown) => ({type: "failure", error}),
        ok: (state) => ({type: "success", state}),
        attempt: stepState.attempts.length,
        state: attemptState.inputState,
        workflow: context
      })

      return this.#isStepResult(stepResultOrResult)
        ? stepResultOrResult
        : {type: "success", state: stepResultOrResult}
    } catch (error: unknown) {
      return {type: "failure", error}
    }
  }

  #isStepResult(value: unknown): value is StepResult<unknown> {
    return typeof value === "object" && value !== null
      && "type" in value && typeof value.type === "string"
      && ["stopped", "success", "failure", "skipped"].includes(value.type)
  }
}