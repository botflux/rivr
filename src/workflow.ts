import {Workflow as PublicWorkflow} from "./types.ts";

type EmptyDecorator = Record<never, never>

interface Workflow<State> extends PublicWorkflow<State, EmptyDecorator> {}

export const rivr = {
    workflow<State>(name: string): PublicWorkflow<State, Record<never, never>> {
        // @ts-expect-error
        const w = {} as Workflow<State, Record<never, never>>

        return w
    }
}