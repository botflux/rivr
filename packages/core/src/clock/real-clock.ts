import {Clock} from "./interface";

export class RealClock implements Clock {
    now(): Date {
      return new Date()
    }
}