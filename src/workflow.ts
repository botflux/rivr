import {BatchStepHandler, Step, StepHandler, WorkflowBuilder} from "./types";

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