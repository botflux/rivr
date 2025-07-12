import {MessageHandler} from "./message-handler";
import {startProcessing, updateFromStepResult, WorkflowState} from "../../workflow/state/state";
import {ReadyWorkflow, Step, StepResult, Workflow} from "../../workflow/types";
import {WorkflowStateStorage} from "../../workflow/state/storage";
import {Message} from "../../queue";
import {randomUUID} from "crypto";
import {Logger} from "../../logger/logger";

export class WorkflowMessageHandler implements MessageHandler<WorkflowState<unknown>> {
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

  support(message: Message): message is Message & { payload: WorkflowState<unknown> } {
    const {payload} = message

    return typeof payload === "object" && payload !== null
      && "name" in payload && typeof payload.name === "string"
  }

  async handle(message: Message & { payload: WorkflowState<unknown> }): Promise<Message[]> {
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

    const mStepAndExecutionContext = mWorkflow.getStepByName(state.toExecute.step)

    if (!mStepAndExecutionContext) {
      this.#logger?.warn(`State '${state.id}' references an unknown step '${state.toExecute.step}'`, {
        type: "unknown_step",
        stateId: state.id,
        stateName: state.name,
        stepName: state.toExecute.step
      })
      return []
    }

    const processingState = startProcessing(state, state.toExecute.step, state.toExecute.state)
    await this.#stateStorage?.upsert([ processingState ])
    const {item: step, context} = mStepAndExecutionContext

    for (const {context, item: hook} of mWorkflow.getHook("preStepHandler")) {
      await hook(context, step, state.toExecute.state)
    }

    const result = await this.#executeHandler(step, context, state)
    const newState = updateFromStepResult(processingState, step, result)

    for (const {context, item: hook} of mWorkflow.getHook("onStepHandled")) {
      await hook(context, step, result, newState)
    }

    await this.#stateStorage?.upsert([newState])

    if (newState.status === "successful") {
      for (const {context, item: hook} of mWorkflow.getHook("onWorkflowCompleted")) {
        await hook(context, newState.toExecute.state)
      }
    } else if (newState.status === "stopped") {
      for (const {context, item: hook} of mWorkflow.getHook("onWorkflowStopped")) {
        await hook(context, step, newState.toExecute.state)
      }
    } else if (newState.status === "failed" && result.type === "failure") {
      for (const {context, item: hook} of mWorkflow.getHook("onWorkflowFailed")) {
        await hook(result.error, context, step, newState.toExecute.state)
      }
    }

    if (newState.status === "in_progress") {
      return [
        {
          id: randomUUID(),
          type: "workflow",
          payload: newState,
          ...newState.toExecute.pickAfter !== undefined && {pickAfter: newState.toExecute.pickAfter},
          createdAt: new Date()
        }
      ]
    }

    return []
  }

  async #executeHandler(
    step: Step,
    context: ReadyWorkflow<unknown, unknown, Record<string, never>, Record<never, never>>,
    state: WorkflowState<unknown>
  ): Promise<StepResult<unknown>> {
    try {
      const stepResultOrResult = await step.handler({
        stop: () => ({type: "stopped"}),
        err: (error: unknown) => ({type: "failure", error}),
        skip: () => ({type: "skipped"}),
        ok: (state) => ({type: "success", state}),
        attempt: state.toExecute.attempt,
        state: state.toExecute.state,
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