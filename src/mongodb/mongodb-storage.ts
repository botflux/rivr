import {PollerRecord, StorageInterface, WithoutIt} from "../poll/storage.interface";
import {Workflow} from "../workflow";
import {Collection, ObjectId} from "mongodb";
import {GetTimeToWait} from "../retry";

export interface MongodbRecord<T> extends Omit<PollerRecord<T>, "id"> {
  acknowledged: boolean
  minDateBeforeNextAttempt: Date
}

export class MongodbStorage<T> implements StorageInterface<T> {
    constructor(
      private readonly collection: Collection<MongodbRecord<T>>,
    ) {}

    async poll(workflow: Workflow<T>, pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<T>[]]> {
      const steps = workflow.getSteps()
      const names = steps.map(s => s.name)

      const documents = await this.collection.find({
        belongsTo: workflow.name,
        recipient: {
          $in: names
        },
        "context.attempt": { $lt: maxRetry },
        acknowledged: false
      }).limit(pageSize).toArray()

      return [
        documents.length < pageSize,
        documents.map(({_id, ...doc}) => ({
          ...doc,
          id: _id.toString("hex")
        }))
      ]
    }

    async publish(newRecord: WithoutIt<T>): Promise<void> {
      await this.collection.insertOne({
        ...newRecord,
        acknowledged: false,
        minDateBeforeNextAttempt: new Date(0),
      })
    }

    async acknowledge(record: PollerRecord<T>): Promise<void> {
        await this.collection.findOneAndUpdate({
          _id: ObjectId.createFromHexString(record.id),
        }, {
          $set: {
            acknowledged: true
          }
        })
    }

    async nack(record: PollerRecord<T>, timeBetweenRetries: GetTimeToWait): Promise<void> {
      const minDateBeforeNextAttempt = new Date(new Date().getTime() + timeBetweenRetries(record.context.attempt))

      await this.collection.findOneAndUpdate({
        _id: ObjectId.createFromHexString(record.id),
      }, {
        $inc: {
          "context.attempt": 1,
        },
        $set: {
          minDateBeforeNextAttempt
        }
      })
    }

    async publishAndAcknowledge(newRecord: WithoutIt<T>, record: PollerRecord<T>): Promise<void> {
        await this.collection.bulkWrite([
          {
            insertOne: {
              document: {
                ...newRecord,
                acknowledged: false,
                minDateBeforeNextAttempt: new Date(0),
              }
            }
          },
          {
            updateOne: {
              filter: {
                _id: ObjectId.createFromHexString(record.id)
              },
              update: {
                $set: {
                  acknowledged: true,
                }
              }
            }
          }
        ])
    }
}