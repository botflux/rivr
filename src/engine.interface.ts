import {Workflow} from "./workflow";
import {TriggerInterface} from "./trigger.interface";
import {WorkerInterface} from "./worker.interface";

export interface EngineInterface {
  /**
   * Create a trigger for the given workflow.
   *
   * @param workflow
   */
  getTrigger<State>(workflow: Workflow<State>): TriggerInterface<State>

  /**
   * Get the worker for the given workflow.
   *
   * @param workflows
   */
  getWorker<State>(workflows: Workflow<State>[]): WorkerInterface

  /**
   * Stop any started workers and close any created connection pool.
   */
  stop(): Promise<void>
}