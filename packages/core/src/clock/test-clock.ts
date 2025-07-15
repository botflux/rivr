import {Clock} from "./interface";

export class TestClock implements Clock {
  date: Date = new Date()

  now(): Date {
    return this.date
  }

  setNow(now: Date): this {
    this.date = now
    return this
  }

  addMs(ms: number): this {
    this.date = new Date(this.date.getTime() + ms)
    return this
  }
}