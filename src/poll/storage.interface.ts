import {StepHandlerContext, Workflow} from "../workflow";
import {GetTimeToWait} from "../retry";

export interface StorageInterface<T> {
  poll(pollerId: string, workflow: Workflow<T>, pageSize: number, maxRetry: number): Promise<[ isPaginationExhausted: boolean, records: PollerRecord<T>[]]>
  acknowledge(record: PollerRecord<T>): Promise<void>
  nack(record: PollerRecord<T>, timeBetweenRetries: GetTimeToWait): Promise<void>
  publishAndAcknowledge(newRecord: WithoutIt<T>, record: PollerRecord<T>): Promise<void>
  publish(newRecord: WithoutIt<T>): Promise<void>
}

export interface PollerRecord<T> {
  id: string
  recipient: string
  belongsTo: string
  createdAt: Date
  state: T
  context: StepHandlerContext
}

export interface WithoutIt<T> extends Omit<PollerRecord<T>, "id"> {}