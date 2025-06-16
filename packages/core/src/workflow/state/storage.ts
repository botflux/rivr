import {WorkflowState} from "./state";

export type ListWorkflowStateOpts = {
  page?: number
  limit?: number
}

export type ListWorkflowStateResult<State> = {
  previousPage?: number
  nextPage?: number
  results: WorkflowState<State>[]
  totalCount: number
}

export interface WorkflowStateStorage {
  /**
   * Insert or update workflow states
   *
   * @param states
   */
  upsert<State>(states: WorkflowState<State>[]): Promise<void>

  /**
   * Get a workflow state by its ID.
   *
   * @param id
   */
  get<State>(id: string): Promise<WorkflowState<State> | undefined>

  /**
   * List workflow state page by page.
   *
   * @param opts
   */
  list<State>(opts?: ListWorkflowStateOpts): Promise<ListWorkflowStateResult<State>>
}

export type SearchWorkflowStateOpts = {
  page?: number
  limit?: number
}

export interface SearchableWorkflowStateStorage extends WorkflowStateStorage {
  /**
   * Search workflows.
   *
   * @param opts
   */
  search<State>(opts?: SearchWorkflowStateOpts): Promise<ListWorkflowStateResult<State>>
}