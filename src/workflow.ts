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
export type StepHandlerContext = { attempt: number }
export type StepHandler<State> = (state: State, context: StepHandlerContext) => void | State | StepResult<State> | Promise<void | State | StepResult<State>>

export type Step<State> = {
    name: string
    workflow: Workflow<State>
    handler: StepHandler<State>
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
            workflow: this
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