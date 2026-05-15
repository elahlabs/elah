import type { Draft } from 'immer'
import type { Clip, Project } from '../../types'
import { generateId } from '../../utils/id'
import { toFrame } from '../../utils/frames'

/**
 * Split a clip at a given frame into two adjacent clips.
 *
 * The left clip keeps the original id and shrinks to end at splitFrame.
 * The right clip gets a new id and starts at splitFrame.
 * Source trim boundaries are recalculated so playback remains correct.
 *
 * Returns [leftId, rightId] on success, or null if splitFrame is not inside the clip.
 */
export function splitClip(
  draft: Draft<Project>,
  clipId: string,
  trackId: string,
  atFrame: number,
): [string, string] | null {
  const trackClips = draft.clips[trackId]
  if (!trackClips) return null

  const idx = trackClips.findIndex((c) => c.id === clipId)
  if (idx === -1) return null

  const clip = trackClips[idx]
  const splitFrame = toFrame(atFrame)

  // Split point must be strictly inside the clip
  if (
    splitFrame <= clip.startFrame ||
    splitFrame >= clip.startFrame + clip.durationFrames
  ) {
    return null
  }

  const leftDuration = splitFrame - clip.startFrame
  const rightDuration = clip.durationFrames - leftDuration
  const rightId = generateId()

  // Right clip: new object inserted after left
  const rightClip: Clip = {
    ...(clip as unknown as Clip),
    id: rightId,
    startFrame: splitFrame,
    durationFrames: rightDuration,
    sourceStartFrame: clip.sourceStartFrame + leftDuration,
    sourceDurationFrames: rightDuration,
  }

  // Mutate left clip in place (keeps its id)
  clip.durationFrames = leftDuration
  clip.sourceDurationFrames = leftDuration

  trackClips.splice(idx + 1, 0, rightClip as Draft<Clip>)

  return [clip.id, rightId]
}
