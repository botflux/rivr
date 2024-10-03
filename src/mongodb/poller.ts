import { OptionalId } from "mongodb";
import { Workflow } from "../workflow";
import { StepState } from "./step-state";
import { StepStateCollection } from "./step-state-collection";
import { setInterval, setTimeout } from "node:timers/promises"

export class MongoDBPoller {
    constructor(
        private readonly workflow: Workflow<unknown>,
        private readonly collection: StepStateCollection,
        private readonly pageSize: number,
        private readonly pollingIntervalMs: number,
        private readonly maxRetry: number,
        private readonly signal?: AbortSignal
    ) {}

    async start(): Promise<void> {
        let resolve: (() => void) | undefined
        let reject: ((reason?: any) => void) | undefined

        const p = new Promise<void>((res, rej) => {
            resolve = res
            reject = rej
        })

        resolve?.()

        ;(async () => {
            let stop = false

            this.signal?.addEventListener("abort", () => stop = true)

            try {
                for await (const _ of setInterval(0, { signal: this.signal })) {
                    const documents = await this.collection.pull(
                        this.workflow, 
                        this.workflow.getSteps(), 
                        this.pageSize,
                        this.maxRetry
                    )

                    for (const document of documents) {
                        if (stop) {
                            break
                        }

                        const mStep = this.workflow.getStepByName(document.recipient!)
                        
                        if (!mStep) {
                            continue
                        }

                        try {
                            const newState = (await mStep.handler(document.state, document.context)) ?? document.state

                            const newDocument: OptionalId<StepState<unknown>> = {
                                createdAt: new Date(),
                                belongsTo: this.workflow.name,
                                recipient: this.workflow.getNextStep(mStep)?.name,
                                state: newState,
                                acknowledged: false,
                                context: { attempt: 1 }
                            }

                            await this.collection.publishAndAcknowledge(newDocument, document)
                        } catch (error) {
                            await this.collection.nack(document)
                        }
                    }

                    const isPaginationExhausted = documents.length < this.pageSize

                    // if pagination exhausted, then do not wait the interval
                    if (isPaginationExhausted) {
                        await setTimeout(this.pollingIntervalMs)
                    }
                }
            } catch (e) {
                reject?.(e)
            }
        })()

        return p
    }
}