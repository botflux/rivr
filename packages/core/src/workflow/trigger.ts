import {Producer} from "../queue";
import {Workflow} from "./types";
import {randomUUID} from "crypto";
import {createWorkflowState, WorkflowState} from "./state/state";

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
): Promise<WorkflowState<FirstState>> {
  await workflow.ready()

  const firstStep = workflow.getFirstStep()

  if (firstStep === undefined) {
    throw new Error("No step is the workflow")
  }

  const workflowState = createWorkflowState(workflow, firstStep.name, state as never, randomUUID(), new Date())

  await queue.produce([
    {
      type: "workflow",
      id: randomUUID(),
      payload: workflowState,
      createdAt: new Date()
    }
  ], opts)

  return workflowState as unknown as WorkflowState<FirstState>
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
): Promise<WorkflowState<StateByStepName[Step]>> {
  await workflow.ready()

  const workflowState = createWorkflowState(workflow, step, state as never, randomUUID(), new Date())

  await queue.produce([
    {
      type: "workflow",
      id: randomUUID(),
      payload: workflowState,
      createdAt: new Date()
    }
  ], opts)

  return workflowState as WorkflowState<StateByStepName[Step]>
}