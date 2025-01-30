import {PollerRecord, StorageInterface, WithoutIt, Write} from "../poll/storage.interface";
import {Workflow} from "../workflow";
import {Collection, ObjectId} from "mongodb";
import {GetTimeToWait} from "../retry";
import {AnyBulkWriteOperation, InsertOneModel} from "mongodb/lib/beta";
import {DefaultWorkerMetadata, Step} from "../types";
import {WorkerMetadata} from "./engine";

export interface MongodbRecord<T> extends Omit<PollerRecord<T>, "id"> {
  acknowledged: boolean
  minDateBeforeNextAttempt: Date
  handledBy: string
  handledByUntil: Date
}

export class MongodbStorage<State> implements StorageInterface<State, WorkerMetadata> {
    constructor(
      protected readonly collection: Collection<MongodbRecord<State>>,
    ) {}

    async poll(pollerId: string, workflows: Workflow<State, WorkerMetadata>[], pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<State>[]]> {
      const workflowNames = workflows.map (w => w.name)
      const steps = workflows.map(w => w.getSteps()).flat()
      const stepNames = steps.map(s => s.name)

      const documents = await this.collection.find({
        belongsTo: {
          $in: workflowNames
        },
        recipient: {
          $in: stepNames
        },
        attempt: { $lt: maxRetry },
        acknowledged: false,
      }).limit(pageSize).toArray()

      return [
        documents.length < pageSize,
        documents.map(({_id, ...doc}) => ({
          ...doc,
          id: _id.toString("hex")
        }))
      ]
    }

    async batchWrite(writes: Write<State>[]): Promise<void> {
      const ops: AnyBulkWriteOperation<MongodbRecord<State>>[] = writes.map(w => {
        switch (w.type) {
          case "ack":
            return {
              updateOne: {
                filter: {
                  _id: ObjectId.createFromHexString(w.record.id)
                },
                update: {
                  $set: {
                    acknowledged: true,
                  }
                }
              }
            } satisfies AnyBulkWriteOperation<MongodbRecord<State>>
          case "nack": {
            const minDateBeforeNextAttempt = new Date(new Date().getTime() + w.timeBetweenRetries(w.record.attempt))

            return {
              updateOne: {
                filter: {
                  _id: ObjectId.createFromHexString(w.record.id)
                },
                update: {
                  $inc: {
                    attempt: 1,
                  },
                  $set: {
                    minDateBeforeNextAttempt,
                    handledBy: "not_picked",
                    handledByUntil: new Date(0)
                  }
                }
              }
            } satisfies AnyBulkWriteOperation<MongodbRecord<State>>
          }
          case "publish":
            return {
              insertOne: {
                document: {
                  ...w.record,
                  acknowledged: false,
                  minDateBeforeNextAttempt: new Date(0),
                  handledBy: "not_picked",
                  handledByUntil: new Date(0)
                }
              }
            } satisfies AnyBulkWriteOperation<MongodbRecord<State>>
        }
      })

      await this.collection.bulkWrite(ops)
    }
}