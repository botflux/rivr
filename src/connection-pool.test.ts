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
        return new MongoClient(mongo.getConnectionString(), {
          directConnection: true
        }).connect();
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

  await t.test("should be able to de-duplicate connection creation", async (t) => {
    // Given
    let calls = 0

    const pool = new ConnectionPool(
      async () => {
        calls ++
        return new MongoClient(mongo.getConnectionString(), {
          directConnection: true
        }).connect();
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
    await Promise.all([
      await pool.getConnection("foo"),
      await pool.getConnection("foo"),
      await pool.getConnection("foo"),
      await pool.getConnection("foo"),
      await pool.getConnection("foo"),
      await pool.getConnection("foo"),
      await pool.getConnection("foo")
    ])

    // Then
    assert.deepEqual(calls, 1)
  })

  await t.test("should be able to re-create connection is its not usable", async (t) => {
    // Given
    let calls = 0

    const pool = new ConnectionPool(
      async () => {
        calls ++
        return new MongoClient(mongo.getConnectionString(), {
          directConnection: true
        }).connect();
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
    const connection1 = await pool.getConnection("foo")
    await connection1.close(true)
    await pool.getConnection("foo")

    // Then
    assert.deepEqual(calls, 2)
  })

  await t.test("should be able to clean connections", async (t) => {
    // Given
    let calls = 0

    const pool = new ConnectionPool(
      async () => {
        calls ++
        return new MongoClient(mongo.getConnectionString(), {
          directConnection: true
        }).connect();
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
    const connection = await pool.getConnection("foo")
    await pool.clear()

    // Then
    await assert.rejects(async () => {
      await connection.db().command({ ping: 1 })
    }, Error)
  })

  await t.test("should be able to create a connection per tenant", async (t) => {
    // Given
    let calls = 0

    const pool = new ConnectionPool(
      async () => {
        calls ++
        return new MongoClient(mongo.getConnectionString(), {
          directConnection: true
        }).connect();
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
    const fooConnection = await pool.getConnection("foo")
    const barConnection = await pool.getConnection("bar")

    // Then
    assert.deepEqual(calls, 2)
    assert.notEqual(fooConnection, barConnection)
  })
})