export type Result<T, E = Error> = [T, undefined] | [undefined, E];
export declare function tryCatch<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>>;
export declare function tryCatchSync<T, E = Error>(fn: () => T): Result<T, E>;
