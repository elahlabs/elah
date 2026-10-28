import type { Clip } from '@elah/core'
import { playbackStore, tracksStore } from '@elah/core/engine'
import type { GestureSnapshot } from './types'

/**
 * Freeze the store state a gesture needs. Call it once, when the gesture
 * begins (gesture-handler's `onStart` / `onBegin`), never per move: the
 * composition is frozen while a drag is in flight, and so is the lane layout.
 */
export function snapshotFromStores(): GestureSnapshot {
  const { tracks, clips } = tracksStore.getState()
  const { zoom, snapEnabled } = playbackStore.getState()
  return { tracks, clips, zoom, snapEnabled }
}

/** Locate a clip in a snapshot. `null` when it has been removed since the snapshot was taken. */
export function findClipInSnapshot(
  snapshot: Pick<GestureSnapshot, 'clips'>,
  clipId: string,
): { clip: Clip; trackId: string } | null {
  for (const [trackId, trackClips] of Object.entries(snapshot.clips)) {
    const clip = trackClips.find((c) => c.id === clipId)
    if (clip) return { clip, trackId }
  }
  return null
}

/** Whether the lane holding `trackId` is locked. A missing track counts as locked: nothing may move onto it. */
export function isTrackLockedInSnapshot(
  snapshot: Pick<GestureSnapshot, 'tracks'>,
  trackId: string,
): boolean {
  return snapshot.tracks.find((t) => t.id === trackId)?.locked ?? true
}
