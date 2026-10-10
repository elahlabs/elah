/**
 * @elah/editor
 *
 * Engine-first video editor framework.
 * Batteries-included composition of @elah/core, @elah/react, and @elah/timeline.
 *
 * This barrel re-exports the *public* API of those three packages, so an app can
 * import everything it needs from `@elah/editor` alone. Renderer and debug
 * internals (`resolveDrawRect`, `computeTextLayout`, `SIDE_MARGIN`, `trace`,
 * `installTraceGlobal`, …) are deliberately left out (`PerfSummary` is the one
 * diagnostic that is re-exported) — import those from
 * `@elah/core` directly if you are building a custom renderer.
 */

// --- Re-export core (types + engines) ---
export type {
  Clip,
  Track,
  Project,
  Transform,
  TextAnimation,
  TextAnimationKind,
  TextAnimationKindOption,
  TextAnimationEasing,
  MotionSpec,
  TextStylePreset,
  ClipType,
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
} from '@elah/core'

export { TimelineEngine } from '@elah/core'

export {
  BUILT_IN_TEXT_STYLE_PRESETS,
  BUILT_IN_TEXT_TEMPLATES,
  applyTextTemplate,
  findTextTemplate,
  // Needed by anything that builds a timeline from a template rather than
  // applying one to a clip the user selected — see `lib/motion/overlay.ts`.
  resolveTemplateRamp,
  LINE_HEIGHT,
} from '@elah/core'
export {
  MAX_TEMPLATE_RAMP_FRAMES,
  MIN_TEMPLATE_RAMP_FRAMES,
} from '@elah/core'
export type {
  TextTemplate,
  TextTemplateStyle,
  TextTemplateAnimation,
  TextTemplateStagger,
} from '@elah/core'

// --- Entry/exit animation sampling (pure; for custom previews and pickers) ---
export {
  sampleTextAnimation,
  resolveRampFrames,
  TEXT_ANIMATION_EASINGS,
  motionForKind,
  DEFAULT_SHAPE_TRANSFORM,
  SLIDE_TRAVEL_NORMALIZED,
  SPIN_TRAVEL_RADIANS,
} from '@elah/core'
export type { TextAnimationSample, SampleTextAnimationArgs } from '@elah/core'

// --- Restore: a stored document back into the engine ---
export {
  PROJECT_VERSION,
  ProjectDocumentError,
  readProjectDocument,
  isReadableProjectDocument,
  isRecoverableMediaSrc,
  relinkProjectMedia,
  missingMediaSummary,
} from '@elah/core'
export type {
  ProjectDocumentErrorCode,
  ReadProjectDocumentOptions,
  MediaClipType,
  MissingMedia,
  RelinkMediaResult,
} from '@elah/core'

// --- Persistence ---
export { serializeProject, deserializeProject } from '@elah/core'

export { PlaybackEngine } from '@elah/core'
export type { PlaybackSnapshot, PlaybackEngineConfig } from '@elah/core'

export { resolveTimeline } from '@elah/core'
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
} from '@elah/core'

export type { Renderer } from '@elah/core'
export { GpuRenderer } from '@elah/core'
export type { RendererOptions } from '@elah/core'

export { GpuDebugCounters } from '@elah/core'
export type { CounterSnapshot } from '@elah/core'

export { createDefaultDemuxerFactory, createMediabunnyBackend, isMediabunnyCompatible } from '@elah/core'
export type { MediabunnyModule, CreateMediabunnyBackendOpts } from '@elah/core'
export type { DemuxerBackend, DemuxerFactory, MediabunnyDemuxer } from '@elah/core'

export { sourceBlobCache, createSourceBlobCache, warmVideoSrc } from '@elah/core'
export type { SourceBlobCache, CreateSourceBlobCacheOpts, BlobFetcher } from '@elah/core'

export type { VideoFrameProvider, VideoFrameProviderDeps } from '@elah/core'
export { createVideoFrameProvider, MockVideoFrameProvider, SyntheticVideoFrameProvider } from '@elah/core'

export { AudioPlaybackController } from '@elah/core'
export type { AudioPlaybackControllerOptions } from '@elah/core'
export { defaultAudioResolver } from '@elah/core'
export type { AudioResolver } from '@elah/core'

export { warmImageSrc, preloadProjectImages } from '@elah/core'
export type { ImageLoader, LoadedImage } from '@elah/core'

// --- Media library ---
export {
  MEDIA_DRAG_MIME,
  mediaDragKindMime,
  importFiles,
  importUrl,
  importBlob,
  beginImportUrl,
  determineAssetHasAudio,
  probeHasAudio,
} from '@elah/core'
export { useMediaLibrary, useAssets, useMediaLibraryStore } from '@elah/react'
export type {
  MediaAsset,
  MediaKind,
  DragMediaPayload,
  MediaAssetAnalysis,
  MediaAssetTopObject,
  ImportFilesOptions,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
  SkippedImport,
  MediaLibraryState,
  MediaLibraryActions,
} from '@elah/core'
export type { UseMediaLibraryApi } from '@elah/react'

// --- Media library persistence (carrying thumbnails across a page load) ---
export {
  scheduleThumbnailById,
  snapshotMediaLibrary,
  hydrateMediaLibrary,
  refreshMissingThumbnails,
} from '@elah/core'
export type {
  MediaLibrarySnapshotEntry,
  HydrateMediaLibraryOptions,
  HydrateMediaLibraryResult,
} from '@elah/core'

// --- Store hooks (React) and the vanilla stores behind them ---
export {
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTransitionsStore,
  useTextStylePresetsStore,
  useClipLoadStore,
} from '@elah/react'
export type { BoundStoreHook } from '@elah/react'

// The framework-agnostic stores. Reach for these outside React (event handlers,
// imperative code); inside components prefer the `use*Store` hooks above.
export {
  tracksStore,
  playbackStore,
  selectionStore,
  transitionsStore,
  mediaLibraryStore,
  clipLoadStore,
  textStylePresetsStore,
} from '@elah/core'
export type {
  TracksState,
  TracksActions,
  PlaybackState,
  PlaybackActions,
  SelectionState,
  SelectionActions,
  TransitionsState,
  TransitionsActions,
  ClipLoadState,
  ClipLoadStoreState,
  ClipLoadStoreActions,
  TextStylePresetsState,
  TextStylePresetsActions,
} from '@elah/core'

// --- Clip factories ---
export { createVideoClip } from '@elah/core'
export { createAudioClip } from '@elah/core'
export { createTextClip } from '@elah/core'
export { createImageClip } from '@elah/core'
export { createShapeClip } from '@elah/core'
export { createFreehandClip } from '@elah/core'
export type {
  CreateClipOptions,
  CreateShapeClipOptions,
  CreateFreehandClipOptions,
  ShapeClipMetadata,
  FreehandClipMetadata,
} from '@elah/core'

export {
  TEXT_ANIMATION_KINDS,
  DEFAULT_TEXT_TRANSFORM,
} from '@elah/core'

export { splitClipAtPlayhead } from '@elah/core'
export type { SplitAtPlayheadData } from '@elah/core'
export type { ActionResult, ActionFailureReason } from '@elah/core'

export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames } from '@elah/core'
export { generateId } from '@elah/core'
export {
  transformFromContainRect,
  transformFromCoverRect,
  normalizeCrop,
  FULL_CROP,
} from '@elah/core'
export type { CropRect } from '@elah/core'

// --- Snapping / overlap helpers (for custom drag and trim interactions) ---
export { snapFrame, buildSnapPoints, resolveOverlapEdgeSnap, clipsOverlap, DEFAULT_OVERLAP_TOLERANCE } from '@elah/core'

// --- Timeline geometry (pure; the math behind @elah/timeline and @elah/react-native) ---
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
} from '@elah/core'
export type { RulerTick, TrimResult, TrimLimits } from '@elah/core'


// --- Frame sequences (ordered image sets: 360° orbits, generated sets, storyboards) ---
export {
  createFrameSequence,
  frameAt,
  frameCount,
  normalizeFrameIndex,
  FrameSequenceController,
  createFramePreloader,
  pickFrameSource,
  supportsImageType,
  frameSequenceToProject,
} from '@elah/core'
export type {
  Frame,
  FrameSource,
  FrameSequence,
  FrameLoopMode,
  CreateFrameSequenceOptions,
  FrameSequenceSnapshot,
  FrameSequenceControllerOptions,
  FramePreloader,
  FramePreloaderOptions,
  FramePreloaderStatus,
  FrameSourceSizeHint,
  FrameSequenceToProjectOptions,
} from '@elah/core'

// --- Diagnostics ---
export { PerfSummary } from '@elah/core'

export { exportVideo } from '@elah/core'
export { lazyExportVideo } from '@elah/core'
export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec } from '@elah/core'

// --- Re-export timeline ---
export { Timeline } from '@elah/timeline'
export type { TimelineProps, TimelineRef, TimelineClassNames } from '@elah/timeline'
export { cn } from '@elah/timeline'

export { useTimeline } from '@elah/timeline'
export { useTracks } from '@elah/timeline'
export { usePlayback } from '@elah/timeline'
export { useSelection } from '@elah/timeline'
export { useTimelineDrop } from '@elah/timeline'
export type { TimelineDropState } from '@elah/timeline'
export { insertMediaAsset, insertElement, growClipToAssetDuration } from '@elah/timeline'
export { ELEMENT_DRAG_MIME } from '@elah/timeline'
export type {
  DragElementPayload,
  ElementKind,
  ShapeVariant,
  InsertAssetOptions,
  InsertAssetResult,
  InsertAssetFailureReason,
  InsertedKind,
} from '@elah/timeline'

// --- Editor composition layer ---
export { EditorProvider } from '@elah/react'
export type { EditorProviderProps } from '@elah/react'

export { EditorContext, useEditor, useTimelineEngine, usePlaybackEngine } from '@elah/react'
export type { EditorContextValue } from '@elah/react'

// --- Audio mixer hooks ---
export { useAudioMixer, useMasterVolume, useTrackLevels } from '@elah/react'
export type { AudioMixerApi, MasterVolumeApi, TrackLevel } from '@elah/react'

export { useResolvedScene } from './editor/useResolvedScene'

export { AssetPanel } from './editor/AssetPanel'
export type { AssetPanelProps } from './editor/AssetPanel'

export { ElementsPanel } from './editor/ElementsPanel'
export type { ElementsPanelProps } from './editor/ElementsPanel'

export { SourcePanel } from './editor/SourcePanel'
export type { SourcePanelProps, SourcePanelClassNames } from './editor/SourcePanel'
export type { AssetActivationPayload, AssetActivationHandler } from './editor/activation'

export { Preview } from './editor/Preview'
export type { PreviewProps, PreviewHandle } from './editor/Preview'
