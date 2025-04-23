type StepHandler<In, Out> = (input: In) => Out

type StepOpts<Step extends string, In, Out> = {
  name: Step
  handler: StepHandler<In, Out>
}

interface Workflow<State, Steps extends Record<never, never>> {
  step<Step extends string, NewState>(opts: StepOpts<Step, State, NewState>): Workflow<NewState, Steps & Record<Step, State>>
}

function makeWorkflow<T> (): Workflow<T, Record<never, never>> {
  return {} as Workflow<never, Record<never, never>>
}

function trigger<Steps extends Record<never, never>, Step extends keyof Steps> (workflow: Workflow<any, Steps>, step: Step, input: Steps[Step]) {

}

const w = makeWorkflow<number>()
  .step({
    name: "is-even",
    handler: input => input % 2 === 0
  })
  .step({
    name: "is-positive",
    handler: input => input ? 100 : -100
  })
  .step({
    name: "stringified",
    handler: input => input.toString()
  })
  .step({
    name: "is-even",
    handler: input => input.length % 2 === 0
  })

trigger(w, "is-positive", true)
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })
  // .step({
  //   name: "is-even",
  //   handler: input => input.toString()
  // })