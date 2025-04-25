import {Workflow} from "./types";
import {WorkflowState} from "./pull/state";
import { Storage } from "./pull/poller"

export type OnErrorHook = (error: unknown) => void;

export interface Worker {
  start<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(workflows: Workflow<State, FirstState, StateByStepName, Decorators>[]): Promise<void>
  addHook(hook: "onError", handler: OnErrorHook): this
  stop(): Promise<void>
}

export type DefaultTriggerOpts = {
  /**
   * The ID of the workflow
   */
  id?: string
}

export interface Trigger<TriggerOpts extends Record<never, never>> {
  trigger<State, FirstState, StateByStepName extends Record<never, never>, Decorators extends Record<never, never>>(
    workflow: Workflow<State, FirstState, StateByStepName, Decorators>,
    state: FirstState,
    opts?: TriggerOpts & DefaultTriggerOpts
  ): Promise<WorkflowState<State>>

  triggerFrom<State, FirstState, StateByStepName extends Record<never, never>, Name extends keyof StateByStepName, Decorators extends Record<never, never>>(
    workflow: Workflow<State, FirstState, StateByStepName, Decorators>,
    name: Name,
    state: StateByStepName[Name],
    opts?: TriggerOpts & DefaultTriggerOpts
  ): Promise<WorkflowState<State>>
}

export interface Engine<TriggerOpts extends Record<never, never>> {
  createWorker(): Worker
  createTrigger(): Trigger<TriggerOpts>
  createStorage(): Storage<TriggerOpts>
  close(): Promise<void>
}