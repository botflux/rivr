import { setTimeout } from "node:timers/promises"
import {OnErrorHook, type Trigger, type Worker} from "./core.ts"

import {Step, StepResult, Workflow} from "./types.ts";
import {tryCatch, tryCatchSync} from "./inline-catch.ts";
import {write} from "node:fs";

export type Task<State> =
    | WaitingTask<State>
    | FailedTask<State>
    | SuccessfulTask<State>

export type CommonTask<State> = {
    id: string
    workflow: string
    step: string
    state: State
    attempt: number
}

export type SuccessfulTask<State> = CommonTask<State> & {
    type: "success"
}

export type FailedTask<State> = CommonTask<State> & {
    type: "failed"
    canBeRetried: boolean
}

export type WaitingTask<State> = CommonTask<State> & {
    type: "waiting"
}

export type Ack<State> = {
    type: "ack"
    task: Task<State>
}

export type Insert<State> = {
    type: "insert"
    task: Omit<CommonTask<State>, "id">
}

export type Nack<State> = {
    type: "nack"
    task: Task<State>
}

export type Write<State> = Ack<State> | Insert<State> | Nack<State>

export interface Storage<WriteOpts> {
    pull<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<Task<State>[]>
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

export class PullTrigger<TriggerOpts> implements Trigger<TriggerOpts> {
    #storage: Storage<TriggerOpts>

    constructor(storage: Storage<TriggerOpts>) {
        this.#storage = storage
    }

    async trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State, opts?: TriggerOpts): Promise<void> {
        const mFirstStep = workflow.getFirstStep()

        if (!mFirstStep) {
            throw new Error("Cannot trigger a workflow that has no step")
        }

        await this.#storage.write([
            {
                type: "insert",
                task: {
                    state,
                    step: mFirstStep.name,
                    workflow: workflow.name,
                    attempt: 1
                }
            }
        ], opts)
    }

}

export class Poller<TriggerOpts> implements Worker {
    #loop = new InfiniteLoop()
    #storage: Storage<TriggerOpts>

    #hasFinished = false

    #onError: OnErrorHook[] = []

    constructor(storage: Storage<TriggerOpts>) {
        this.#storage = storage
    }

    async start<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<void> {
        for (const w of workflows) {
            await w.ready()
        }

        ;(async () => {
            for (const _ of this.#loop) {
                const [tasks, tasksErr] = await tryCatch(this.#storage.pull(workflows))

                if (tasksErr !== undefined) {
                    this.#executeErrorHooks(tasksErr)
                    continue
                }

                for (const task of tasks) {
                    const mWorkflow = workflows.find(w => w.name === task.workflow)

                    if (!mWorkflow)
                        continue

                    const mStepAndContext = mWorkflow.getStepAndExecutionContext(task.step)

                    if (!mStepAndContext)
                        continue

                    const [step, executionContext] = mStepAndContext

                    const result = await this.#handleStep(step, task, executionContext)

                    switch(result.type) {
                        case "stopped": {
                            await this.#write([
                                {
                                    type: "ack",
                                    task
                                }
                            ])

                            for (const [handler, context] of mWorkflow.getHook("onWorkflowStopped")) {
                                const [, error] = tryCatchSync(() => handler(context, step, task.state))

                                if (error !== undefined) {
                                    this.#executeErrorHooks(error)
                                }
                            }

                            break
                        }

                        case "success": 
                        case "skipped": {
                            const newState = result.type === "skipped"
                                ? task.state
                                : result.state
                            const mNextStep = mWorkflow.getNextStep(task.step)

                            await this.#write([
                                {
                                    type: "ack",
                                    task
                                },
                                ...mNextStep !== undefined
                                    ? [
                                        {
                                            type: "insert",
                                            task: {
                                                state: newState,
                                                step: mNextStep.name,
                                                workflow: mWorkflow.name,
                                                attempt: 1
                                            }
                                        } satisfies Insert<State>
                                    ]
                                    : []
                            ])

                            if (result.type === "skipped") {
                                for (const [handler, context] of mWorkflow.getHook("onStepSkipped")) {
                                    const [, error] = tryCatchSync(() => handler(context, step, task.state))

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
                            await this.#write([
                                {
                                    type: "nack",
                                    task,
                                }
                            ])

                            for (const [hook, context] of mWorkflow.getHook("onStepError")) {
                                const [, error] = tryCatchSync(() => hook(result.error, context, task.state))

                                if (error !== undefined) {
                                    this.#executeErrorHooks(error)
                                }
                            }

                            if (task.attempt + 1 > step.maxAttempts) {
                                for (const [hook, context] of mWorkflow.getHook("onWorkflowFailed")) {
                                    const [, error] = tryCatchSync(() => hook(result.error, context, step, task.state))

                                    if (error !== undefined) {
                                        this.#executeErrorHooks(error)
                                    }
                                }
                            }
                        }
                    }
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
        task: Task<State>,
        workflow: Workflow<State, Decorators>
    ): Promise<StepResult<State>> {
        try {
            const nextStateOrResult = await step.handler({
                state: task.state,
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
                attempt: task.attempt
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