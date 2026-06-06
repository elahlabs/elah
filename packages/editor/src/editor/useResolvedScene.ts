import { useMemo, useRef } from 'react'
import { useTimelineEngine } from '../core/editor-context'
import { useTracksStore } from '../core/stores/tracks.store'
import { usePlaybackStore } from '../core/stores/playback.store'
import { resolveTimeline } from '../core/resolver/resolveTimeline'
import type { Scene } from '../core/resolver/scene'

/**
 * Returns a memoized Scene for the current playhead frame (or `frameOverride` if given).
 *
 * Re-resolves only when the frame or the underlying project changes. When both
 * inputs are reference-equal to the previous call, returns the previous Scene
 * by reference so downstream `useEffect` deps skip naturally.
 *
 * Must be used inside an `<EditorProvider>` — throws otherwise (via useTimelineEngine).
 *
 * @param frameOverride  Optional frame number. When omitted the store's currentFrame is used.
 */
export function useResolvedScene(frameOverride?: number): Scene {
  const engine = useTimelineEngine()
  const storeFrame = usePlaybackStore((s) => s.currentFrame)
  // Subscribe to tracks so the hook re-runs whenever the project shape changes.
  // The tracks reference is replaced on every engine 'change' event, making it
  // the cheapest "project mutated" signal available from React.
  useTracksStore((s) => s.tracks)
  // Also subscribe to stage: an aspect-ratio change mutates only project.stage,
  // leaving the tracks array reference untouched (Immer structural sharing), so
  // the tracks subscription alone would miss it.
  useTracksStore((s) => s.stage)
  // Also subscribe to clips: previewClip({ content }) only mutates the clips
  // slice (Immer structural sharing leaves the tracks array reference unchanged),
  // so without this subscription the TextOverlay layout would stay stale while
  // the user types — caret and resize handles would drift from the GPU glyphs.
  useTracksStore((s) => s.clips)

  const frame = frameOverride ?? storeFrame
  const project = engine.getProject()

  const last = useRef<{ frame: number; project: typeof project; scene: Scene } | null>(null)

  return useMemo(() => {
    if (
      last.current !== null &&
      last.current.frame === frame &&
      last.current.project === project
    ) {
      return last.current.scene
    }
    const scene = resolveTimeline(frame, project)
    last.current = { frame, project, scene }
    return scene
  }, [frame, project])
}
