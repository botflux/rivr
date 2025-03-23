import { setTimeout } from "node:timers/promises"
import { type Trigger, type Worker } from "./core.ts"

import {StepOpts, StepResult, Workflow} from "./types.ts";

export type Task<State> = {
    id: string
    workflow: string
    step: string
    state: State
}

export type Ack<State> = {
    type: "ack"
    task: Task<State>
}

export type Insert<State> = {
    type: "insert"
    task: Omit<Task<State>, "id">
}

export type Nack<State> = {
    type: "nack"
    task: Task<State>
}

export type Write<State> = Ack<State> | Insert<State> | Nack<State>

export interface Storage {
    pull<State, Decorators>(workflows: Workflow<State, Decorators>[]): Promise<Task<State>[]>
    write<State>(writes: Write<State>[]): Promise<void>
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

export class PullTrigger implements Trigger {
    #storage: Storage

    constructor(storage: Storage) {
        this.#storage = storage
    }

    async trigger<State, Decorators>(workflow: Workflow<State, Decorators>, state: State): Promise<void> {
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
                    workflow: workflow.name
                }
            }
        ])
    }

}

export class Poller implements Worker {
    #loop = new InfiniteLoop()
    #storage: Storage

    #hasFinished = false

    constructor(storage: Storage) {
        this.#storage = storage
    }

    start<State, Decorators>(workflows: Workflow<State, Decorators>[]): void {
        (async () => {
            for (const _ of this.#loop) {
                const tasks = await this.#storage.pull(workflows)

                for (const task of tasks) {
                    const mWorkflow = workflows.find(w => w.name === task.workflow)

                    if (!mWorkflow)
                        continue

                    const mStep = mWorkflow.getStep(task.step)

                    if (!mStep)
                        continue

                    const result = this.#handleStep(mStep, task.state, mWorkflow)

                    switch(result.type) {
                        case "stopped": {
                            await this.#storage.write([
                                {
                                    type: "ack",
                                    task
                                }
                            ])

                            for (const handler of mWorkflow.onWorkflowStopped) {
                                handler(mWorkflow, mStep, task.state)
                            }

                            break
                        }

                        case "success": 
                        case "skipped": {
                            const newState = result.type === "skipped"
                                ? task.state
                                : result.state
                            const mNextStep = mWorkflow.getNextStep(task.step)

                            await this.#storage.write([
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
                                                workflow: mWorkflow.name
                                            }
                                        } satisfies Insert<State>
                                    ]
                                    : []
                            ])

                            if (result.type === "skipped") {
                                for (const handler of mWorkflow.onStepSkipped) {
                                    handler(mWorkflow, mStep, task.state)
                                }                                
                            }

                            for (const handler of mWorkflow.onStepCompleted) {
                                handler.call(this, mWorkflow, mStep, newState)
                            }

                            if (mNextStep === undefined) {
                                for (const handler of mWorkflow.onWorkflowCompleted) {
                                    handler.call(mWorkflow, mWorkflow, newState)
                                }
                            }

                            break
                        }

                        case "failure": {
                            await this.#storage.write([
                                {
                                    type: "nack",
                                    task
                                }
                            ])

                            for (const hook of mWorkflow.onStepError) {
                                hook(result.error, mWorkflow, task.state)
                            }
                        }
                    }
                }
            }

            this.#hasFinished = true
        })().catch(console.error)
    }

    async stop(): Promise<void> {
        this.#loop.stop()

        while (!this.#hasFinished) {
            await setTimeout(10)
        }

        await this.#storage.disconnect()
    }

    #handleStep<State, Decorators>(
        step: StepOpts<State, Decorators>, 
        state: State, 
        workflow: Workflow<State, Decorators>
    ): StepResult<State> {
        try {
            const nextStateOrResult = step.handler({
                state,
                workflow,
                ok: state => ({
                    type: "success",
                    state
                }),
                err: error => ({
                    type: "failure",
                    error
                }),
                skip: () => ({
                    type: "skipped"
                }),
                stop: () => ({
                    type: "stopped"
                })
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
}