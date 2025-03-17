import { setTimeout } from "timers/promises"
import { FailureResult, HandlerResult, SkipResult, StepOpts, SuccessResult, Worker, Workflow } from "./core"

export type JobRecord<State> = {
    id: string
    workflow: string
    step: string
    ack: boolean
    state: State
}

export type AckJob<State> = {
    type: "ack"
    record: JobRecord<State>
}
export type NackJob<State> = {
    type: "nack"
    record: JobRecord<State>
}
export type InsertJob<State> = {
    type: "insert",
    record: Omit<JobRecord<State>, "id">
}
export type JobWrite<State> = AckJob<State> | NackJob<State> | InsertJob<State>

export type PullOpts<State> = {
    workflows: Workflow<State>[]
}

export interface Storage<State> {
    pull(opts: PullOpts<State>): Promise<JobRecord<State>[]>
    write(writes: JobWrite<State>[]): Promise<void>
    disconnect(): Promise<void>
}

export class InfiniteLoop {
    #stop: boolean = false;

    *[Symbol.iterator]() {
        while (!this.#stop) {
            yield
        }
    }

    stop(): void {
        this.#stop = true
    }
}

export class Poller implements Worker {
    #loop = new InfiniteLoop();
    #isStopped: boolean = false;
    #storage: Storage<unknown>;

    constructor(storage: Storage<unknown>) {
        this.#loop = new InfiniteLoop();
        this.#storage = storage;
    }

    start(workflows: Workflow<unknown>[]): void {
        console.log("starting worker");
        (async () => {
            try {
                for (const _ of this.#loop) {
                    const jobs = await this.#storage.pull({ workflows });
                    console.log("jobs", jobs.length);

                    for (const job of jobs) {
                        const mWorkflow = workflows.find(w => w.name === job.workflow);

                        if (!mWorkflow)
                            continue;

                        const mStep = mWorkflow.getStep(job.step);

                        if (!mStep)
                            continue;

                        console.log("handling...", mStep.name);
                        const result = this.#executeHandler(mStep, job.state, mWorkflow);
                        const mNextStep = mWorkflow.getNextStep(job.step);

                        if (result.type === "failure") {
                            await this.#storage.write([
                                {
                                    type: "nack",
                                    record: job
                                },
                            ]);

                            mWorkflow.emit("stepFailed", { error: result.error });

                            continue;
                        }

                        if (result.type === "skip") {
                            const mNextStep = mWorkflow.getNextStep(job.step)

                            console.log("mNextStep", mNextStep)

                            await this.#storage.write([
                                {
                                    type: "ack",
                                    record: job
                                },
                                ...mNextStep !== undefined
                                ? [
                                    {
                                        type: "insert",
                                        record: {
                                            workflow: mWorkflow.name,
                                            step: mNextStep.name,
                                            ack: false,
                                            state: job.state
                                        }
                                    } satisfies InsertJob<unknown>
                                ]
                                : []
                            ])   

                            mWorkflow.emit("stepSkipped")

                            if (mNextStep === undefined) {
                                mWorkflow.emit("workflowCompleted", { state: job.state });
                            }
                            continue
                        }

                        await this.#storage.write([
                            {
                                type: "ack",
                                record: job
                            },
                            ...mNextStep !== undefined
                                ? [
                                    {
                                        type: "insert",
                                        record: {
                                            workflow: mWorkflow.name,
                                            step: mNextStep.name,
                                            ack: false,
                                            state: result.newState
                                        }
                                    } satisfies InsertJob<unknown>
                                ]
                                : []
                        ]);

                        if (mNextStep === undefined) {
                            mWorkflow.emit("workflowCompleted", { state: result.newState });
                        }
                    }

                    await setTimeout(200);
                }
            } catch (error: unknown) {
                console.log(error);
            } finally {
                this.#isStopped = true;
            }
        })();
        console.log("worker started");
    }

    async stop(): Promise<void> {
        this.#loop.stop();

        while (!this.#isStopped) {
            await setTimeout(10);
        }

        await this.#storage.disconnect();
    }

    #executeHandler(step: StepOpts<unknown, Workflow<unknown>>, state: unknown, workflow: Workflow<unknown>): HandlerResult<unknown> {
        try {
            const newStateOrResult = step.handler({
                state,
                success: (newState: unknown) => ({
                    type: "success",
                    newState
                }),
                fail: (error: unknown) => ({
                    type: "failure",
                    error
                }),
                skip: () => ({
                    type: "skip"
                }),
                workflow
            });

            if (this.#isSuccessResult(newStateOrResult) || this.#isFailureResult(newStateOrResult) ||
                this.#isSkipResult(newStateOrResult)) {
                return newStateOrResult;
            }

            return {
                type: "success",
                newState: newStateOrResult
            };
        } catch (error: unknown) {
            return {
                type: "failure",
                error
            };
        }
    }

    #isSuccessResult(state: unknown): state is SuccessResult<unknown> {
        return typeof state === "object" &&
            state !== null &&
            "type" in state &&
            state.type === "success";
    }

    #isFailureResult(state: unknown): state is FailureResult {
        return typeof state === "object" &&
            state !== null &&
            "type" in state &&
            state.type === "failure";
    }

    #isSkipResult(state: unknown): state is SkipResult {
        return typeof state === "object" &&
        state !== null &&
        "type" in state &&
        state.type === "skip";
    }
}
