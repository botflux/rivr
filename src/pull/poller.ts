import {setTimeout} from "node:timers/promises"
import {DefaultTriggerOpts, OnErrorHook, type Trigger, type Worker} from "../engine.ts"
import {ReadyWorkflow, Step, StepResult, Workflow} from "../types.ts";
import {tryCatch, tryCatchSync} from "../inline-catch.ts";
import {createWorkflowState, updateWorkflowState, WorkflowState} from "./state.ts";

export type Insert<State> = {
    type: "insert"
    state: WorkflowState<State>
}

export type Update<State> = {
    type: "update"
    state: WorkflowState<State>
}

export type Write<State> = Update<State> | Insert<State>

export type PullOpts = {
    limit: number
}

export interface Storage<WriteOpts> {
    pull<State, Decorators>(
      workflows: Workflow<State, Decorators>[],
      opts: PullOpts
    ): Promise<WorkflowState<State>[]>
    write<State>(writes: Write<State>[], opts?: WriteOpts): Promise<void>
    disconnect(): Promise<void>
}

class InfiniteLoop {
    #stopped = false;

    *[Symbol.iterator]() {
        while (!this.#stopped) {
            yield
        }
    }

    stop(): void {
        this.#stopped = true
    }
}

export class PullTrigger<TriggerOpts extends DefaultTriggerOpts> implements Trigger<TriggerOpts> {
    #storage: Storage<TriggerOpts>

    constructor(storage: Storage<TriggerOpts>) {
        this.#storage = storage
    }

    async trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State, opts?: TriggerOpts): Promise<void> {
        const mFirstStep = workflow.getFirstStep()

        if (!mFirstStep) {
            throw new Error("Cannot trigger a workflow that has no step")
        }

        const s = createWorkflowState(workflow as unknown as Workflow<State, Record<never, never>>, state, opts?.id)

        await this.#storage.write([
            {
                type: "insert",
                state: s
            }
        ], opts)
    }
}

export class Poller<TriggerOpts> implements Worker {
    #loop = new InfiniteLoop()
    #storage: Storage<TriggerOpts>

    #hasFinished = false
    #delayBetweenPulls: number
    #countPerPull: number

    #onError: OnErrorHook[] = []

    constructor(
      storage: Storage<TriggerOpts>,
      delayBetweenPulls: number,
      countPerPull: number
    ) {
        this.#storage = storage
        this.#delayBetweenPulls = delayBetweenPulls
        this.#countPerPull = countPerPull
    }

    async start<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<void> {
        const readyWorkflows = await Promise.all(workflows.map(async workflow => workflow.ready()))

        ;(async () => {
            for (const _ of this.#loop) {
                const [tasks, tasksErr] = await tryCatch(this.#storage.pull(workflows, { limit: this.#countPerPull }))

                if (tasksErr !== undefined) {
                    this.#executeErrorHooks(tasksErr)
                    continue
                }

                for (const task of tasks) {
                    const mWorkflow = readyWorkflows.find(w => w.name === task.name)

                    if (!mWorkflow)
                        continue

                    const mStepAndContext = mWorkflow.getStepAndExecutionContext(task.toExecute.step)

                    if (!mStepAndContext)
                        continue

                    const [step, executionContext] = mStepAndContext

                    const result = await this.#handleStep(step, task, executionContext)
                    const newState = updateWorkflowState(task, step, result)

                    await this.#write([
                        {
                            type: "update",
                            state: newState
                        }
                    ])

                    switch(result.type) {
                        case "stopped": {
                            for (const [handler, context] of mWorkflow.getHook("onWorkflowStopped")) {
                                const [, error] = tryCatchSync(() => handler(context, step, task.toExecute.state))

                                if (error !== undefined) {
                                    this.#executeErrorHooks(error)
                                }
                            }

                            break
                        }

                        case "success": 
                        case "skipped": {
                            const newState = result.type === "skipped"
                                ? task.toExecute.state
                                : result.state
                            const mNextStep = mWorkflow.getNextStep(task.toExecute.step)

                            if (result.type === "skipped") {
                                for (const [handler, context] of mWorkflow.getHook("onStepSkipped")) {
                                    const [, error] = tryCatchSync(() => handler(context, step, task.toExecute.state))

                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error)
                                    }
                                }                                
                            }

                            for (const [handler, context] of mWorkflow.getHook("onStepCompleted")) {
                                const [, error] = tryCatchSync(() => handler(context, step, newState))

                                if (error !== undefined) {
                                    this.#executeErrorHooks(error)
                                }
                            }

                            if (mNextStep === undefined) {
                                for (const [handler, context] of mWorkflow.getHook("onWorkflowCompleted")) {
                                    const [ , err ] = tryCatchSync(() => handler.call(context, context, newState))

                                    if (err !== undefined) {
                                        this.#executeErrorHooks(err)
                                    }
                                }
                            }

                            break
                        }

                        case "failure": {
                            const hasExhaustedRetry = task.toExecute.attempt + 1 > step.maxAttempts
                            const mNextStep = mWorkflow.getNextStep(task.toExecute.step)

                            for (const [hook, context] of mWorkflow.getHook("onStepError")) {
                                const [, error] = tryCatchSync(() => hook(result.error, context, task.toExecute.state))

                                if (error !== undefined) {
                                    this.#executeErrorHooks(error)
                                }
                            }

                            if (hasExhaustedRetry && !step.optional) {
                                for (const [hook, context] of mWorkflow.getHook("onWorkflowFailed")) {
                                    const [, error] = tryCatchSync(() => hook(result.error, context, step, task.toExecute.state))

                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error)
                                    }
                                }
                            }

                            if (hasExhaustedRetry && step.optional && mNextStep === undefined) {
                                for (const [hook, context] of mWorkflow.getHook("onWorkflowCompleted")) {
                                    const [, error] = tryCatchSync(() => hook(context, task.toExecute.state))

                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error)
                                    }
                                }
                            }
                        }
                    }
                }

                if (tasks.length === 0) {
                    await setTimeout(this.#delayBetweenPulls)
                }
            }

            this.#hasFinished = true
        })().catch(console.error)
    }

    addHook(hook: "onError", handler: OnErrorHook): this {
        this.#onError.push(handler)
        return this
    }

    async stop(): Promise<void> {
        this.#loop.stop()

        while (!this.#hasFinished) {
            await setTimeout(10)
        }

        await this.#storage.disconnect()
    }

    async #handleStep<State, Decorators>(
        step: Step<State, Decorators>,
        state: WorkflowState<State>,
        workflow: ReadyWorkflow<State, Decorators>
    ): Promise<StepResult<State>> {
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
            })

            if (this.#isStepResult(nextStateOrResult)) {
                return nextStateOrResult
            }

            return ({
                type: "success",
                state: nextStateOrResult
            })
        } catch(error: unknown) {
            return ({ type: "failure", error })
        }
    }

    #isStepResult (value: unknown): value is StepResult<unknown> {
        return typeof value === "object" && value !== null &&
            "type" in value && typeof value["type"] === "string"
    }

    #executeErrorHooks(err: unknown): void {
        for (const hook of this.#onError) {
            hook(err)
        }
    }

    async #write<State>(writes: Write<State>[]) {
        const [, err ] = await tryCatch(this.#storage.write(writes))

        if (err !== undefined) {
            this.#executeErrorHooks(err)
        }
    }
}