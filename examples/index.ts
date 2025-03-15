
type StepOpts<State, C extends Record<string, unknown>> = {
    name: string
    handler: StepHandler<State, C>
}
type StepHanderContext<State, C extends Record<string, unknown>> = {
    state: State
    workflow: Workflow<State, C>
}
type StepHandler<State, C extends Record<string, unknown>> = (ctx: StepHanderContext<State, C>) => State

class Workflow<State, C extends Record<string, unknown>> {
    ctx: C = {} as C

    decorate<K extends string, V>(key: K, value: V): Workflow<State, C & Record<K, V>> {
        throw new Error("not implemented")
    }

    addHook(hook: "onMessage", handler: (w: Workflow<State, C>) => void): this {
        return this
    }

    step(opts: StepOpts<State, C>): this {
        return this
    }
}

const rivr = {
    workflow<State>() {
        return new Workflow<State, Record<string, unknown>>()
    }
}

class Calculator {
    add(x: number, y: number): number {
        return x + y
    }
}

const wf = rivr.workflow<number>()
    .step({
        name: "my-step",
        handler: ({ state }) => state + 2
    })
    .decorate("calculator", new Calculator())
    .step({
        name: "add-6",
        handler: ({ state, workflow }) => workflow.ctx.calculator.add(state, 6)
    })
    .step({
        name: "minus-1",
        handler: ctx => ctx.success(ctx.state - 1)
    })
    .step({
        name: "devide-by-4",
        handler: ctx => {
            if (ctx.state === 0) {
                return ctx.fail(new Error("Cannot devide 0"))
            }

            return ctx.success(ctx.state / 4)
        }
    })
