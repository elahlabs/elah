'use client'

import { useSelectionStore, useTimelineEngine, useTracksStore, type Clip } from '@elah/editor'

/**
 * The selected clips (first one wins in the curve drawer), current from the
 * tracks store so they refresh after every edit, plus the engine.
 */
export function useSelectedClips() {
  const engine = useTimelineEngine()
  const selectedIds = useSelectionStore((s) => s.selectedClipIds)
  const clipsByTrack = useTracksStore((s) => s.clips)
  const clips: Clip[] = []
  for (const id of selectedIds) {
    for (const list of Object.values(clipsByTrack)) {
      const hit = list.find((c) => c.id === id)
      if (hit) {
        clips.push(hit)
        break
      }
    }
  }
  return { engine, clips }
}
