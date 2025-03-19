import { setTimeout } from "node:timers/promises"
import { Trigger, Worker } from "./core"
import { Workflow } from "./workflow"

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

export type Write<State> = Ack<State> | Insert<State>

export interface Storage {
    pull<State>(workflows: Workflow<State>[]): Promise<Task<State>[]>
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

    async trigger<State>(workflow: Workflow<State>, state: State): Promise<void> {
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

    start<State>(workflows: Workflow<State>[]): void {
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

                    const nextState = mStep.handler({
                        state: task.state
                    })

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
                                        state: nextState,
                                        step: mNextStep.name,
                                        workflow: mWorkflow.name
                                    }
                                } satisfies Insert<State>
                            ]
                            : []
                    ])

                    if (mNextStep === undefined) {
                        for (const handler of mWorkflow.onWorkflowCompleted) {
                            handler.call(mWorkflow, mWorkflow, nextState)
                        }
                    }
                }
            }

            this.#hasFinished = true
        })()
    }

    async stop(): Promise<void> {
        this.#loop.stop()

        while (!this.#hasFinished) {
            await setTimeout(10)
        }

        await this.#storage.disconnect()
    }
}