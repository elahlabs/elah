/**
 * Ensure a clip-body background class renders: gradient stops (`from-`/`via-`/
 * `to-`) need a gradient direction, so prepend `bg-gradient-to-b` when there's
 * no explicit `bg-`. A solid `bg-*` (or undefined) passes through unchanged.
 *
 * Lets callers write `from-teal-400 to-teal-600` (gradient) or `bg-teal-500`
 * (solid) for the per-type body slots without remembering the direction class.
 */
export function normBg(bg: string | undefined): string | undefined {
  if (!bg) return undefined
  if (/(^|\s)(from-|via-|to-)/.test(bg) && !/(^|\s)bg-/.test(bg)) {
    return `bg-gradient-to-b ${bg}`
  }
  return bg
}
