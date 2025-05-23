import {Workflow} from "../types";

export type WorkflowTask<State> = {
  attempt: number
  step: string
  workflow: string
  state: State
  retryAfter?: Date
}

export type ConsumptionWrite<State> =
  | Ack<State>
  | Nack<State>

export type Ack<State> = {
  type: "ack"
  task: WorkflowTask<State>
}
export type Nack<State> = {
  type: "nack"
  task: WorkflowTask<State>
}

export interface Consumption {
  consume<State, FirstState, StateByStepName extends Record<string, never>, Decorators extends Record<never, never>>(
    workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]
  ): AsyncGenerator<WorkflowTask<unknown>>

  write<State>(writes: WorkflowTask<State>[]): Promise<void>

  disconnect(): Promise<void>
}