import {Workflow} from "./workflow";
import {TriggerInterface} from "./trigger.interface";

export interface EngineInterface {
  /**
   * Create a trigger for the given workflow.
   *
   * @param workflow
   */
  getTrigger<State>(workflow: Workflow<State>): TriggerInterface<State>
}