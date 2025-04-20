"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rivrPlugin = rivrPlugin;
function rivrPlugin(plugin, opts) {
    Object.assign(plugin, {
        opts,
    });
    return plugin;
}
