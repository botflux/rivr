"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflowState = createWorkflowState;
exports.updateWorkflowState = updateWorkflowState;
const crypto_1 = require("crypto");
function createWorkflowState(workflow, state, id = (0, crypto_1.randomUUID)()) {
    const [mFirst, ...rest] = Array.from(workflow.steps()).map(([step]) => step);
    if (mFirst === undefined) {
        throw new Error("Cannot create a workflow state from an empty workflow.");
    }
    return {
        name: workflow.name,
        id,
        status: "in_progress",
        toExecute: {
            state,
            status: "todo",
            step: mFirst.name,
            attempt: 1,
            areRetryExhausted: false
        },
        steps: [
            {
                name: mFirst.name,
                attempts: []
            },
            ...rest.map(step => ({
                name: step.name,
                attempts: []
            }))
        ]
    };
}
function updateWorkflowState(state, step, result, now = new Date()) {
    const stepStateIndex = state.steps.findIndex(s => s.name === step.name);
    const stepState = state.steps[stepStateIndex];
    if (stepStateIndex === -1) {
        throw new Error("Not implemented at line 54 in state.ts");
    }
    const attemptId = stepState.attempts.length + 1;
    const attemptStatus = resultToAttemptStatus(result);
    const newAttempt = { id: attemptId, status: attemptStatus };
    const updatedSteps = state.steps.with(stepStateIndex, { ...stepState, attempts: [...stepState.attempts, newAttempt] });
    const [nextTask, newStatus] = getNextTask(state, step, result, now);
    return {
        ...state,
        steps: updatedSteps,
        status: newStatus,
        toExecute: nextTask,
        ...newStatus === "successful" && {
            result: nextTask.state
        }
    };
}
function resultToAttemptStatus(result) {
    switch (result.type) {
        case "success": return "successful";
        case "failure": return "failed";
        case "skipped": return "skipped";
        case "stopped": return "stopped";
    }
}
/**
 * Return the next task from the current workflow state and step result.
 *
 * @param state
 * @param step
 * @param result
 * @param now
 */
function getNextTask(state, step, result, now) {
    const { delayBetweenAttempts: delayFnOrNumber, maxAttempts, optional } = step;
    const currentStepIndex = state.steps.findIndex(s => s.name === step.name);
    if (currentStepIndex === -1) {
        throw new Error("Cannot find the step");
    }
    const mNextStep = currentStepIndex + 1 >= state.steps.length
        ? undefined
        : state.steps[currentStepIndex + 1];
    switch (result.type) {
        case "skipped":
        case "success": {
            if (mNextStep === undefined) {
                return [
                    {
                        ...state.toExecute,
                        status: "done",
                    },
                    "successful"
                ];
            }
            const nextState = result.type === "skipped"
                ? state.toExecute.state
                : result.state;
            return [
                {
                    status: "todo",
                    step: mNextStep.name,
                    state: nextState,
                    attempt: 1,
                    areRetryExhausted: false
                },
                "in_progress"
            ];
        }
        case "stopped": {
            return [
                {
                    ...state.toExecute,
                    status: "done",
                },
                "stopped"
            ];
        }
        case "failure": {
            const areRetryExhausted = maxAttempts < state.toExecute.attempt + 1;
            if (areRetryExhausted && optional) {
                if (mNextStep === undefined) {
                    return [
                        {
                            ...state.toExecute,
                            status: "done"
                        },
                        "successful"
                    ];
                }
                return [
                    {
                        status: "todo",
                        attempt: 1,
                        areRetryExhausted: false,
                        state: state.toExecute.state,
                        step: mNextStep.name,
                    },
                    "in_progress"
                ];
            }
            if (areRetryExhausted) {
                return [
                    {
                        ...state.toExecute,
                        status: "done",
                        areRetryExhausted,
                    },
                    "failed"
                ];
            }
            const delayBetweenAttempts = typeof delayFnOrNumber === "number"
                ? () => delayFnOrNumber
                : delayFnOrNumber;
            const retryAfter = new Date(now.getTime() + delayBetweenAttempts(state.toExecute.attempt + 1));
            return [
                {
                    ...state.toExecute,
                    attempt: state.toExecute.attempt + 1,
                    areRetryExhausted,
                    pickAfter: retryAfter,
                },
                "in_progress"
            ];
        }
    }
}
