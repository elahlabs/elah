import { usageError } from './errors'

export function parsePositiveInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw usageError(`${flag} expects a positive integer`)
  }
  return Number(value)
}
