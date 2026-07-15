import { useMemo, useRef } from 'react'
import { resolveTimeline, type Scene } from '@elah/core'
import {
  useTimelineEngine,
  useTracksStore,
  usePlaybackStore,
} from '@elah/react'

/**
 * Returns a memoized Scene for the current playhead frame (or `frameOverride` if given).
 *
 * Re-resolves only when the frame or the underlying project changes. When both
 * inputs are reference-equal to the previous call, returns the previous Scene
 * by reference so downstream `useEffect` deps skip naturally.
 *
 * During playback the frame is frozen at its last paused value. This prevents
 * TextOverlay and MediaTransformOverlay from re-rendering 30×/sec — they only
 * care about the scene when handles are visible (i.e. not playing).
 *
 * Must be used inside an `<EditorProvider>` — throws otherwise (via useTimelineEngine).
 *
 * @param frameOverride  Optional frame number. When omitted the store's currentFrame is used.
 */
export function useResolvedScene(frameOverride?: number): Scene {
  const engine = useTimelineEngine()
  // Combine isPlaying + currentFrame into one selector: returns null while
  // playing so this hook never re-renders from frame ticks during playback.
  const playbackFrame = usePlaybackStore((s) => (s.isPlaying ? null : s.currentFrame))
  // Track the last paused frame so we hold a valid scene when playing.
  const frozenFrameRef = useRef(playbackFrame ?? 0)
  if (playbackFrame !== null) frozenFrameRef.current = playbackFrame

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

  const frame = frameOverride ?? frozenFrameRef.current
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


