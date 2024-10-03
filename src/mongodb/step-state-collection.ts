import { Collection, ObjectId, OptionalId } from "mongodb";
import { StepState } from "./step-state";
import { Step, Workflow } from "../workflow";

export class StepStateCollection {
    constructor(
        private readonly collection: Collection<StepState<unknown>>
    ) {}

    async pull<State>(workflow: Workflow<State>, steps: Step<State>[], pageSize: number, maxRetry: number): Promise<StepState<State>[]> {
        const stepNames = steps.map(step => step.name)

        const documents = await this.collection.find({
            belongsTo: workflow.name,
            recipient: {
                $in: stepNames
            },
            "context.attempt": { $lt: maxRetry },
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

    async nack<State>(state: StepState<State>): Promise<void> {
        await this.collection.findOneAndUpdate({
            _id: state._id
        }, {
            $inc: {
                "context.attempt": 1
            }
        })
    }

    async findStepStates(workflowName: string, stepName: string): Promise<StepState<unknown>[]> {
        return this.collection.find({
            belongsTo: workflowName,
            recipient: stepName
        }).toArray()
    } 
}