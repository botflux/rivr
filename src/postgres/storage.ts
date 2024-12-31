import {PollerRecord, StorageInterface, WithoutIt, Write} from "../poll/storage.interface";
import {GetTimeToWait} from "../retry";
import {Workflow} from "../workflow";
import {Client} from "pg";

export class PostgresStorage<T> implements StorageInterface<T> {
  constructor(
    private readonly client: Client
  ) {
  }

  async poll(pollerId: string, workflow: Workflow<T>, pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<T>[]]> {
      const { rows } = await this.client.query(`
        SELECT * FROM "public"."workflow_messages"
        WHERE acknowledged = false
        AND min_date_before_next_attempt <= $1
        AND attempts <= $2
        LIMIT $3
      `, [
        new Date().toISOString(),
        maxRetry,
        pageSize
      ])

      const records: PollerRecord<T>[] = rows.map(({ workflow_name, step_name, step_data, created_at, attempts, id }) => ({
        belongsTo: workflow_name,
        recipient: step_name,
        id,
        state: step_data,
        createdAt: created_at,
        attempt: attempts
      }))

      return [ records.length < pageSize, records ]
    }

  async acknowledge(record: PollerRecord<T>): Promise<void> {
    await this.client.query(`UPDATE workflow_messages SET acknowledged = true WHERE id = $1`, [
      record.id
    ])
  }

  async nack(record: PollerRecord<T>, timeBetweenRetries: GetTimeToWait): Promise<void> {
    await this.client.query(`
      UPDATE "public"."workflow_messages"
      SET attempts = $1,
      min_date_before_next_attempt = $3
      WHERE id = $2
    `, [
      record.attempt + 1,
      record.id,
      this.addToDate(new Date(), timeBetweenRetries(record.attempt)),
    ])
  }

  async publish(newRecord: WithoutIt<T>): Promise<void> {
    const {
      belongsTo,
      createdAt,
      state,
      recipient,
      attempt
    } = newRecord

    await this.client.query(`
      INSERT INTO workflow_messages(workflow_name, step_name, step_data, attempts, created_at, acknowledged, min_date_before_next_attempt)
      VALUES ($1, $2, $3, $4, $5, false, $6)
    `, [
      belongsTo,
      recipient,
      state,
      attempt,
      createdAt,
      new Date().toISOString()
    ])
  }

  async batchWrite(writes: Write<T>[]): Promise<void> {
    await this.client.query("BEGIN")

    try {
      for (const write of writes) {
        switch (write.type) {
          case "publish": {
            const { record } = write

            await this.client.query(`
              INSERT INTO workflow_messages(workflow_name, step_name, step_data, attempts, created_at, acknowledged, min_date_before_next_attempt)
              VALUES ($1, $2, $3, $4, $5, false, $6)
            `, [
                record.belongsTo,
                record.recipient,
                record.state,
                record.attempt,
                record.createdAt,
                new Date().toISOString()
              ])
            break
          }
          case "nack": {
            const { record, timeBetweenRetries } = write
            await this.client.query(`
              UPDATE "public"."workflow_messages"
              SET attempts = $1,
              min_date_before_next_attempt = $3
              WHERE id = $2
            `, [
              record.attempt + 1,
              record.id,
              this.addToDate(new Date(), timeBetweenRetries(record.attempt)),
            ])
            break
          }
          case "ack": {
            const { record } = write
            await this.client.query(`UPDATE workflow_messages SET acknowledged = true WHERE id = $1`, [
              record.id
            ])
            break
          }
        }
      }

      await this.client.query("COMMIT")
    } catch (e) {
      await this.client.query("ROLLBACK")
      throw e
    }
  }

  private addToDate (date: Date, ms: number): Date {
    return new Date(date.getTime() + ms)
  }
}