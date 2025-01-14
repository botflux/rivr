export type Stop = { type: "stop" }
export type Skip = { type: "skip" }
export type Failure = { type: "failure", error: unknown }
export type Success<T> = { type: "success", value: T }
export type StepResult<T> = Success<T> | Failure | Stop | Skip

export function success<T> (result: T): Success<T> {
    return { type: "success", value: result }
}

export type FailureOpts = {}

export function failure(error: unknown, opts: FailureOpts = {}): Failure {
    return { type: "failure", error }
}

export function stop (): Stop {
    return { type: "stop" }
}

export function skip(): Skip {
    return { type: "skip" }
}

export function isStepResult (result: unknown): result is StepResult<unknown> {
    return result !== null && typeof result === "object"
        && "type" in result && (result["type"] === "failure" || result["type"] === "success" || result["type"] === "stop" || result["type"] === "skip")
}

export type WorkflowBuilder<State> = (w: Workflow<State>) => void

/**
 * Worker metadata represents data about the poller.
 * I've chosen 'worker' instead of 'poller' because
 * push based workflow engine will be called 'consumer'
 * rather than 'poller'.
 */
export type WorkerMetadata = {
    /**
     * The id of the worker that is handling the step.
     */
    workerId: string
}

export type StepExecutionMetadata = {
    /**
     * The current attempt of executing this message.
     */
    attempt: number

    tenant?: string

    /**
     * The step execution's id.
     */
    id: string
}

export type StepExecutionContext<State> = {
    /**
     * The state of the workflow.
     */
    state: State

    /**
     * Metadata about the step execution.
     */
    metadata: StepExecutionMetadata

    /**
     * Metadata about the worker
     */
    worker: WorkerMetadata
}

export type StepHandler<State> = (context: StepExecutionContext<State>) => void | State | StepResult<State> | Promise<void | State | StepResult<State>>
export type BatchStepHandler<State> = (contexts: StepExecutionContext<State>[], workerMetadata: WorkerMetadata) => void | State[] | StepResult<State>[] | Promise<void | State[] | StepResult<State>[]>

export type Step<State> = SingleStep<State> | BatchStep<State>

export type SingleStep<State> = {
    name: string
    workflow: Workflow<State>
    handler: StepHandler<State>
    type: "single"
}

export type BatchStep<State> = {
    name: string
    workflow: Workflow<State>
    handler: BatchStepHandler<State>
    type: "batch"
}

export class Workflow<State> {

    private readonly steps: Step<State>[] = []

    private constructor(
        public readonly name: string,
    ) {}

    step(name: string, handler: StepHandler<State>): this {
        this.steps.push({
            name,
            handler,
            workflow: this,
            type: "single"
        })

        return this
    }

    batchStep(name: string, handler: BatchStepHandler<State>): this {
        this.steps.push({
            name,
            handler,
            workflow: this,
            type: "batch"
        })

        return this
    }

    getStepByName(name: string): Step<State> | undefined {
        return this.steps.find(step => step.name === name)
    }

    getSteps(): Step<State>[] {
        return this.steps
    }

    getFirstStep(): Step<State> | undefined {
        return this.steps[0]
    }

    getNextStep(step: Step<State>, offset: number = 1): Step<State> | undefined {
        const stepIndex = this.steps.findIndex(s => s.name === step.name)

        if (stepIndex === -1)
            return undefined

        const nextStepIndex = stepIndex + offset

        if (nextStepIndex >= this.steps.length)
            return undefined

        return this.steps[nextStepIndex]
    }

    static create<State>(name: string, builder: WorkflowBuilder<State>): Workflow<State> {
        const w = new Workflow<State>(name)
        builder(w)
        return w
    }
}