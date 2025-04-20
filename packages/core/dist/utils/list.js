"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Slice = exports.ArrayAdapter = void 0;
class ArrayAdapter {
    array = [];
    append(value) {
        this.array.push(value);
        return value;
    }
    insertAfter(value, index) {
        this.array.splice(index, 0, value);
        return value;
    }
    at(index) {
        return this.array[index];
    }
    *[Symbol.iterator]() {
        for (const value of this.array) {
            yield value;
        }
    }
    *reverseIteratorFromIndex(index) {
        for (let i = index; i >= 0; i--) {
            yield this.array[i];
        }
    }
    get length() {
        return this.array.length;
    }
}
exports.ArrayAdapter = ArrayAdapter;
class Slice {
    innerSlice;
    startIndex;
    appendIndex = 0;
    constructor(innerSlice, startIndex) {
        this.innerSlice = innerSlice;
        this.startIndex = startIndex;
    }
    insertAfter(value, index) {
        this.innerSlice.insertAfter(value, index + this.startIndex);
        return value;
    }
    append(value) {
        this.innerSlice.insertAfter(value, this.startIndex + this.appendIndex++);
        return value;
    }
    at(index) {
        return this.innerSlice.at(index + this.startIndex);
    }
    *[Symbol.iterator]() {
        for (let i = 0; i < this.appendIndex; i++) {
            yield this.innerSlice.at(this.startIndex + i);
        }
    }
    *reverseIteratorFromIndex(index) {
        for (let i = index; i >= 0; i--) {
            yield this.at(index);
        }
    }
    get length() {
        return this.appendIndex;
    }
}
exports.Slice = Slice;
