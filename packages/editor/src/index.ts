/**
 * @elah/editor
 *
 * Engine-first video editor framework.
 * Batteries-included composition of @elah/core and @elah/timeline.
 */

// --- Re-export core (types + engines) ---
export type {
  Clip,
  Track,
  Project,
  Transform,
  TextAnimation,
  TextAnimationKind,
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
  ActiveClipBase,
} from '@elah/core'

export type { Renderer } from '@elah/core'
export { GpuRenderer } from '@elah/core'
export type { RendererOptions } from '@elah/core'

export { GpuDebugCounters } from '@elah/core'
export type { CounterSnapshot } from '@elah/core'

export { createMediabunnyBackend, isMediabunnyCompatible } from '@elah/core'
export type { MediabunnyModule, CreateMediabunnyBackendOpts } from '@elah/core'
export type { DemuxerBackend, DemuxerFactory } from '@elah/core'

export type { VideoFrameProvider, VideoFrameProviderDeps } from '@elah/core'
export { createVideoFrameProvider, MockVideoFrameProvider, SyntheticVideoFrameProvider } from '@elah/core'

export { AudioPlaybackController } from '@elah/core'
export type { AudioPlaybackControllerOptions } from '@elah/core'

export { useMediaLibrary, useMediaLibraryStore, MEDIA_DRAG_MIME, importFiles } from '@elah/core'
export type { MediaAsset, MediaKind, DragMediaPayload, ImportFilesOptions, ImportFilesResult, SkippedImport } from '@elah/core'

export { useTracksStore } from '@elah/core'
export { usePlaybackStore } from '@elah/core'
export { useSelectionStore } from '@elah/core'

export { createVideoClip } from '@elah/core'
export { createAudioClip } from '@elah/core'
export { createTextClip } from '@elah/core'
export { createImageClip } from '@elah/core'

export { splitClipAtPlayhead } from '@elah/core'
export type { SplitAtPlayheadData } from '@elah/core'
export type { ActionResult, ActionFailureReason } from '@elah/core'

export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames } from '@elah/core'
export { generateId } from '@elah/core'

export { exportVideo } from '@elah/core'
export { lazyExportVideo } from '@elah/core'
export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec } from '@elah/core'

// --- Re-export timeline ---
export { Timeline } from '@elah/timeline'
export type { TimelineProps, TimelineRef } from '@elah/timeline'

export { useTimeline } from '@elah/timeline'
export { useTracks } from '@elah/timeline'
export { usePlayback } from '@elah/timeline'
export { useSelection } from '@elah/timeline'
export { useTimelineDrop } from '@elah/timeline'
export { ELEMENT_DRAG_MIME } from '@elah/timeline'
export type { DragElementPayload, ElementKind } from '@elah/timeline'

// --- Editor composition layer ---
export { EditorProvider } from './editor/EditorProvider'
export type { EditorProviderProps } from './editor/EditorProvider'

export { useEditor, useTimelineEngine, usePlaybackEngine } from '@elah/core'

export { useResolvedScene } from './editor/useResolvedScene'

export { AssetPanel } from './editor/AssetPanel'
export type { AssetPanelProps } from './editor/AssetPanel'

export { ElementsPanel } from './editor/ElementsPanel'
export type { ElementsPanelProps } from './editor/ElementsPanel'

export { Preview } from './editor/Preview'
export type { PreviewProps, PreviewHandle } from './editor/Preview'
