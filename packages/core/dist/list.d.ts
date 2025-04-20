export interface List<T> {
    append(value: T): T;
    insertAfter(value: T, index: number): T;
    [Symbol.iterator](): Generator<T>;
    reverseIteratorFromIndex(index: number): Generator<T>;
    at(index: number): T | undefined;
    length: number;
}
export declare class ArrayAdapter<T> implements List<T> {
    array: T[];
    append(value: T): T;
    insertAfter(value: T, index: number): T;
    at(index: number): T | undefined;
    [Symbol.iterator](): Generator<T>;
    reverseIteratorFromIndex(index: number): Generator<T, void, unknown>;
    get length(): number;
}
export declare class Slice<T> implements List<T> {
    innerSlice: List<T>;
    startIndex: number;
    appendIndex: number;
    constructor(innerSlice: List<T>, startIndex: number);
    insertAfter(value: T, index: number): T;
    append(value: T): T;
    at(index: number): T | undefined;
    [Symbol.iterator](): Generator<T>;
    reverseIteratorFromIndex(index: number): Generator<T>;
    get length(): number;
}
