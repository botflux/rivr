import {Workflow} from "../types";

export type WorkflowTask<State> = {
  attempt: number
  step: string
  workflow: string
  state: State
  retryAfter?: Date
}

export interface Queue {
  consume<State, FirstState, StateByStepName extends Record<string, never>, Decorators extends Record<never, never>>(
    workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]
  ): AsyncGenerator<WorkflowTask<unknown>>

  enqueue<State>(writes: WorkflowTask<State>[]): Promise<void>

  disconnect(): Promise<void>
}