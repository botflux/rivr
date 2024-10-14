export type GetTimeToWait = (attempt: number) => number

export function linear (factor: number): GetTimeToWait {
    return attempt => attempt * factor
}