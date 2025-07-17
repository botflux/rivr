import {NormalizedWorkflowState, WorkflowStatus} from "./state";

export type ListWorkflowStateOpts = {
  page?: number
  limit?: number
}

export type ListWorkflowStateResult<State> = {
  previousPage?: number
  nextPage?: number
  results: NormalizedWorkflowState<State>[]
  totalCount: number
}

export interface WorkflowStateStorage {
  /**
   * Insert or update workflow states
   *
   * @param states
   */
  upsert<State>(states: NormalizedWorkflowState<State>[]): Promise<void>

  /**
   * Get a workflow state by its ID.
   *
   * @param id
   */
  get<State>(id: string): Promise<NormalizedWorkflowState<State> | undefined>

  /**
   * Disconnect from the underlying connection.
   */
  disconnect(): Promise<void>
}

export type SearchWorkflowStateOpts = {
  page?: number
  limit?: number
  status?: WorkflowStatus[]
  names?: string[]
}

export interface SearchableWorkflowStateStorage extends WorkflowStateStorage {
  /**
   * Search workflows.
   *
   * @param opts
   */
  search<State>(opts?: SearchWorkflowStateOpts): Promise<ListWorkflowStateResult<State>>
}