import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class strings so a later (caller-supplied) class reliably WINS over an
 * earlier (built-in) one targeting the same CSS property.
 *
 * Plain concatenation would leave both classes in the list and let CSS source
 * order decide — so an override like `bg-zinc-900` could silently lose to the
 * component's default `bg-ed-panel`. `twMerge` resolves the conflict by keeping
 * only the last class per property, which is what makes the `classNames` slot
 * API actually override.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
