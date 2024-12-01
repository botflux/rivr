import {MongodbRecord, MongodbStorage} from "./mongodb-storage";
import {Workflow} from "../workflow";
import {PollerRecord} from "../poll/storage.interface";
import {WithId} from "mongodb/lib/beta";

export class ReplicatedMongodbStorage<State> extends MongodbStorage<State>{
  override async poll(pollerId: string, workflow: Workflow<State>, pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<State>[]]> {
    const steps = workflow.getSteps()
    const names = steps.map(s => s.name)

    const documents: WithId<MongodbRecord<State>>[] = []

    for (let i = 0; i < pageSize; i++) {
      const document = await this.collection.findOneAndUpdate({
        $and: [
          {
            _id: {
              $nin: documents.map(doc => doc._id)
            },
            belongsTo: workflow.name,
            recipient: {
              $in: names
            },
            "context.attempt": { $lt: maxRetry },
            acknowledged: false,
            handledBy: { $in: [ pollerId, "not_picked" ] }
          },
        ]
      }, {
        $set: {
          handledBy: pollerId
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