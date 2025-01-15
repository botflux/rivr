import {DefaultWorkerMetadata, Workflow} from "./workflow";
import {TriggerInterface} from "./trigger.interface";
import {WorkerInterface} from "./worker.interface";

export interface EngineInterface<WorkerMetadata extends DefaultWorkerMetadata> {
  /**
   * Create a trigger for the given workflow.
   *
   * @param workflow
   */
  getTrigger<State>(workflow: Workflow<State, WorkerMetadata | DefaultWorkerMetadata>): TriggerInterface<State>

  /**
   * Get the worker for the given workflow.
   *
   * @param workflows
   */
  getWorker<State>(workflows: Workflow<State, WorkerMetadata | DefaultWorkerMetadata>[]): WorkerInterface

  /**
   * Stop any started workers and close any created connection pool.
   */
  stop(): Promise<void>
}