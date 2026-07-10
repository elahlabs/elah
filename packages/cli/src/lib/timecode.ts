import { usageError } from './errors'

/**
 * Parse a frame position: either a plain integer frame count or a timecode.
 * Accepted timecode forms (matching core's HH:MM:SS:FF formatter):
 *   SS:FF · MM:SS:FF · HH:MM:SS:FF
 */
export function parseFramePosition(value: string, fps: number): number {
  if (/^\d+$/.test(value)) return Number(value)

  const parts = value.split(':')
  if (
    parts.length < 2 ||
    parts.length > 4 ||
    parts.some((p) => !/^\d+$/.test(p))
  ) {
    throw usageError(
      `Invalid frame position '${value}'. Use an integer frame count or a timecode (SS:FF, MM:SS:FF, HH:MM:SS:FF).`
    )
  }

  const nums = parts.map(Number)
  const ff = nums[nums.length - 1]
  const ss = nums[nums.length - 2]
  const mm = nums.length >= 3 ? nums[nums.length - 3] : 0
  const hh = nums.length === 4 ? nums[0] : 0

  if (ff >= fps) {
    throw usageError(
      `Invalid timecode '${value}': frame part ${ff} must be below the project fps (${fps}).`
    )
  }
  if (ss >= 60 || (nums.length === 4 && mm >= 60)) {
    throw usageError(`Invalid timecode '${value}': seconds/minutes must be below 60.`)
  }

  return ((hh * 60 + mm) * 60 + ss) * fps + ff
}
