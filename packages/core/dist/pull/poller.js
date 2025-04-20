"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Poller = exports.PullTrigger = void 0;
const promises_1 = require("node:timers/promises");
const inline_catch_1 = require("../utils/inline-catch");
const state_1 = require("./state");
class InfiniteLoop {
    #stopped = false;
    *[Symbol.iterator]() {
        while (!this.#stopped) {
            yield;
        }
    }
    stop() {
        this.#stopped = true;
    }
}
class PullTrigger {
    #storage;
    constructor(storage) {
        this.#storage = storage;
    }
    async trigger(workflow, state, opts) {
        const mFirstStep = workflow.getFirstStep();
        if (!mFirstStep) {
            throw new Error("Cannot trigger a workflow that has no step");
        }
        const s = (0, state_1.createWorkflowState)(workflow, state, opts?.id);
        await this.#storage.write([
            {
                type: "insert",
                state: s
            }
        ], opts);
        return s;
    }
}
exports.PullTrigger = PullTrigger;
class Poller {
    #loop = new InfiniteLoop();
    #storage;
    #hasFinished = false;
    #delayBetweenPulls;
    #countPerPull;
    #onError = [];
    constructor(storage, delayBetweenPulls, countPerPull) {
        this.#storage = storage;
        this.#delayBetweenPulls = delayBetweenPulls;
        this.#countPerPull = countPerPull;
    }
    async start(workflows) {
        const readyWorkflows = await Promise.all(workflows.map(async (workflow) => workflow.ready()));
        (async () => {
            for (const _ of this.#loop) {
                const [tasks, tasksErr] = await (0, inline_catch_1.tryCatch)(this.#storage.pull(workflows, { limit: this.#countPerPull }));
                if (tasksErr !== undefined) {
                    this.#executeErrorHooks(tasksErr);
                    continue;
                }
                for (const task of tasks) {
                    const mWorkflow = readyWorkflows.find(w => w.name === task.name);
                    if (!mWorkflow)
                        continue;
                    const mStepAndContext = mWorkflow.getStepAndExecutionContext(task.toExecute.step);
                    if (!mStepAndContext)
                        continue;
                    const [step, executionContext] = mStepAndContext;
                    const result = await this.#handleStep(step, task, executionContext);
                    const newState = (0, state_1.updateWorkflowState)(task, step, result);
                    await this.#write([
                        {
                            type: "update",
                            state: newState
                        }
                    ]);
                    switch (result.type) {
                        case "stopped": {
                            for (const [handler, context] of mWorkflow.getHook("onWorkflowStopped")) {
                                const [, error] = (0, inline_catch_1.tryCatchSync)(() => handler(context, step, task.toExecute.state));
                                if (error !== undefined) {
                                    this.#executeErrorHooks(error);
                                }
                            }
                            break;
                        }
                        case "success":
                        case "skipped": {
                            const newState = result.type === "skipped"
                                ? task.toExecute.state
                                : result.state;
                            const mNextStep = mWorkflow.getNextStep(task.toExecute.step);
                            if (result.type === "skipped") {
                                for (const [handler, context] of mWorkflow.getHook("onStepSkipped")) {
                                    const [, error] = (0, inline_catch_1.tryCatchSync)(() => handler(context, step, task.toExecute.state));
                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error);
                                    }
                                }
                            }
                            for (const [handler, context] of mWorkflow.getHook("onStepCompleted")) {
                                const [, error] = (0, inline_catch_1.tryCatchSync)(() => handler(context, step, newState));
                                if (error !== undefined) {
                                    this.#executeErrorHooks(error);
                                }
                            }
                            if (mNextStep === undefined) {
                                for (const [handler, context] of mWorkflow.getHook("onWorkflowCompleted")) {
                                    const [, err] = (0, inline_catch_1.tryCatchSync)(() => handler.call(context, context, newState));
                                    if (err !== undefined) {
                                        this.#executeErrorHooks(err);
                                    }
                                }
                            }
                            break;
                        }
                        case "failure": {
                            const hasExhaustedRetry = task.toExecute.attempt + 1 > step.maxAttempts;
                            const mNextStep = mWorkflow.getNextStep(task.toExecute.step);
                            for (const [hook, context] of mWorkflow.getHook("onStepError")) {
                                const [, error] = (0, inline_catch_1.tryCatchSync)(() => hook(result.error, context, task.toExecute.state));
                                if (error !== undefined) {
                                    this.#executeErrorHooks(error);
                                }
                            }
                            if (hasExhaustedRetry && !step.optional) {
                                for (const [hook, context] of mWorkflow.getHook("onWorkflowFailed")) {
                                    const [, error] = (0, inline_catch_1.tryCatchSync)(() => hook(result.error, context, step, task.toExecute.state));
                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error);
                                    }
                                }
                            }
                            if (hasExhaustedRetry && step.optional && mNextStep === undefined) {
                                for (const [hook, context] of mWorkflow.getHook("onWorkflowCompleted")) {
                                    const [, error] = (0, inline_catch_1.tryCatchSync)(() => hook(context, task.toExecute.state));
                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error);
                                    }
                                }
                            }
                        }
                    }
                }
                if (tasks.length === 0) {
                    await (0, promises_1.setTimeout)(this.#delayBetweenPulls);
                }
            }
            this.#hasFinished = true;
        })().catch(console.error);
    }
    addHook(hook, handler) {
        this.#onError.push(handler);
        return this;
    }
    async stop() {
        this.#loop.stop();
        while (!this.#hasFinished) {
            await (0, promises_1.setTimeout)(10);
        }
        await this.#storage.disconnect();
    }
    async #handleStep(step, state, workflow) {
        try {
            const nextStateOrResult = await step.handler({
                state: state.toExecute.state,
                workflow,
                ok: state => ({
                    type: "success",
                    state
                }),
                err: error => ({
                    type: "failure",
                    error,
                }),
                skip: () => ({
                    type: "skipped"
                }),
                stop: () => ({
                    type: "stopped"
                }),
                attempt: state.toExecute.attempt
            });
            if (this.#isStepResult(nextStateOrResult)) {
                return nextStateOrResult;
            }
            return ({
                type: "success",
                state: nextStateOrResult
            });
        }
        catch (error) {
            return ({ type: "failure", error });
        }
    }
    #isStepResult(value) {
        return typeof value === "object" && value !== null &&
            "type" in value && typeof value["type"] === "string";
    }
    #executeErrorHooks(err) {
        for (const hook of this.#onError) {
            hook(err);
        }
    }
    async #write(writes) {
        const [, err] = await (0, inline_catch_1.tryCatch)(this.#storage.write(writes));
        if (err !== undefined) {
            this.#executeErrorHooks(err);
        }
    }
}
exports.Poller = Poller;
