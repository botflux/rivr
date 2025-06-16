export function omit<T extends Record<never, never>>(obj: T, keys: (keyof T)[]) {
  const copy = {...obj}

  for (const key of keys) {
    delete copy[key]
  }
  return copy
}