import {Producer} from "../queue";
import {Workflow} from "./types";
import {randomUUID} from "crypto";
import {createWorkflowState, WorkflowState} from "./state/state";

export async function trigger<FirstState, WriteOpts> (
  queue: Producer<WriteOpts>,
  workflow: Workflow<any, FirstState, Record<string, never>, Record<never, never>>,
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
      payload: workflowState
    }
  ], opts)

  return workflowState
}