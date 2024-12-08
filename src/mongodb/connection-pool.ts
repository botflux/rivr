import {ConnectionPool} from "../connection-pool";
import {MongoClient} from "mongodb";

export class MongoDBConnectionPool extends ConnectionPool<MongoClient> {
  constructor(
    createConnection: (tenant: string) => Promise<MongoClient>,
    signal?: AbortSignal
  ) {
    super(
      createConnection,
      connection => connection.close(true),
      connection => connection.db().command({ ping: 1 })
        .then(() => true)
        .catch(() => false),
      signal
    )
  }
}