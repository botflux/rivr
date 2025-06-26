import {Message} from "rivr";
import {UNBOUNDED} from "@kurrent/kurrentdb-client/dist/constants";
import type {ConsumerStrategy} from "@kurrent/kurrentdb-client/dist/types";
import {SubscribeToPersistentSubscriptionToStreamOptions} from "@kurrent/kurrentdb-client";
import {DuplexOptions} from "node:stream";

export type CreateQueueOpts = {
  connectionString: string

  /**
   * Prefix all the stream's name with this value.
   * This feature is required to avoid collision between two apps
   * running the rivr KurentDB implementation at the same time
   * on the same instance of KurrentDB.
   *
   * TODO: ensure this value follows the convention of KurrentDB
   *       otherwise the persitent subscription won't work.
   */
  streamInfix: string

  createSubscriptionOpts?: CreatePersistentSubscriptionOpts
  subscribeOpts?: SubscribeToPersistentSubscriptionToStreamOptions
  subscribeDuplexOpts?: DuplexOptions

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
  /**
   * @default "rivr-consumers'
   */
  groupName?: string
  /**
   * Enable tracking of in depth latency statistics on this subscription.
   *
   * @default false
   */
  extraStatistics?: boolean;
  /**
   * The amount of time in milliseconds after which a message should be considered to be timeout and retried.
   * @default 30_000
   */
  messageTimeout?: number;
  /**
   * The maximum number of retries (due to timeout) before a message gets considered to be parked.
   * @default 10
   */
  maxRetryCount?: number;
  /**
   * The amount of time to try checkpoint after in milliseconds.
   * @default 2_000
   */
  checkPointAfter?: number;
  /**
   * The minimum number of messages to process before a checkpoint may be written.
   * @default 10
   */
  checkPointLowerBound?: number;
  /**
   * The maximum number of messages not checkpointed before forcing a checkpoint.
   * @default 1_000
   */
  checkPointUpperBound?: number;
  /**
   * The maximum number of subscribers allowed.
   * @default UNLIMITED
   */
  maxSubscriberCount?: typeof UNBOUNDED | number;
  /**
   * The size of the buffer listening to live messages as they happen.
   * @default 500
   */
  liveBufferSize?: number;
  /**
   * The number of events read at a time when paging in history.
   * @default 20
   */
  readBatchSize?: number;
  /**
   * The number of events to cache when paging through history.
   * @default 500
   */
  historyBufferSize?: number;
  /**
   * The strategy to use for distributing events to client consumers.
   * @default ROUND_ROBIN
   */
  consumerStrategyName?: ConsumerStrategy | string;
}

export class RivrInvalidStreamInfixError extends Error {
  constructor(invalidInfix: string) {
    super(`Cannot use '${invalidInfix}' as an infix because it contains '-'. This limitation is due to the consumption implementation that is based on category stream ('$ce-')`);
  }
}