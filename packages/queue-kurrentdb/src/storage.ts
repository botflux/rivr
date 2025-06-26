import {JSONEventData} from "@kurrent/kurrentdb-client/dist/types/events";
import {JSONEventType, KurrentDBClient} from "@kurrent/kurrentdb-client";
import {WorkflowState, WorkflowStateStorage} from "rivr";

import {RivrInvalidStreamInfixError} from "./public-types";

type CreateStorageOpts = {
  connectionString: string
  streamInfix: string
}
type WorkflowStateEvent<State> = JSONEventData<JSONEventType<
  "workflow_state_changed",
  WorkflowState<State>
>>
const workflowStateStreamPrefix = "RivrWorkflowStates"

class KurrentDBWorkflowStateStorage implements WorkflowStateStorage {
  #opts: CreateStorageOpts
  #client: KurrentDBClient | undefined

  constructor(opts: CreateStorageOpts) {
    this.#opts = opts
  }

  async upsert<State>(states: WorkflowState<State>[]): Promise<void> {
    const client = this.#getClient()

    const eventsByStream = states.map(state => {
      const streamName = `${workflowStateStreamPrefix}${this.#opts.streamInfix}-${state.id}`
      const event = {
        type: "workflow_state_changed",
        id: state.id,
        contentType: "application/json",
        data: state,
        metadata: {}
      } as WorkflowStateEvent<State>

      return [streamName, event] as const
    })

    await Promise.all(eventsByStream.map(([streamName, event]) =>
      client.appendToStream(streamName, [event])
    ))
  }

  async get<State>(id: string): Promise<WorkflowState<State> | undefined> {
    const client = this.#getClient()
    const streamName = `${workflowStateStreamPrefix}${this.#opts.streamInfix}-${id}`

    try {
      const events = client.readStream<WorkflowStateEvent<State>>(streamName, {
        direction: "backwards",
        fromRevision: "end"
      })

      for await (const event of events) {
        if (event.event?.data) {
          return this.#deserializeWorkflowState(event.event.data)
        }
      }

      return undefined
    } catch (error: unknown) {
      // If the stream doesn't exist, return undefined
      if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'stream-not-found') {
        return undefined
      }
      throw error
    }
  }

  #getClient(): KurrentDBClient {
    if (this.#client === undefined) {
      this.#client = KurrentDBClient.connectionString(this.#opts.connectionString)
    }
    return this.#client
  }

  #deserializeWorkflowState<State>(data: WorkflowState<State>): WorkflowState<State> {
    return {
      ...data,
      lastModified: new Date(data.lastModified),
      toExecute: {
        ...data.toExecute,
        ...data.toExecute?.pickAfter !== undefined && {
          pickAfter: new Date(data.toExecute.pickAfter)
        }
      },
    }
  }
}

export function createStorage(opts: CreateStorageOpts): WorkflowStateStorage {
  if (opts.streamInfix.includes("-")) {
    throw new RivrInvalidStreamInfixError(opts.streamInfix)
  }

  return new KurrentDBWorkflowStateStorage(opts)
}