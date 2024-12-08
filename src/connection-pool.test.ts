import { test } from "node:test"
import {ConnectionPool} from "./connection-pool";
import {MongoDBContainer, StartedMongoDBContainer} from "@testcontainers/mongodb";
import {MongoClient} from "mongodb";
import assert from "node:assert";

test("connection pool", async (t) => {
  let mongo: StartedMongoDBContainer = undefined!

  t.before(async () => {
    mongo = await new MongoDBContainer().start()
  })

  t.after(async () => {
    await mongo?.stop()
  })

  await t.test("should be able to create and reuse connection", async (t) => {
    // Given
    let calls = 0

    const pool = new ConnectionPool(
      async () => {
        calls ++
        return await await new MongoClient(mongo.getConnectionString(), {
          directConnection: true
        }).connect()
      },
      async connection => await connection.close(true),
      async connection => {
        try {
          await connection.db().command({ ping: 1 })
          return true
        } catch {
          return false
        }
      },
      t.signal
    )

    // When
    await pool.getConnection("foo")
    await pool.getConnection("foo")

    // Then
    assert.deepEqual(calls, 1)
  })
})