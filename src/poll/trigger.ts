import {TriggerInterface} from "../trigger.interface";
import {StorageInterface} from "./storage.interface";
import {Workflow} from "../workflow";

export class StorageTrigger<State> implements TriggerInterface<State> {
    constructor(
      private readonly workflow: Workflow<State>,
      private readonly storage: StorageInterface<State>,
    ) {
    }

    async trigger(state: State, tenant?: string): Promise<void> {
      const mStep = this.workflow.getFirstStep()

      if (!mStep) {
        return
      }

      // await this.storage.publish({
      //   createdAt: new Date(),
      //   state,
      //   belongsTo: this.workflow.name,
      //   recipient: mStep.name,
      //   context: { attempt: 1, tenant }
      // })

      await this.storage.batchWrite?.([
        {
          type: "publish",
          record: {
            createdAt: new Date(),
            state,
            belongsTo: this.workflow.name,
            recipient: mStep.name,
            context: { attempt: 1, tenant }
          }
        }
      ])
    }
}