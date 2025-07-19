import {Queue} from "./queue";
import { WorkflowStateStorage, SearchableWorkflowStateStorage } from "./workflow/state/storage"

export interface Engine<WriteOpts> {
  /**
   * Create the queue where the messages to handle should be produced.
   */
  createQueue(): Queue<WriteOpts>

  /**
   * Create a storage
   */
  createStorage?: () => WorkflowStateStorage | SearchableWorkflowStateStorage
}