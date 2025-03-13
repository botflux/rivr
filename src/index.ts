import {Job} from "./job";
import {WorkflowBuilder} from "./workflow";


export const rivr = {
  job: (name: string) => new Job(),
  workflow: (name: string) => new WorkflowBuilder()
}