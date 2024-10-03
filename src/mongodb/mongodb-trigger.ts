import { MongoClient } from "mongodb";
import { TriggerInterface } from "../trigger.interface";
import { Workflow } from "../workflow";
import { StepStateCollection } from "./step-state-collection";

export class MongoDBTrigger<State> implements TriggerInterface<State> {
    constructor(
        private readonly workflow: Workflow<State>,
        private readonly collection: StepStateCollection
    ) {}

    async trigger(state: State): Promise<void> {
        await this.collection.publishAndAcknowledge({
            createdAt: new Date(),
            state,
            belongsTo: this.workflow.name,
            recipient: this.workflow.getFirstStep()?.name,
            acknowledged: false,
            context: { attempt: 1 }
        })
    }
}