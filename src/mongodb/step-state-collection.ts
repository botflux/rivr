import { Collection, ObjectId, OptionalId } from "mongodb";
import { StepState } from "./step-state";
import { Step, Workflow } from "../workflow";

export class StepStateCollection {
    constructor(
        private readonly collection: Collection<StepState<unknown>>
    ) {}

    async pull<State>(workflow: Workflow<State>, steps: Step<State>[], pageSize: number): Promise<StepState<State>[]> {
        const stepNames = steps.map(step => step.name)

        const documents = await this.collection.find({
            belongsTo: workflow.name,
            recipient: {
                $in: stepNames
            },
            acknowledged: false
        }).limit(pageSize).toArray()

        return documents as StepState<State>[]
    }

    async publishAndAcknowledge<State>(stateToPublish: OptionalId<StepState<State>>, stepToAcknoledge?: StepState<State>): Promise<void> {
        await this.collection.bulkWrite([
            {
                insertOne: {
                    document: stateToPublish
                }
            },
            ...stepToAcknoledge === undefined
                ? []
                : [
                    {
                        updateOne: {
                            filter: {
                                _id: stepToAcknoledge._id,
                            },
                            update: {
                                $set: {
                                    acknowledged: true
                                }
                            }
                        }
                    }
                ]
        ])
    }
}