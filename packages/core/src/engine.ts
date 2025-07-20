import {Queue} from "./queue";
import { WorkflowStateStorage, SearchableWorkflowStateStorage } from "./workflow/state/storage"
import {DeadLetterQueue} from "./dead-letter-queue";

export interface Engine<WriteOpts> {
  /**
   * Create the queue where the messages to handle should be produced.
   */
  createQueue(): Queue<WriteOpts>

  /**
   * Create the queue where the messages that couldn't be delivery are stored.
   */
  createDeadLetterQueue?(): DeadLetterQueue<WriteOpts>

  /**
   * Create a storage
   */
  createStorage?: () => WorkflowStateStorage | SearchableWorkflowStateStorage
}