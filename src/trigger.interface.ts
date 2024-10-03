export interface TriggerInterface<State> {
    /**
     * Trigger the workflow
     */
    trigger(state: State): Promise<void>
}