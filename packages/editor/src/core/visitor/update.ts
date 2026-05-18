import type { Draft } from 'immer'
import type { Clip, Project, Track } from '../types'
import { toFrame } from '../utils/frames'
import { findOverlaps } from '../utils/frames'

/**
 * Update clip properties in place.
 * If startFrame or durationFrames are updated, validates against overlaps.
 * Keeps clips sorted by startFrame after any positional update.
 */
export function updateClip(
  draft: Draft<Project>,
  clipId: string,
  trackId: string,
  updates: Partial<Clip>,
): void {
  const trackClips = draft.clips[trackId]
  if (!trackClips) return

  const clip = trackClips.find((c) => c.id === clipId)
  if (!clip) return

  // Normalize frame values if provided
  if (updates.startFrame !== undefined) {
    updates.startFrame = toFrame(updates.startFrame)
  }
  if (updates.durationFrames !== undefined) {
    updates.durationFrames = Math.max(1, toFrame(updates.durationFrames))
  }

  const merged = { ...clip, ...updates } as Clip

  const overlaps = findOverlaps(trackClips as Clip[], merged, clipId)
  if (overlaps.length > 0) {
    throw new Error(
      `Update would cause clip "${clipId}" to overlap with "${overlaps[0].id}"`,
    )
  }

  Object.assign(clip, updates)

  if (updates.startFrame !== undefined) {
    trackClips.sort((a, b) => a.startFrame - b.startFrame)
  }
}

/** Update track properties in place */
export function updateTrack(
  draft: Draft<Project>,
  trackId: string,
  updates: Partial<Track>,
): void {
  const track = draft.tracks.find((t) => t.id === trackId)
  if (!track) return
  Object.assign(track, updates)
}
