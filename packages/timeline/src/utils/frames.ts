import type { Clip } from '../types'

/**
 * Clamp and round any value to a valid frame number.
 * This is the single entry point for all frame normalization —
 * call it on every external input before it enters the engine.
 */
export function toFrame(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

/** Convert seconds to frames, rounding to nearest integer frame */
export function secondsToFrames(seconds: number, fps: number): number {
  return toFrame(seconds * fps)
}

/** Convert frames to seconds */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps
}

/**
 * Format a frame count as a human-readable timecode: HH:MM:SS:FF
 * Used in the ruler and clip labels.
 */
export function framesToTimecode(frames: number, fps: number): string {
  const f = frames % fps
  const totalSeconds = Math.floor(frames / fps)
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}

function pad(n: number): string {
  return String(Math.floor(n)).padStart(2, '0')
}

/**
 * Get the total duration of the timeline in frames.
 * Scans all clips and returns the frame at which the last clip ends.
 */
export function getTotalFrames(
  clips: Record<string, Array<{ startFrame: number; durationFrames: number }>>,
): number {
  let max = 0
  for (const trackClips of Object.values(clips)) {
    for (const clip of trackClips) {
      const end = clip.startFrame + clip.durationFrames
      if (end > max) max = end
    }
  }
  return max
}

/** True if two clips overlap on the same track (touching edges do not count as overlap) */
export function clipsOverlap(
  a: { startFrame: number; durationFrames: number },
  b: { startFrame: number; durationFrames: number },
): boolean {
  return (
    a.startFrame < b.startFrame + b.durationFrames &&
    a.startFrame + a.durationFrames > b.startFrame
  )
}

/**
 * Find all clips that would overlap with the candidate clip,
 * optionally excluding one clip by id (useful when moving a clip).
 */
export function findOverlaps(
  trackClips: Clip[],
  candidate: { startFrame: number; durationFrames: number },
  excludeId?: string,
): Clip[] {
  return trackClips.filter(
    (c) => c.id !== excludeId && clipsOverlap(c, candidate),
  )
}
