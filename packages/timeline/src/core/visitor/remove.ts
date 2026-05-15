import type { Draft } from 'immer'
import type { Project } from '../../types'

/** Remove a clip by id from a specific track */
export function removeClip(
  draft: Draft<Project>,
  clipId: string,
  trackId: string,
): void {
  const trackClips = draft.clips[trackId]
  if (!trackClips) return

  const idx = trackClips.findIndex((c) => c.id === clipId)
  if (idx !== -1) {
    trackClips.splice(idx, 1)
  }
}

/** Remove a track and all its clips */
export function removeTrack(draft: Draft<Project>, trackId: string): void {
  const idx = draft.tracks.findIndex((t) => t.id === trackId)
  if (idx !== -1) {
    draft.tracks.splice(idx, 1)
  }
  delete draft.clips[trackId]
}
