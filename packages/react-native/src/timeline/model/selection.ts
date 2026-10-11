import type { EngineCommand } from './commands'
import { findClipInSnapshot, isTrackLockedInSnapshot } from './snapshot'
import type { GestureSnapshot } from './types'

/**
 * The command that deletes the selected clips, or null when none of them can be deleted.
 * Ids that no longer exist (selection may outlive a clip) and clips on locked lanes are skipped,
 * so the result is exactly what the engine will remove, in one undo entry.
 */
export function deleteSelectionCommand(
  snapshot: Pick<GestureSnapshot, 'tracks' | 'clips'>,
  selectedClipIds: ReadonlySet<string>,
): EngineCommand | null {
  const clips: { clipId: string; trackId: string }[] = []
  for (const clipId of selectedClipIds) {
    const found = findClipInSnapshot(snapshot, clipId)
    if (!found || isTrackLockedInSnapshot(snapshot, found.trackId)) continue
    clips.push({ clipId, trackId: found.trackId })
  }
  return clips.length === 0 ? null : { type: 'removeClips', clips }
}
