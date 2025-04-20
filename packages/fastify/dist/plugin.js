"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fastifyRivr = void 0;
const fastify_plugin_1 = require("fastify-plugin");
exports.fastifyRivr = (0, fastify_plugin_1.fastifyPlugin)((instance, opts) => {
    let trigger;
    let worker;
    instance.decorate("rivr", {
        getEngine() {
            return opts.engine;
        },
        getTrigger() {
            if (trigger === undefined) {
                trigger = opts.engine.createTrigger();
            }
            return trigger;
        }
    });
    instance.addHook("onReady", async function () {
        worker = this.rivr.getEngine().createWorker();
        await worker.start(opts.workflows);
    });
    instance.addHook("onClose", async function () {
        await worker?.stop();
        await this.rivr.getEngine().close();
    });
}, {
    name: "fastify-rivr",
});
