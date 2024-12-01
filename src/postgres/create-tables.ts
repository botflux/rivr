import {Client} from "pg";

export async function createTables(client: Client): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS workflow_messages (
    id integer primary key generated always as identity,
    workflow_name varchar(255),
    step_name varchar(255),
    step_data jsonb,
    attempts integer,
    acknowledged boolean,
    created_at timestamptz,
    min_date_before_next_attempt timestamptz
  )`)
}