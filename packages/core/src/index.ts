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
  TextAnimationEasing,
  MotionSpec,
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
  LoadProjectHistory,
  LoadProjectTransport,
  ProjectLoadedEvent,
} from './types'

// --- Engine ---
export { TimelineEngine } from './editor/TimelineEngine'

// --- Restore: stored document → Project ---
export {
  PROJECT_VERSION,
  ProjectDocumentError,
  readProjectDocument,
  isReadableProjectDocument,
  isRecoverableMediaSrc,
  relinkProjectMedia,
  missingMediaSummary,
} from './editor/projectDocument'
export type {
  ProjectDocumentErrorCode,
  ReadProjectDocumentOptions,
  MediaClipType,
  MissingMedia,
  RelinkMediaResult,
} from './editor/projectDocument'

// --- Persistence ---
export { serializeProject, deserializeProject } from './project/serialization'

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

// --- Entry/exit animations (pure; consumed by the resolver + UI pickers) ---
export {
  sampleTextAnimation,
  resolveRampFrames,
  TEXT_ANIMATION_KINDS,
  TEXT_ANIMATION_EASINGS,
  motionForKind,
  DEFAULT_TEXT_TRANSFORM,
  DEFAULT_SHAPE_TRANSFORM,
  SLIDE_TRAVEL_NORMALIZED,
  SPIN_TRAVEL_RADIANS,
} from './resolver/textAnimation'
export type {
  TextAnimationSample,
  SampleTextAnimationArgs,
  TextAnimationKindOption,
} from './resolver/textAnimation'

// --- Renderer interface ---
export type { Renderer } from './renderer/types'
export { GpuRenderer } from './renderer/gpu/GpuRenderer'
export type { RendererOptions } from './renderer/gpu/types'

// --- Renderer internals (used by overlays + placement helpers) ---
export { resolveDrawRect, transformFromContainRect, transformFromCoverRect, normalizeCrop, FULL_CROP } from './renderer/gpu/layers/drawRect'
export type { CropRect } from './renderer/gpu/layers/drawRect'
export { computeContainViewport } from './renderer/gpu/viewport'
export { computeTextLayout, SIDE_MARGIN, LINE_HEIGHT } from './renderer/gpu/layers/textLayout'
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

// --- Source Blob cache (video download deduping) ---
export {
  sourceBlobCache,
  createSourceBlobCache,
  defaultBlobFetcher,
  warmVideoSrc,
} from './media/video/demuxer/sourceBlobCache'
export type {
  SourceBlobCache,
  CreateSourceBlobCacheOpts,
  BlobFetcher,
} from './media/video/demuxer/sourceBlobCache'

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
  beginImportUrl,
  scheduleThumbnailById,
  snapshotMediaLibrary,
  hydrateMediaLibrary,
  refreshMissingThumbnails,
  determineAssetHasAudio,
  hasAudioDetermined,
  probeHasAudio,
} from './assets'
export type {
  MediaAsset,
  MediaKind,
  DragMediaPayload,
  MediaAssetAnalysis,
  MediaAssetTopObject,
  MediaLibraryState,
  MediaLibraryActions,
  MediaLibrarySnapshotEntry,
  HydrateMediaLibraryOptions,
  HydrateMediaLibraryResult,
  ImportFilesOptions,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
  SkippedImport,
} from './assets'

// --- Stores (Ring 1 mirrors + Ring 2 UI state) — vanilla; see @elah/react ---
export { tracksStore } from './stores/tracks.store'
export type { TracksState, TracksActions } from './stores/tracks.store'
export { playbackStore } from './stores/playback.store'
export type { PlaybackState, PlaybackActions } from './stores/playback.store'
export { clipLoadStore } from './stores/clipLoad.store'
export type {
  ClipLoadState,
  ClipLoadStoreState,
  ClipLoadStoreActions,
} from './stores/clipLoad.store'
export { selectionStore } from './stores/selection.store'
export type { SelectionState, SelectionActions } from './stores/selection.store'
export { transitionsStore } from './stores/transitions.store'
export type { TransitionsState, TransitionsActions } from './stores/transitions.store'
export { textStylePresetsStore, BUILT_IN_TEXT_STYLE_PRESETS } from './stores/textStylePresets.store'
export type {
  TextStylePreset,
  TextStylePresetsState,
  TextStylePresetsActions,
} from './stores/textStylePresets.store'

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
export {
  BUILT_IN_TEXT_TEMPLATES,
  applyTextTemplate,
  findTextTemplate,
  resolveTemplateRamp,
  MAX_TEMPLATE_RAMP_FRAMES,
  MIN_TEMPLATE_RAMP_FRAMES,
} from './elements/textTemplates'
export type {
  TextTemplate,
  TextTemplateStyle,
  TextTemplateAnimation,
  TextTemplateStagger,
} from './elements/textTemplates'


// --- Actions ---
export { splitClipAtPlayhead } from './actions/splitClipAtPlayhead'
export type { SplitAtPlayheadData } from './actions/splitClipAtPlayhead'
export type { ActionResult, ActionFailureReason } from './actions/types'

// --- Utilities ---
export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames, clipsOverlap } from './utils/frames'
export { generateId } from './utils/id'
export { snapFrame, buildSnapPoints, resolveOverlapEdgeSnap, DEFAULT_OVERLAP_TOLERANCE } from './utils/snap'

// --- Timeline geometry (pure; shared by @elah/timeline and @elah/react-native) ---
export {
  TIMELINE_MIN_CONTENT_WIDTH,
  timelineContentWidth,
  pxToFrames,
  xToFrame,
  seekFrameAtX,
  snapThresholdFrames,
  ZOOM_MIN,
  ZOOM_MAX,
  clampZoom,
  computeAnchoredScrollLeft,
  resolveZoomAnchorX,
  wheelZoomStep,
  pinchZoom,
  RULER_TICK_INTERVALS_SEC,
  formatRulerLabel,
  computeRulerTicks,
  isCompatibleTrackKind,
  isClipAllowedOnTrack,
  TRIM_HANDLE_WIDTH_PX,
  isUnlimitedClipType,
  maxTrimDuration,
  minTrimDuration,
  minLeftTrimStart,
  neighbourBounds,
  clampLeftTrim,
  clampRightTrim,
} from './utils/timelineMath'
export type { RulerTick, TrimResult, TrimLimits } from './utils/timelineMath'


// --- Export pipeline ---
export { exportVideo } from './export'
export { lazyExportVideo } from './export/lazyExport'
export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec } from './export'

// --- Debug/trace ---
export { installTraceGlobal, trace } from './debug/trace'
export { PerfSummary } from './debug/PerfSummary'

// --- Frame sequences (ordered image sets: 360° orbits, generated sets, storyboards) ---
export {
  createFrameSequence,
  frameAt,
  frameCount,
  normalizeFrameIndex,
} from './frames/frameSequence'
export type {
  Frame,
  FrameSource,
  FrameSequence,
  FrameLoopMode,
  CreateFrameSequenceOptions,
} from './frames/frameSequence'
export { FrameSequenceController } from './frames/FrameSequenceController'
export type {
  FrameSequenceSnapshot,
  FrameSequenceControllerOptions,
} from './frames/FrameSequenceController'
export { createFramePreloader } from './frames/framePreloader'
export type {
  FramePreloader,
  FramePreloaderOptions,
  FramePreloaderStatus,
} from './frames/framePreloader'
export { pickFrameSource, supportsImageType } from './frames/frameSource'
export type { FrameSourceSizeHint } from './frames/frameSource'
export { frameSequenceToProject } from './frames/frameSequenceProject'
export type { FrameSequenceToProjectOptions } from './frames/frameSequenceProject'
