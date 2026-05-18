import type { Draft } from 'immer'
import type { Clip, Project } from '../types'
import { generateId } from '../utils/id'
import { toFrame } from '../utils/frames'
import { findOverlaps } from '../utils/frames'

/**
 * Clone a clip and place it at a new startFrame on the same track.
 * Returns the new clip's id on success, or null if the position is occupied.
 */
export function cloneClip(
  draft: Draft<Project>,
  clipId: string,
  trackId: string,
  startFrame: number,
): string | null {
  const trackClips = draft.clips[trackId]
  if (!trackClips) return null

  const original = trackClips.find((c) => c.id === clipId)
  if (!original) return null

  const newStartFrame = toFrame(startFrame)
  const candidate = { startFrame: newStartFrame, durationFrames: original.durationFrames }

  const overlaps = findOverlaps(trackClips as Clip[], candidate)
  if (overlaps.length > 0) return null

  const clone: Clip = {
    ...(original as unknown as Clip),
    id: generateId(),
    startFrame: newStartFrame,
    sourceStartFrame: original.sourceStartFrame,
  }

  trackClips.push(clone as Draft<Clip>)
  trackClips.sort((a, b) => a.startFrame - b.startFrame)

  return clone.id
}
