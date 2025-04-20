"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryCatch = tryCatch;
exports.tryCatchSync = tryCatchSync;
async function tryCatch(promise) {
    try {
        return [await promise, undefined];
    }
    catch (e) {
        return [undefined, e];
    }
}
function tryCatchSync(fn) {
    try {
        return [fn(), undefined];
    }
    catch (error) {
        return [undefined, error];
    }
}
