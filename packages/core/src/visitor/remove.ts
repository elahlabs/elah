import type { Draft } from 'immer'
import type { Project } from '../types'

/**
 * Drop any transition whose clip pair is no longer adjacent (gap > 2 frames)
 * or whose clips no longer exist. Call after any mutation that changes clip
 * positions or removes clips.
 */
export function pruneOrphanedTransitions(draft: Draft<Project>): void {
  const allClips = Object.values(draft.clips).flat()
  draft.transitions = draft.transitions.filter((t) => {
    const from = allClips.find((c) => c.id === t.fromClipId)
    const to = allClips.find((c) => c.id === t.toClipId)
    if (!from || !to) return false
    const gap = to.startFrame - (from.startFrame + from.durationFrames)
    return gap >= 0 && gap <= 2
  })
}

/** Remove a clip by id from a specific track */
export function removeClip(draft: Draft<Project>, clipId: string, trackId: string): void {
  const trackClips = draft.clips[trackId]
  if (!trackClips) return

  const idx = trackClips.findIndex((c) => c.id === clipId)
  if (idx !== -1) {
    trackClips.splice(idx, 1)
  }

  pruneOrphanedTransitions(draft)
}

/** Remove a track and all its clips */
export function removeTrack(draft: Draft<Project>, trackId: string): void {
  const idx = draft.tracks.findIndex((t) => t.id === trackId)
  if (idx !== -1) {
    draft.tracks.splice(idx, 1)
  }
  delete draft.clips[trackId]

  pruneOrphanedTransitions(draft)
}
