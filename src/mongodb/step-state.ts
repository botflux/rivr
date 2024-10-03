import { ObjectId } from "mongodb"
import { StepHandlerContext } from "../workflow"

export type StepState<State> = {
    _id: ObjectId

    /**
     * The step that should be executed using the current state.
     */
    recipient?: string

    /**
     * The workflow's name to which this state belongs to.
     */
    belongsTo?: string

    /**
     * The actual state of the step
     */
    state: State

    /**
     * The step state's creation date.
     */
    createdAt: Date

    acknowledged: boolean

    context: StepHandlerContext
}

