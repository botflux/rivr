import { MongoClient } from "mongodb";
import { TriggerInterface } from "../trigger.interface";
import { Workflow } from "../workflow";
import { StepStateCollection } from "./step-state-collection";
import {MongodbStorage} from "./mongodb-storage";
import {StorageInterface} from "../poll/storage.interface";

export class MongoDBTrigger<State> implements TriggerInterface<State> {
    constructor(
        private readonly workflow: Workflow<State>,
        private readonly storage: StorageInterface<State>
    ) {}

    async trigger(state: State): Promise<void> {
        const mStep = this.workflow.getFirstStep()

        if (!mStep) {
            return
        }

        await this.storage.publish({
            createdAt: new Date(),
            state,
            belongsTo: this.workflow.name,
            recipient: mStep.name,
            context: { attempt: 1 }
        })
    }
}