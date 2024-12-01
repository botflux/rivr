import {PollerRecord, StorageInterface, WithoutIt} from "../poll/storage.interface";
import {GetTimeToWait} from "../retry";
import {Workflow} from "../workflow";
import {Client} from "pg";

export class PostgresStorage<T> implements StorageInterface<T> {
  constructor(
    private readonly client: Client
  ) {
  }

  async poll(workflow: Workflow<T>, pageSize: number, maxRetry: number): Promise<[isPaginationExhausted: boolean, records: PollerRecord<T>[]]> {
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
        context: { attempt: attempts },
        state: step_data,
        createdAt: created_at
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
      record.context.attempt + 1,
      record.id,
      this.addToDate(new Date(), timeBetweenRetries(record.context.attempt)),
    ])
  }

  async publishAndAcknowledge(newRecord: WithoutIt<T>, record: PollerRecord<T>): Promise<void> {
    await this.client.query("BEGIN")

    try {
      await this.publish(newRecord)
      await this.acknowledge(record)
      await this.client.query("COMMIT")
    } catch (e) {
      await this.client.query("ROLLBACK")
      throw e
    }
  }

  async publish(newRecord: WithoutIt<T>): Promise<void> {
    const {
      belongsTo,
      createdAt,
      context,
      state,
      recipient
    } = newRecord

    await this.client.query(`
      INSERT INTO workflow_messages(workflow_name, step_name, step_data, attempts, created_at, acknowledged, min_date_before_next_attempt)
      VALUES ($1, $2, $3, $4, $5, false, $6)
    `, [
      belongsTo,
      recipient,
      state,
      context.attempt,
      createdAt,
      new Date().toISOString()
    ])
  }

  private addToDate (date: Date, ms: number): Date {
    return new Date(date.getTime() + ms)
  }
}