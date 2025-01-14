import {PollerRecord, StorageInterface, WithoutIt, Write} from "../poll/storage.interface";
import {Workflow} from "../workflow";
import {Collection, ObjectId} from "mongodb";
import {GetTimeToWait} from "../retry";
import {AnyBulkWriteOperation, InsertOneModel} from "mongodb/lib/beta";

export interface MongodbRecord<T> extends Omit<PollerRecord<T>, "id"> {
  acknowledged: boolean
  minDateBeforeNextAttempt: Date
  handledBy: string
  handledByUntil: Date
}

export class MongodbStorage<T> implements StorageInterface<T> {
    constructor(
      protected readonly collection: Collection<MongodbRecord<T>>,
    ) {}

    async poll(pollerId: string, workflows: Workflow<T>[], pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<T>[]]> {
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

    async batchWrite(writes: Write<T>[]): Promise<void> {
      const ops: AnyBulkWriteOperation<MongodbRecord<T>>[] = writes.map(w => {
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
            } satisfies AnyBulkWriteOperation<MongodbRecord<T>>
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
            } satisfies AnyBulkWriteOperation<MongodbRecord<T>>
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
            } satisfies AnyBulkWriteOperation<MongodbRecord<T>>
        }
      })

      await this.collection.bulkWrite(ops)
    }
}