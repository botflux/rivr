export type WorkflowBuilder<State> = (w: Workflow<State>) => void
export type StepHandler<State> = (state: State) => void | State | Promise<void | State>

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

    getNextStep(step: Step<State>): Step<State> | undefined {
        const stepIndex = this.steps.findIndex(s => s.name === step.name)

        if (stepIndex === -1)
            return undefined

        const nextStepIndex = stepIndex + 1

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