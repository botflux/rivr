import {
    BatchStepHandler,
    Step,
    StepHandler,
    WorkflowBuilder,
    DefaultCustomWorkerMetadata
} from "./types";

export class Workflow<State, CustomMetadata extends DefaultCustomWorkerMetadata> {

    private readonly steps: Step<State, CustomMetadata>[] = []

    private constructor(
        public readonly name: string,
    ) {}

    step(name: string, handler: StepHandler<State, CustomMetadata>): this {
        this.steps.push({
            name,
            handler,
            workflow: this,
            type: "single"
        })

        return this
    }

    batchStep(name: string, handler: BatchStepHandler<State, CustomMetadata>): this {
        this.steps.push({
            name,
            handler,
            workflow: this,
            type: "batch"
        })

        return this
    }

    getStepByName(name: string): Step<State, CustomMetadata> | undefined {
        return this.steps.find(step => step.name === name)
    }

    getSteps(): Step<State, CustomMetadata>[] {
        return this.steps
    }

    getFirstStep(): Step<State, CustomMetadata> | undefined {
        return this.steps[0]
    }

    getNextStep(step: Step<State, CustomMetadata>, offset: number = 1): Step<State, CustomMetadata> | undefined {
        const stepIndex = this.steps.findIndex(s => s.name === step.name)

        if (stepIndex === -1)
            return undefined

        const nextStepIndex = stepIndex + offset

        if (nextStepIndex >= this.steps.length)
            return undefined

        return this.steps[nextStepIndex]
    }

    static create<State, CustomMetadata extends DefaultCustomWorkerMetadata = DefaultCustomWorkerMetadata>(name: string, builder: WorkflowBuilder<State, CustomMetadata>): Workflow<State, CustomMetadata> {
        const w = new Workflow<State, CustomMetadata>(name)
        builder(w)
        return w
    }
}