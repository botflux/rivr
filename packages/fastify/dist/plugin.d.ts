import { Engine, Trigger } from "rivr";
import { Workflow } from "rivr";
import { FastifyInstance } from "fastify";
export type RivrObject = {
    getEngine<TriggerOpts extends Record<never, never>>(): Engine<TriggerOpts>;
    getTrigger<TriggerOpts extends Record<never, never>>(): Trigger<TriggerOpts>;
};
export type FastifyRivrOpts<TriggerOpts extends Record<never, never>> = {
    engine: Engine<TriggerOpts>;
    workflows: Workflow<any, any>[];
};
declare module "fastify" {
    interface FastifyInstance {
        rivr: RivrObject;
    }
}
export declare const fastifyRivr: (instance: FastifyInstance<import("fastify").RawServerDefault, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>, opts: FastifyRivrOpts<Record<never, never>>) => void;
