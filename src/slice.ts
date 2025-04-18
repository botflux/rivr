export interface List<T> {
  append(value: T): T
  insertAfter(value: T, index: number): T
  [Symbol.iterator](): Generator<T>
  reverseIteratorFromIndex(index: number): Generator<T>
  at(index: number): T | undefined
  length: number
}

export class ArrayAdapter<T> implements List<T> {
  array: T[] = []

  append(value: T): T {
    this.array.push(value)
    return value
  }

  insertAfter(value: T, index: number): T {
    this.array.splice(index, 0, value)
    return value
  }

  at(index: number): T | undefined {
    return this.array[index]
  }

  *[Symbol.iterator](): Generator<T> {
    for (const value of this.array) {
      yield value
    }
  }

  * reverseIteratorFromIndex(index: number) {
    for (let i = index; i >= 0; i--) {
      yield this.array[i]
    }
  }

  get length (): number {
    return this.array.length
  }
}

export class Slice<T> implements List<T> {
  innerSlice: List<T>
  startIndex: number
  appendIndex: number = 0

  constructor(innerSlice: List<T>, startIndex: number) {
    this.innerSlice = innerSlice;
    this.startIndex = startIndex;
  }

  insertAfter(value: T, index: number): T {
    this.innerSlice.insertAfter(value, index + this.startIndex)
    return value
  }

  append(value: T): T {
    this.innerSlice.insertAfter(value, this.startIndex + this.appendIndex++)
    return value
  }

  at(index: number): T | undefined {
    return this.innerSlice.at(index + this.startIndex)
  }

  *[Symbol.iterator](): Generator<T> {
    for (let i = 0; i < this.appendIndex; i++) {
      yield this.innerSlice.at(this.startIndex + i)!
    }
  }

  *reverseIteratorFromIndex(index: number): Generator<T> {
    for (let i = index; i >= 0; i--) {
      yield this.at(index)!
    }
  }

  get length(): number {
    return this.appendIndex
  }
}

