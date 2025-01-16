export type Stop = { type: "stop" }
export type Skip = { type: "skip" }
export type Failure = { type: "failure", error: unknown }
export type Success<T> = { type: "success", value: T }
export type StepResult<T> = Success<T> | Failure | Stop | Skip

export function success<T> (result: T): Success<T> {
    return { type: "success", value: result }
}

export function failure(error: unknown): Failure {
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

export type WorkflowBuilder<State, WorkerMetadata extends DefaultWorkerMetadata> = (w: Workflow<State, WorkerMetadata>) => void

/**
 * Worker metadata represents data about the poller.
 * I've chosen 'worker' instead of 'poller' because
 * push based workflow engine will be called 'consumer'
 * rather than 'poller'.
 */
export type DefaultWorkerMetadata = {
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

export type StepExecutionContext<State, WorkerMetadata extends DefaultWorkerMetadata> = {
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

export type StepHandler<State, WorkerMetadata extends DefaultWorkerMetadata> = (context: StepExecutionContext<State, WorkerMetadata>) => void | State | StepResult<State> | Promise<void | State | StepResult<State>>
export type BatchStepHandler<State, WorkerMetadata extends DefaultWorkerMetadata> = (contexts: StepExecutionContext<State, WorkerMetadata>[], workerMetadata: DefaultWorkerMetadata) => void | State[] | StepResult<State>[] | Promise<void | State[] | StepResult<State>[]>

export type Step<State, WorkerMetadata extends DefaultWorkerMetadata> = SingleStep<State, WorkerMetadata> | BatchStep<State, WorkerMetadata>

export type SingleStep<State, WorkerMetadata extends DefaultWorkerMetadata> = {
    name: string
    workflow: Workflow<State, WorkerMetadata>
    handler: StepHandler<State, WorkerMetadata>
    type: "single"
}

export type BatchStep<State, WorkerMetadata extends DefaultWorkerMetadata> = {
    name: string
    workflow: Workflow<State, WorkerMetadata>
    handler: BatchStepHandler<State, WorkerMetadata>
    type: "batch"
}

export class Workflow<State, WorkerMetadata extends DefaultWorkerMetadata> {

    private readonly steps: Step<State, WorkerMetadata>[] = []

    private constructor(
        public readonly name: string,
    ) {}

    step(name: string, handler: StepHandler<State, WorkerMetadata>): this {
        this.steps.push({
            name,
            handler,
            workflow: this,
            type: "single"
        })

        return this
    }

    batchStep(name: string, handler: BatchStepHandler<State, WorkerMetadata>): this {
        this.steps.push({
            name,
            handler,
            workflow: this,
            type: "batch"
        })

        return this
    }

    getStepByName(name: string): Step<State, WorkerMetadata> | undefined {
        return this.steps.find(step => step.name === name)
    }

    getSteps(): Step<State, WorkerMetadata>[] {
        return this.steps
    }

    getFirstStep(): Step<State, WorkerMetadata> | undefined {
        return this.steps[0]
    }

    getNextStep(step: Step<State, WorkerMetadata>, offset: number = 1): Step<State, WorkerMetadata> | undefined {
        const stepIndex = this.steps.findIndex(s => s.name === step.name)

        if (stepIndex === -1)
            return undefined

        const nextStepIndex = stepIndex + offset

        if (nextStepIndex >= this.steps.length)
            return undefined

        return this.steps[nextStepIndex]
    }

    static create<State, WorkerMetadata extends DefaultWorkerMetadata = DefaultWorkerMetadata>(name: string, builder: WorkflowBuilder<State, WorkerMetadata>): Workflow<State, WorkerMetadata> {
        const w = new Workflow<State, WorkerMetadata>(name)
        builder(w)
        return w
    }
}