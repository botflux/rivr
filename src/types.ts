import {Workflow} from "./workflow";

export type WorkflowBuilder<State> = (w: Workflow<State>) => void
/**
 * Worker metadata represents data about the poller.
 * I've chosen 'worker' instead of 'poller' because
 * push based workflow engine will be called 'consumer'
 * rather than 'poller'.
 */
export type DefaultWorkerMetadata = {
  /**
   * The id of the worker that is handling the step.
   */
  workerId: string
}
export type StepExecutionMetadata = {
  /**
   * The current attempt of executing this message.
   */
  attempt: number

  tenant?: string

  /**
   * The step execution's id.
   */
  id: string
}
export type StepExecutionContext<State> = {
  /**
   * The state of the workflow.
   */
  state: State

  /**
   * Metadata about the step execution.
   */
  metadata: StepExecutionMetadata

  /**
   * Metadata about the worker
   */
  worker: DefaultWorkerMetadata
}
export type Stop = { type: "stop" }
export type Skip = { type: "skip" }
export type Failure = { type: "failure", error: unknown }
export type Success<T> = { type: "success", value: T }
export type StepResult<T> = Success<T> | Failure | Stop | Skip

export function success<T>(result: T): Success<T> {
  return {type: "success", value: result}
}

export function failure(error: unknown): Failure {
  return {type: "failure", error}
}

export function stop(): Stop {
  return {type: "stop"}
}

export function skip(): Skip {
  return {type: "skip"}
}

export function isStepResult(result: unknown): result is StepResult<unknown> {
  return result !== null && typeof result === "object"
    && "type" in result && (result["type"] === "failure" || result["type"] === "success" || result["type"] === "stop" || result["type"] === "skip")
}

export type StepHandler<State> = (context: StepExecutionContext<State>) => void | State | StepResult<State> | Promise<void | State | StepResult<State>>
export type BatchStepHandler<State> = (contexts: StepExecutionContext<State>[], workerMetadata: DefaultWorkerMetadata) => void | State[] | StepResult<State>[] | Promise<void | State[] | StepResult<State>[]>
export type Step<State> =
  SingleStep<State>
  | BatchStep<State>
export type SingleStep<State> = {
  name: string
  workflow: Workflow<State>
  handler: StepHandler<State>
  type: "single"
}
export type BatchStep<State> = {
  name: string
  workflow: Workflow<State>
  handler: BatchStepHandler<State>
  type: "batch"
}