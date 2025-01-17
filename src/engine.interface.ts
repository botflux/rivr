import {Workflow} from "./workflow";
import {TriggerInterface} from "./trigger.interface";
import {WorkerInterface} from "./worker.interface";
import {DefaultCustomWorkerMetadata, WorkerMetadata} from "./types";

export interface EngineInterface<CustomMetadata extends DefaultCustomWorkerMetadata> {
  /**
   * Create a trigger for the given workflow.
   *
   * @param workflow
   */
  getTrigger<State>(workflow: Workflow<State, CustomMetadata>): TriggerInterface<State>

  /**
   * Get the worker for the given workflow.
   *
   * @param workflows
   */
  getWorker<State>(workflows: Workflow<State, CustomMetadata>[]): WorkerInterface

  /**
   * Stop any started workers and close any created connection pool.
   */
  stop(): Promise<void>
}