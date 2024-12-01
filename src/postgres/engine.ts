import {TriggerInterface} from "../trigger.interface";
import {Client} from "pg";
import {Workflow} from "../workflow";
import {createTables} from "./create-tables";
import {Poller} from "../poll/poller";
import {PostgresStorage} from "./storage";
import {StorageTrigger} from "../poll/trigger";
import {GetTimeToWait} from "../retry";

export class PostgresWorkflowEngine {
  private constructor() {}

  async start<State> (opts: StartOpts<State>): Promise<void> {
    const {
      client,
      workflow,
      signal,
      pageSize = 20,
      pollingIntervalMs,
      maxAttempts = 3,
      timeBetweenRetries = () => 0
    } = opts

    await createTables(client)
    const storage = new PostgresStorage<State>(client)

    await new Poller<State>(
      pollingIntervalMs,
      storage,
      workflow,
      pageSize,
      maxAttempts,
      timeBetweenRetries,
    ).start(signal)
  }

  async getTrigger<State>(opts: GetTriggerOpts<State>): Promise<TriggerInterface<State>> {
    const { client, workflow } = opts
    await createTables(client)
    const storage = new PostgresStorage<State>(client)
    return new StorageTrigger(workflow, storage)
  }

  static create(): PostgresWorkflowEngine {
    return new PostgresWorkflowEngine()
  }
}

export type GetTriggerOpts<State> = {
  client: Client
  workflow: Workflow<State>
}

export type StartOpts<State> = {
  client: Client
  workflow: Workflow<State>
  pollingIntervalMs: number
  pageSize?: number
  signal: AbortSignal
  maxAttempts?: number
  timeBetweenRetries?: GetTimeToWait
}