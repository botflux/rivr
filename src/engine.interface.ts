import {Workflow} from "./workflow";
import {TriggerInterface} from "./trigger.interface";
import {WorkerInterface} from "./worker.interface";
import {WorkerMetadata} from "./types";

export interface EngineInterface<WorkerMetadata extends WorkerMetadata> {
  /**
   * Create a trigger for the given workflow.
   *
   * @param workflow
   */
  getTrigger<State>(workflow: Workflow<State, WorkerMetadata | WorkerMetadata>): TriggerInterface<State>

  /**
   * Get the worker for the given workflow.
   *
   * @param workflows
   */
  getWorker<State>(workflows: Workflow<State, WorkerMetadata | WorkerMetadata>[]): WorkerInterface

  /**
   * Stop any started workers and close any created connection pool.
   */
  stop(): Promise<void>
}