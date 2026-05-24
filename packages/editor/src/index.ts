/**
 * @elah/editor
 *
 * Engine-first video editor SDK.
 *
 * @example Minimal usage
 * ```tsx
 * import { Timeline } from '@elah/editor'
 *
 * function App() {
 *   return <Timeline fps={30} style={{ height: 300 }} />
 * }
 * ```
 *
 * @example With engine access
 * ```tsx
 * import { Timeline, useTimeline, type TimelineRef } from '@elah/editor'
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

// --- Core: types ---
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
} from './core/types'

// --- Core: engine ---
export { TimelineEngine } from './core/editor/TimelineEngine'

// --- Core: playback ---
export { PlaybackEngine } from './core/playback/PlaybackEngine'
export type { PlaybackSnapshot, PlaybackEngineConfig } from './core/playback/PlaybackEngine'

// --- Core: resolver ---
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

// --- Core: renderer ---
export type { Renderer } from './core/renderer/types'
export { GpuRenderer } from './core/renderer/gpu/GpuRenderer'
export type { RendererOptions } from './core/renderer/gpu/types'

// --- Core: renderer / debug counters (read-only metrics for tests + diagnostics) ---
export { GpuDebugCounters } from './core/renderer/gpu/debug/GpuDebugCounters'
export type { CounterSnapshot } from './core/renderer/gpu/debug/GpuDebugCounters'

// --- Core: renderer / demuxer (optional integration surface) ---
// Import mediabunny separately in your app; this file never depends on it.
export { createMediabunnyBackend, isMediabunnyCompatible } from './core/renderer/gpu/demuxer/createMediabunnyBackend'
export type { MediabunnyModule, CreateMediabunnyBackendOpts } from './core/renderer/gpu/demuxer/createMediabunnyBackend'
export type { DemuxerBackend, DemuxerFactory } from './core/renderer/gpu/demuxer/MediabunnyDemuxer'

// --- Core: media ---
export { useMediaLibrary, useMediaLibraryStore, MEDIA_DRAG_MIME, importFiles } from './core/media'
export type { MediaAsset, MediaKind, DragMediaPayload, ImportFilesOptions, ImportFilesResult, SkippedImport } from './core/media'

// --- Core: stores (low-level; prefer the hooks below) ---
export { useTracksStore } from './core/stores/tracks.store'
export { usePlaybackStore } from './core/stores/playback.store'
export { useSelectionStore } from './core/stores/selection.store'

// --- Core: clip factories ---
export { createVideoClip } from './core/elements/video'
export { createAudioClip } from './core/elements/audio'
export { createTextClip } from './core/elements/text'
export { createImageClip } from './core/elements/image'

// --- Core: actions ---
export { splitClipAtPlayhead } from './core/actions/splitClipAtPlayhead'
export type { SplitAtPlayheadData } from './core/actions/splitClipAtPlayhead'
export type { ActionResult, ActionFailureReason } from './core/actions/types'

// --- Core: utilities ---
export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames } from './core/utils/frames'
export { generateId } from './core/utils/id'

// --- Timeline: UI ---
export { Timeline } from './timeline/Timeline'
export type { TimelineProps, TimelineRef } from './timeline/Timeline'

// --- Timeline: hooks ---
export { useTimeline } from './timeline/engine-context'
export { useTracks } from './timeline/hooks/useTracks'
export { usePlayback } from './timeline/hooks/usePlayback'
export { useSelection } from './timeline/hooks/useSelection'
export { useTimelineDrop } from './timeline/useTimelineDrop'

// --- Editor: composition ---
export { EditorProvider } from './editor/EditorProvider'
export type { EditorProviderProps } from './editor/EditorProvider'
export {
  useEditor,
  useTimelineEngine,
  usePlaybackEngine,
} from './core/editor-context'
export { useResolvedScene } from './editor/useResolvedScene'
export { AssetPanel } from './editor/AssetPanel'
export type { AssetPanelProps } from './editor/AssetPanel'
