import {TriggerInterface} from "../trigger.interface";
import {StorageInterface} from "./storage.interface";
import {DefaultWorkerMetadata, Workflow} from "../workflow";

export class StorageTrigger<State, WorkerMetadata extends DefaultWorkerMetadata> implements TriggerInterface<State> {
    constructor(
      private readonly workflow: Workflow<State, WorkerMetadata>,
      private readonly getStorage: () => Promise<StorageInterface<State, WorkerMetadata>>,
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