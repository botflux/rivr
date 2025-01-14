import {MongodbRecord, MongodbStorage} from "./mongodb-storage";
import {Workflow} from "../workflow";
import {PollerRecord} from "../poll/storage.interface";
import {WithId} from "mongodb/lib/beta";
import {Collection} from "mongodb";

export class ReplicatedMongodbStorage<State> extends MongodbStorage<State>{
  constructor(
    collection: Collection<MongodbRecord<State>>,
    private readonly lockDurationMs: number
  ) {
    super(collection);
  }

  override async poll(pollerId: string, workflows: Workflow<State>[], pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<State>[]]> {
    const workflowNames = workflows.map(w => w.name)
    const steps = workflows.map(w => w.getSteps()).flat()
    const names = steps.map(s => s.name)

    const documents: WithId<MongodbRecord<State>>[] = []

    for (let i = 0; i < pageSize; i++) {
      const document = await this.collection.findOneAndUpdate({
        $and: [
          {
            _id: {
              $nin: documents.map(doc => doc._id)
            },
            belongsTo: {
              $in: workflowNames
            },
            recipient: {
              $in: names
            },
            attempt: { $lt: maxRetry },
            acknowledged: false,
            // handledBy: { $in: [ pollerId, "not_picked" ] }
          },
          {
            $or: [
              {
                handledBy: { $in: [ pollerId, "not_picked" ] }
              },
              {
                handledBy: { $nin: [ pollerId, "not_picked" ] },
                handledByUntil: new Date(new Date().getTime() + this.lockDurationMs),
              }
            ]
          }
        ]
      }, {
        $set: {
          handledBy: pollerId,
          handledByUntil: new Date()
        }
      }, {
        returnDocument: "after",
        writeConcern: {
          journal: true
        }
      })

      if (!document) {
        break
      }

      documents.push(document)
    }

    return [
      documents.length < pageSize,
      documents.map(({_id, ...doc}) => ({
        ...doc,
        id: _id.toString("hex")
      }))
    ]
  }
}