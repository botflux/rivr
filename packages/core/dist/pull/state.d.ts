import { Step, StepResult, Workflow } from "../types";
export type AttemptStatus = "successful" | "failed" | "skipped" | "stopped";
export type Attempt = {
    id: number;
    status: AttemptStatus;
};
export type StepState = {
    name: string;
    attempts: Attempt[];
};
export type WorkflowStatus = "successful" | "failed" | "skipped" | "stopped" | "in_progress";
export type Task<State> = {
    status: "todo" | "done";
    step: string;
    state: State;
    attempt: number;
    areRetryExhausted: boolean;
    pickAfter?: Date;
};
export type WorkflowState<State> = {
    id: string;
    name: string;
    toExecute: Task<State>;
    result?: State;
    status: WorkflowStatus;
    steps: StepState[];
};
export declare function createWorkflowState<State>(workflow: Workflow<State, Record<never, never>>, state: State, id?: string): WorkflowState<State>;
export declare function updateWorkflowState<State>(state: WorkflowState<State>, step: Step<State, any>, result: StepResult<State>, now?: Date): WorkflowState<State>;
