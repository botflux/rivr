import {BatchStepHandler, DefaultWorkerMetadata, Step, StepHandler, WorkflowBuilder} from "./types";

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