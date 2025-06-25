import {Message} from "rivr";
import {PersistentSubscriptionToStreamSettings} from "@kurrent/kurrentdb-client";

export type CreateQueueOpts = {
  connectionString: string
  createPersistentSubscriptionOpts: CreatePersistentSubscriptionOpts
  /**
   * Build the stream name from a message.
   * This function allows to shard the queue in multiple streams.
   * Sharding the queue enables you to delete old stream easily.
   *
   * By default, the queue is sharded by hour.
   *
   * Depending on your workload, you may want to select another
   * suffix, such as a stream per minute, or a stream per day.
   *
   * @param msg
   */
  partitionStream?: (msg: Message) => string
}
export type CreatePersistentSubscriptionOpts = {
  groupName?: string
} & PersistentSubscriptionToStreamSettings