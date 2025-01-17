import {TriggerInterface} from "../trigger.interface";
import {StorageInterface} from "./storage.interface";
import {Workflow} from "../workflow";
import {DefaultCustomWorkerMetadata} from "../types";

export class StorageTrigger<State, CustomMetadata extends DefaultCustomWorkerMetadata> implements TriggerInterface<State> {
    constructor(
      private readonly workflow: Workflow<State, CustomMetadata>,
      private readonly getStorage: () => Promise<StorageInterface<State, CustomMetadata>>,
    ) {
    }

    async trigger(state: State, tenant?: string): Promise<void> {
      const storage = await this.getStorage();
      const mStep = this.workflow.getFirstStep()

      if (!mStep) {
        return
      }

      await storage.batchWrite([
        {
          type: "publish",
          record: {
            createdAt: new Date(),
            state,
            belongsTo: this.workflow.name,
            recipient: mStep.name,
            tenant,
            attempt: 1
          }
        }
      ])
    }
}