import {rivrPlugin} from "../../workflow/types";
import {WorkflowStateStorage} from "../../workflow/state/storage";

export type WorkflowStateStoragePluginOpts = {
  /**
   * The storage in which you want to persist the states.
   */
  storage: WorkflowStateStorage
}

/**
 * This plugin sends the workflow's state to a persistent storage.
 * Once stored, all the states can be listed and displayed on a UI.
 */
export const workflowStateStoragePlugin = rivrPlugin({
  name: "workflow-state-storage",
  plugin: (w, opts: WorkflowStateStoragePluginOpts) => {
    const workflow = w.input()

    workflow.addHook("onStepHandled", async (ctx, step, result, state) => {
      await opts.storage.upsert([ state ])
    })

    return workflow
  }
})