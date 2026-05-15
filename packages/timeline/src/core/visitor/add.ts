import type { Draft } from 'immer'
import type { Clip, Project } from '../../types'
import { findOverlaps } from '../../utils/frames'

/**
 * Add a clip to a track.
 * Throws if the track does not exist or if the clip overlaps an existing one.
 * Keeps clips sorted by startFrame after insertion.
 */
export function addClip(draft: Draft<Project>, clip: Clip): void {
  const track = draft.tracks.find((t) => t.id === clip.trackId)
  if (!track) {
    throw new Error(`Track "${clip.trackId}" not found`)
  }

  if (!draft.clips[clip.trackId]) {
    draft.clips[clip.trackId] = []
  }

  const overlaps = findOverlaps(
    draft.clips[clip.trackId] as Clip[],
    clip,
  )
  if (overlaps.length > 0) {
    throw new Error(
      `Clip overlaps with existing clip "${overlaps[0].id}" on track "${clip.trackId}"`,
    )
  }

  draft.clips[clip.trackId].push(clip as Draft<Clip>)
  draft.clips[clip.trackId].sort((a, b) => a.startFrame - b.startFrame)
}
