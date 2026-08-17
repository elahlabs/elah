/**
 * @elah/editor
 *
 * Engine-first video editor framework.
 * Batteries-included composition of @elah/core, @elah/react, and @elah/timeline.
 *
 * This barrel re-exports the *public* API of those three packages, so an app can
 * import everything it needs from `@elah/editor` alone. Renderer and debug
 * internals (`resolveDrawRect`, `computeTextLayout`, `SIDE_MARGIN`, `trace`,
 * `installTraceGlobal`, …) are deliberately left out — import those from
 * `@elah/core` directly if you are building a custom renderer.
 */

// --- Re-export core (types + engines) ---
export type {
  Clip,
  Track,
  Project,
  Transform,
  AnimationChannel,
  AnimationKeyframe,
  AnimationProperty,
  AnimationEasing,
  AnimationDirection,
  TextAnimation,
  ShapeAnimation,
  TextAnimationKind,
  TextLoopAnimationKind,
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
} from '@elah/core'

export { applyAnimationEasing, evaluateAnimationChannel } from '@elah/core'

export { TimelineEngine } from '@elah/core'
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

export type { VideoFrameProvider, VideoFrameProviderDeps } from '@elah/core'
export { createVideoFrameProvider, MockVideoFrameProvider, SyntheticVideoFrameProvider } from '@elah/core'

export { AudioPlaybackController } from '@elah/core'
export type { AudioPlaybackControllerOptions } from '@elah/core'
export { defaultAudioResolver } from '@elah/core'
export type { AudioResolver } from '@elah/core'

export { warmImageSrc, preloadProjectImages } from '@elah/core'
export type { ImageLoader, LoadedImage } from '@elah/core'

// --- Media library ---
export { MEDIA_DRAG_MIME, mediaDragKindMime, importFiles, importUrl, importBlob } from '@elah/core'
export { useMediaLibrary, useAssets, useMediaLibraryStore } from '@elah/react'
export type {
  MediaAsset,
  MediaKind,
  DragMediaPayload,
  ImportFilesOptions,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
  SkippedImport,
  MediaLibraryState,
  MediaLibraryActions,
} from '@elah/core'
export type { UseMediaLibraryApi } from '@elah/react'

// --- Store hooks (React) and the vanilla stores behind them ---
export { useTracksStore } from '@elah/react'
export { usePlaybackStore } from '@elah/react'
export { useSelectionStore } from '@elah/react'
export { useTransitionsStore } from '@elah/react'
export type { BoundStoreHook } from '@elah/react'

// The framework-agnostic stores. Reach for these outside React (event handlers,
// imperative code); inside components prefer the `use*Store` hooks above.
export { tracksStore, playbackStore, selectionStore, transitionsStore, mediaLibraryStore } from '@elah/core'
export type {
  TracksState,
  TracksActions,
  PlaybackState,
  PlaybackActions,
  SelectionState,
  SelectionActions,
  TransitionsState,
  TransitionsActions,
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

export { splitClipAtPlayhead } from '@elah/core'
export type { SplitAtPlayheadData } from '@elah/core'
export type { ActionResult, ActionFailureReason } from '@elah/core'

export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames } from '@elah/core'
export { generateId } from '@elah/core'
export { transformFromCoverRect } from '@elah/core'

// --- Snapping / overlap helpers (for custom drag and trim interactions) ---
export { snapFrame, buildSnapPoints, resolveOverlapEdgeSnap, clipsOverlap, DEFAULT_OVERLAP_TOLERANCE } from '@elah/core'

// --- Persistence ---
export { serializeProject, deserializeProject } from '@elah/core'

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
export { insertMediaAsset, insertElement } from '@elah/timeline'
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
export { EditorProvider } from './editor/EditorProvider'
export type { EditorProviderProps } from './editor/EditorProvider'

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
