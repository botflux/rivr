export interface TriggerInterface<State> {
    /**
     * Trigger the workflow
     *
     * @param state
     * @param tenant
     */
    trigger(state: State, tenant?: string): Promise<void>
}