import {Workflow} from "../workflow";
import {GetTimeToWait} from "../retry";
import {DefaultCustomWorkerMetadata, WorkerMetadata} from "../types";

export interface Ack<T> {
  type: "ack"
  record: PollerRecord<T>
}

export interface Publish<T> {
  type: "publish"
  record: WithoutIt<T>
}

export interface Nack<T> {
  type: "nack"
  record: PollerRecord<T>
  timeBetweenRetries: GetTimeToWait
}

export type Write<T> = Ack<T> | Publish<T> | Nack<T>

export interface StorageInterface<State, CustomMetadata extends DefaultCustomWorkerMetadata> {
  poll(pollerId: string, workflows: Workflow<State, CustomMetadata>[], pageSize: number, maxRetry: number): Promise<[ isPaginationExhausted: boolean, records: PollerRecord<State>[]]>
  batchWrite(writes: Write<State>[]): Promise<void>
}

export interface PollerRecord<T> {
  id: string
  recipient: string
  belongsTo: string
  createdAt: Date
  state: T
  tenant?: string
  attempt: number
}

export interface WithoutIt<T> extends Omit<PollerRecord<T>, "id"> {}