/**
 * @myeditor/timeline
 *
 * Engine-first video timeline SDK.
 *
 * @example Minimal usage
 * ```tsx
 * import { Timeline } from '@myeditor/timeline'
 *
 * function App() {
 *   return <Timeline fps={30} style={{ height: 300 }} />
 * }
 * ```
 *
 * @example With engine access
 * ```tsx
 * import { Timeline, useTimeline, type TimelineRef } from '@myeditor/timeline'
 *
 * function App() {
 *   const ref = useRef<TimelineRef>(null)
 *
 *   const handleAdd = () => {
 *     const engine = ref.current?.engine
 *     const track = engine?.addTrack('video')
 *     if (track) {
 *       engine?.addClip({ trackId: track.id, type: 'video', startFrame: 0, durationFrames: 90 })
 *     }
 *   }
 *
 *   return (
 *     <>
 *       <button onClick={handleAdd}>Add clip</button>
 *       <Timeline ref={ref} fps={30} style={{ height: 300 }} />
 *     </>
 *   )
 * }
 * ```
 */

// --- UI ---
export { Timeline } from './ui/Timeline'
export type { TimelineProps, TimelineRef } from './ui/Timeline'

// --- Hook (access engine from inside the tree) ---
export { useTimeline } from './ui/engine-context'

// --- Engine (direct access, framework-agnostic) ---
export { TimelineEngine } from './core/editor/TimelineEngine'

// --- Playback engine ---
export { PlaybackEngine } from './core/playback/PlaybackEngine'
export type { PlaybackSnapshot, PlaybackEngineConfig } from './core/playback/PlaybackEngine'

// --- Resolver ---
export { resolveTimeline } from './core/resolver/resolveTimeline'
export type {
  Scene,
  SceneTransition,
  ActiveVideoClip,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
  ActiveClipBase,
} from './core/resolver/scene'

// --- Stores (granular React subscriptions) ---
export { useTracksStore } from './stores/tracks.store'
export { usePlaybackStore } from './stores/playback.store'
export { useSelectionStore } from './stores/selection.store'

// --- Types ---
export type {
  Clip,
  Track,
  Project,
  Transform,
  ClipType,
  TrackKind,
  FrameCount,
  TimelineConfig,
  EngineEvent,
} from './types'

// --- Clip factories (for building clips before passing to engine) ---
export { createVideoClip } from './core/elements/video'
export { createAudioClip } from './core/elements/audio'
export { createTextClip } from './core/elements/text'
export { createImageClip } from './core/elements/image'

// --- Actions (composed editor operations — engine + stores) ---
export { splitClipAtPlayhead } from './actions/splitClipAtPlayhead'
export type { SplitAtPlayheadData } from './actions/splitClipAtPlayhead'
export type { ActionResult, ActionFailureReason } from './actions/types'

// --- Utilities ---
export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames } from './utils/frames'
export { generateId } from './utils/id'
