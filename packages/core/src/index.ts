/**
 * @elah/core
 *
 * Framework-agnostic video timeline engine.
 * Zero React imports. Worker-safe. Node-safe. Deterministic.
 */

// --- Types ---
export type {
  Clip,
  Track,
  Project,
  Transform,
  TextAnimation,
  TextAnimationKind,
  ClipType,
  ShapeVariant,
  TrackKind,
  FrameCount,
  TimelineConfig,
  InitialTrackConfig,
  EngineEvent,
  Transition,
  TransitionKind,
  TransitionEasing,
  TransitionDirection,
} from './types'

// --- Engine ---
export { TimelineEngine } from './editor/TimelineEngine'

// --- Playback ---
export { PlaybackEngine } from './playback/PlaybackEngine'
export type { PlaybackSnapshot, PlaybackEngineConfig } from './playback/PlaybackEngine'

// --- Resolver (pure, deterministic, React-free) ---
export { resolveTimeline } from './resolver/resolveTimeline'
export type {
  Scene,
  ActiveTransition,
  ActiveVideoClip,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
  ActiveShapeClip,
  ActiveFreehandClip,
  ActiveClipBase,
} from './resolver/scene'

// --- Renderer interface ---
export type { Renderer } from './renderer/types'
export { GpuRenderer } from './renderer/gpu/GpuRenderer'
export type { RendererOptions } from './renderer/gpu/types'

// --- Renderer internals (used by overlays + placement helpers) ---
export { resolveDrawRect, transformFromContainRect, transformFromCoverRect } from './renderer/gpu/layers/drawRect'
export { computeContainViewport } from './renderer/gpu/viewport'
export { computeTextLayout, SIDE_MARGIN } from './renderer/gpu/layers/textLayout'
export type { TextLayout } from './renderer/gpu/layers/textLayout'

// --- Media backends ---
export type { DemuxerBackend as MediabunnyDemuxer } from './media/video/demuxer/MediabunnyDemuxer'

// --- Renderer debug ---
export { GpuDebugCounters } from './renderer/gpu/debug/GpuDebugCounters'
export type { CounterSnapshot } from './renderer/gpu/debug/GpuDebugCounters'

// --- Demuxer integration ---
export { createDefaultDemuxerFactory } from './media/video/demuxer/createDefaultDemuxerFactory'
export { createMediabunnyBackend, isMediabunnyCompatible } from './media/video/demuxer/createMediabunnyBackend'
export type { MediabunnyModule, CreateMediabunnyBackendOpts } from './media/video/demuxer/createMediabunnyBackend'
export type { DemuxerBackend, DemuxerFactory } from './media/video/demuxer/MediabunnyDemuxer'

// --- Media: video frame producers ---
export type { VideoFrameProvider, VideoFrameProviderDeps } from './media/video'
export { createVideoFrameProvider, MockVideoFrameProvider, SyntheticVideoFrameProvider } from './media/video'

// --- Media: audio playback ---
export { AudioPlaybackController } from './media/audio/AudioPlaybackController'
export type { AudioPlaybackControllerOptions } from './media/audio/AudioPlaybackController'
export { defaultAudioResolver } from './media/audio/audioResolver'
export type { AudioResolver } from './media/audio/audioResolver'

// --- Image decode cache (warming) ---
export { warmImageSrc, preloadProjectImages } from './renderer/gpu/layers/imageCache'
export type { ImageLoader, LoadedImage } from './renderer/gpu/layers/imageCache'

// --- Assets / Media Library ---
export {
  mediaLibraryStore,
  MEDIA_DRAG_MIME,
  mediaDragKindMime,
  importFiles,
  importUrl,
  importBlob,
} from './assets'
export type {
  MediaAsset,
  MediaKind,
  DragMediaPayload,
  MediaLibraryState,
  MediaLibraryActions,
  ImportFilesOptions,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
  SkippedImport,
} from './assets'

// --- Stores (Ring 1: vanilla Zustand mirrors; React hooks live in @elah/react) ---
export { tracksStore } from './stores/tracks.store'
export type { TracksState, TracksActions } from './stores/tracks.store'
export { playbackStore } from './stores/playback.store'
export type { PlaybackState, PlaybackActions } from './stores/playback.store'
export { selectionStore } from './stores/selection.store'
export type { SelectionState, SelectionActions } from './stores/selection.store'
export { transitionsStore } from './stores/transitions.store'
export type { TransitionsState, TransitionsActions } from './stores/transitions.store'

// --- Clip factories ---
export type { CreateClipOptions, ShapeClipMetadata, FreehandClipMetadata } from './elements/base'
export { createVideoClip } from './elements/video'
export { createAudioClip } from './elements/audio'
export { createTextClip } from './elements/text'
export { createImageClip } from './elements/image'
export { createShapeClip } from './elements/shape'
export type { CreateShapeClipOptions } from './elements/shape'
export { createFreehandClip } from './elements/freehand'
export type { CreateFreehandClipOptions } from './elements/freehand'

// --- Actions ---
export { splitClipAtPlayhead } from './actions/splitClipAtPlayhead'
export type { SplitAtPlayheadData } from './actions/splitClipAtPlayhead'
export type { ActionResult, ActionFailureReason } from './actions/types'

// --- Utilities ---
export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames, clipsOverlap } from './utils/frames'
export { generateId } from './utils/id'
export { snapFrame, buildSnapPoints, resolveOverlapEdgeSnap, DEFAULT_OVERLAP_TOLERANCE } from './utils/snap'

// --- Export pipeline ---
export { exportVideo } from './export'
export { lazyExportVideo } from './export/lazyExport'
export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec } from './export'

// --- Debug/trace ---
export { installTraceGlobal, trace } from './debug/trace'
