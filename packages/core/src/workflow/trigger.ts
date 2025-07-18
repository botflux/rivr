import {Producer} from "../queue";
import {Workflow} from "./types";
import {NormalizedWorkflowState, WorkflowState} from "./state/state";
import { uuidv7 } from "uuidv7"

/**
 * Trigger a workflow from the first step.
 *
 * @param queue
 * @param workflow
 * @param state
 * @param opts
 */
export async function trigger<State, FirstState, WriteOpts> (
  queue: Producer<WriteOpts>,
  workflow: Workflow<State, FirstState, Record<string, never>, Record<never, never>>,
  state: FirstState,
  opts?: WriteOpts
): Promise<NormalizedWorkflowState<FirstState>> {
  await workflow.ready()

  const firstStep = workflow.getFirstStep()

  if (firstStep === undefined) {
    throw new Error("No step is the workflow")
  }

  const workflowState = WorkflowState
    .initialize(workflow, firstStep.name, state as never, uuidv7(), new Date())
    .toNormalized()

  await queue.produce([
    {
      type: "workflow_message@v1",
      payload: workflowState,
      createdAt: new Date()
    }
  ], opts)

  return workflowState as unknown as NormalizedWorkflowState<FirstState>
}

/**
 * Trigger a workflow from a specific step.
 *
 * @param queue
 * @param workflow
 * @param step
 * @param state
 * @param opts
 */
export async function triggerFrom<State, FirstState, StateByStepName extends Record<never, never>, Step extends keyof StateByStepName, WriteOpts>(
  queue: Producer<WriteOpts>,
  workflow: Workflow<State, FirstState, StateByStepName, Record<never, never>>,
  step: Step,
  state: StateByStepName[Step],
  opts?: WriteOpts
): Promise<NormalizedWorkflowState<StateByStepName[Step]>> {
  await workflow.ready()

  const workflowState = WorkflowState
    .initialize(workflow, step, state as never, uuidv7(), new Date())
    .toNormalized()

  await queue.produce([
    {
      type: "workflow_message@v1",
      payload: workflowState,
      createdAt: new Date()
    }
  ], opts)

  return workflowState as NormalizedWorkflowState<StateByStepName[Step]>
}