"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rivr = void 0;
const list_1 = require("./utils/list");
function isStep(node) {
    return node.type === 'step';
}
function isHook(node) {
    return node.type === 'hook';
}
function isPlugin(node) {
    return node.type === 'plugin';
}
function isHookType(hook) {
    return function (node) {
        return node.hook.type === hook;
    };
}
function createPluginWorkflow(parent, list) {
    const workflow = {
        decorate(key, value) {
            // @ts-expect-error
            parent.decorate.call(parent, key, value);
            return this;
        },
        list,
    };
    Object.setPrototypeOf(workflow, parent);
    return workflow;
}
function createChildWorkflow(parent, list, startIndex) {
    const workflow = {
        list,
        registeredDecorators: [],
        pluginStartIndex: startIndex,
        isReady: false
    };
    Object.setPrototypeOf(workflow, parent);
    return workflow;
}
function createRootWorkflow(name) {
    const list = new list_1.ArrayAdapter();
    const workflow = {
        list,
        isReady: false,
        nextNodeId: 0,
        autoPluginId: 0,
        name,
        registeredDecorators: [],
        generateNewNodeId() {
            return this.nextNodeId++;
        },
        decorate,
        addHook(hook, handler) {
            this.list.append({
                type: "hook",
                id: this.generateNewNodeId(),
                context: this,
                hook: {
                    type: hook,
                    hook: handler
                }
            });
            // this.dag.addNode({
            //     type: "hook",
            //     context: this as Workflow<State>,
            //     hook: {
            //         type: hook,
            //         hook: handler
            //     } as Hook<State>
            // }, (this as Workflow<State>).node)
            return this;
        },
        step(opts) {
            const { delayBetweenAttempts = 0, optional = false, maxAttempts = 1, ...requiredFields } = opts;
            this.list.append({
                type: "step",
                context: this,
                id: this.generateNewNodeId(),
                step: {
                    ...requiredFields,
                    optional,
                    delayBetweenAttempts,
                    maxAttempts
                }
            });
            // this.dag.addNode({
            //     type: "step",
            //     context: this,
            //     step: {
            //         ...requiredFields,
            //         optional,
            //         delayBetweenAttempts,
            //         maxAttempts
            //     }
            // }, this.node)
            return this;
        },
        getFirstStep() {
            for (const node of this.list) {
                if (node.type === "step") {
                    return node.step;
                }
            }
        },
        getStepAndExecutionContext(name) {
            for (const node of this.list) {
                if (node.type === "step" && node.step.name === name) {
                    return [node.step, node.context];
                }
            }
        },
        getNextStep(name) {
            const nodes = Array.from(this.list)
                .filter(isStep);
            const index = nodes.findIndex(node => node.step.name === name);
            if (index === -1) {
                throw new Error(`No step matching the name '${name}'`);
            }
            const nextStepIndex = index + 1;
            const node = nextStepIndex >= nodes.length
                ? undefined
                : nodes[nextStepIndex];
            return node?.step;
        },
        steps() {
            return Array.from(this.list)
                .filter(isStep)
                .map(node => [node.step, node.context]);
        },
        // @ts-expect-error
        getHook(hook) {
            return Array.from(this.list)
                .filter(isHook)
                .filter(isHookType(hook))
                .map(node => [node.hook.hook, node.context]);
        },
        register(plugin, opts) {
            const child = createChildWorkflow(this, this.list, this.list.length + 1);
            const rivrPlugin = isRivrPlugin(plugin)
                ? plugin
                : toRivrPlugin(plugin, () => `auto-plugin-${this.autoPluginId++}`);
            this.list.append({
                type: "plugin",
                plugin: rivrPlugin,
                context: child,
                pluginOpts: opts,
                id: this.generateNewNodeId()
            });
            return child;
        },
        async ready() {
            if (this.isReady) {
                return this;
            }
            let visited = [];
            let index = 0;
            for (const node of this.list) {
                if (visited.includes(node.id))
                    continue;
                visited.push(node.id);
                if (node.type !== "plugin")
                    continue;
                const deps = (node.plugin.opts.deps ?? []);
                const registeredPlugins = Array.from(this.list.reverseIteratorFromIndex(index))
                    .filter(isPlugin)
                    .map(node => node.plugin.opts.name);
                const unsatisfiedDeps = deps.filter(plugin => !registeredPlugins.includes(plugin.opts.name));
                if (unsatisfiedDeps.length > 0) {
                    throw new Error(`Plugin "${node.plugin.opts.name}" needs "${unsatisfiedDeps[0].opts.name}" to be registered`);
                }
                const pluginOpts = typeof node.pluginOpts === "function"
                    ? node.pluginOpts(this)
                    : node.pluginOpts;
                const pluginScope = createPluginWorkflow(node.context, new list_1.Slice(node.context.list, node.context.pluginStartIndex));
                node.plugin(pluginScope, pluginOpts);
                node.context.isReady = true;
                index++;
            }
            this.isReady = true;
            return this;
        }
    };
    return workflow;
}
function toRivrPlugin(plugin, getRandomName) {
    Object.defineProperty(plugin, "opts", {
        value: {
            name: getRandomName()
        }
    });
    return plugin;
}
function isRivrPlugin(plugin) {
    return "opts" in plugin;
}
function decorate(key, value) {
    if (this.registeredDecorators.includes(key)) {
        throw new Error(`Cannot decorate the same property '${key}' twice`);
    }
    Object.defineProperty(this, key, { value });
    this.registeredDecorators.push(key);
    return this;
}
exports.rivr = {
    workflow(name) {
        return createRootWorkflow(name);
    }
};
