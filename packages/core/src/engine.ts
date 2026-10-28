/**
 * @elah/core/engine
 *
 * The browser-free subset of @elah/core: the data model, the TimelineEngine,
 * the pure resolver, the PlaybackEngine clock, the vanilla stores, the clip
 * factories and the pure placement / timeline math. Everything here runs in
 * Node, in a worker, and under React Native's Metro + Hermes.
 *
 * What is deliberately NOT here: the WebGL2 renderer, WebCodecs decode,
 * mediabunny demux, the MP4 export worker (the one file with `import.meta`,
 * which Metro and Hermes reject), the DOM-based media importers, and
 * `AudioPlaybackController` (typed against lib.dom's AudioContext; RN-P7
 * decides how mobile gets it).
 *
 * `engine.no-browser.test.ts` walks the import graph from this file and fails
 * if anything browser-bound becomes reachable. Add a module here on purpose,
 * and add it to that test's allowlist in the same change.
 *
 * Stores are module singletons: `tracksStore` from '@elah/core' and from
 * '@elah/core/engine' is the same object, because both barrels re-export the
 * same module file.
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

// --- Restore: stored document -> Project ---
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

// --- Resolver ---
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

// --- Renderer contract + pure placement helpers (no GL) ---
export type { Renderer } from './renderer/types'
export { resolveDrawRect, transformFromContainRect, transformFromCoverRect, normalizeCrop, FULL_CROP } from './renderer/gpu/layers/drawRect'
export type { CropRect } from './renderer/gpu/layers/drawRect'
export { computeContainViewport } from './renderer/gpu/viewport'
export { computeTextLayout, SIDE_MARGIN, LINE_HEIGHT } from './renderer/gpu/layers/textLayout'
export type { TextLayout } from './renderer/gpu/layers/textLayout'

// --- Media library model (the store and types; importers are browser-only) ---
export { mediaLibraryStore } from './assets/store'
export type { MediaLibraryState, MediaLibraryActions } from './assets/store'
export { MEDIA_DRAG_MIME, mediaDragKindMime } from './assets/types'
export type { MediaAsset, MediaKind, DragMediaPayload, MediaAssetAnalysis, MediaAssetTopObject } from './assets/types'

// --- Stores ---
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

// --- Timeline geometry ---
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

// --- Debug / trace (window-guarded) ---
export { installTraceGlobal, trace } from './debug/trace'
export { PerfSummary } from './debug/PerfSummary'

// --- Frame sequences (pure parts; the preloader and source picker use <img>) ---
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
export { frameSequenceToProject } from './frames/frameSequenceProject'
export type { FrameSequenceToProjectOptions } from './frames/frameSequenceProject'
