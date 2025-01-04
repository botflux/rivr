import {TriggerInterface} from "../trigger.interface";
import {Client} from "pg";
import {Workflow} from "../workflow";
import {createTables} from "./create-tables";
import {Poller} from "../poll/poller";
import {PostgresStorage} from "./storage";
import {StorageTrigger} from "../poll/trigger";
import {GetTimeToWait} from "../retry";
import {randomUUID} from "node:crypto";
import {EngineInterface} from "../engine.interface";
import {WorkerInterface} from "../worker.interface";

export class PostgresWorkflowEngine implements EngineInterface {
  private constructor(
    private readonly opts: StartOpts
  ) {}

  getWorker<State>(workflow: Workflow<State>): WorkerInterface {
    const {
      client,
      pageSize = 20,
      pollingIntervalMs,
      maxAttempts = 3,
      timeBetweenRetries = () => 0
    } = this.opts

    return new Poller<State>(
      randomUUID(),
      pollingIntervalMs,
      async () => {
        await createTables(client)
        return new PostgresStorage<State>(client)
      },
      workflow,
      pageSize,
      maxAttempts,
      timeBetweenRetries,
    )
  }

  getTrigger<State>(workflow: Workflow<State>): TriggerInterface<State> {
    return new StorageTrigger(workflow, async () => {
      const { client } = this.opts
      await createTables(client)
      return new PostgresStorage<State>(client)
    })
  }

  static create(opts: StartOpts): PostgresWorkflowEngine {
    return new PostgresWorkflowEngine(opts)
  }
}

export type StartOpts = {
  client: Client
  pollingIntervalMs: number
  pageSize?: number
  maxAttempts?: number
  timeBetweenRetries?: GetTimeToWait
}