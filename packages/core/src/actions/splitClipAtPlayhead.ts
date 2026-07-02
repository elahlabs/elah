import type { TimelineEngine } from '../editor/TimelineEngine'
import { useSelectionStore } from '../stores/selection.store'
import { usePlaybackStore } from '../stores/playback.store'
import type { ActionResult } from './types'

export interface SplitAtPlayheadData {
  leftId: string
  rightId: string
  trackId: string
}

/**
 * Split the currently-selected clip at the current playhead frame.
 *
 * Validates that a single clip is selected and the playhead is strictly
 * inside that clip's bounds before mutating. The split runs inside
 * engine.batch() so future additions to this action (e.g. selecting the
 * new right-half, fixing up linked clips) collapse into one undo entry.
 *
 * Actions live outside the engine so the engine stays UI-agnostic — only
 * actions are allowed to read selection/playback stores.
 */
export function splitClipAtPlayhead(engine: TimelineEngine): ActionResult<SplitAtPlayheadData> {
  const selectedIds = useSelectionStore.getState().selectedClipIds
  const isPlaying = usePlaybackStore.getState().isPlaying
  if (isPlaying) return { ok: false, reason: 'cannot-split-while-playing' }

  if (selectedIds.size === 0) return { ok: false, reason: 'no-selection' }
  if (selectedIds.size > 1) return { ok: false, reason: 'multi-selection' }

  const [clipId] = selectedIds
  if (!clipId) return { ok: false, reason: 'no-selection' }

  const found = engine.findClip(clipId)
  if (!found) return { ok: false, reason: 'clip-not-found' }

  const { clip, trackId } = found
  const frame = usePlaybackStore.getState().currentFrame

  if (frame <= clip.startFrame || frame >= clip.startFrame + clip.durationFrames) {
    return { ok: false, reason: 'playhead-outside-clip' }
  }

  let result: [string, string] | null = null
  engine.batch(() => {
    result = engine.splitClip(clip.id, trackId, frame)
  }, 'Split at playhead')

  if (!result) return { ok: false, reason: 'engine-rejected' }

  return {
    ok: true,
    data: { leftId: result[0], rightId: result[1], trackId },
  }
}
