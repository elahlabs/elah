/**
 * @elah/core
 *
 * Framework-agnostic video timeline engine.
 * Zero React imports. Worker-safe. Node-safe. Deterministic.
 *
 * The stores exported here are **vanilla** Zustand stores (`zustand/vanilla`).
 * React consumers should not subscribe to them directly — install
 * `@elah/react`, which binds each one into a `useXStore` hook that also
 * carries the imperative `StoreApi`. The rule is enforced by
 * `src/no-react-imports.test.ts`.
 */

// --- Types ---
export type {
  Clip,
  ClipAudio,
  ClipAudioEnhance,
  Track,
  Project,
  Transform,
  TextAnimation,
  TextAnimationKind,
  TextAnimationEasing,
  MotionSpec,
  ClipType,
  ShapeVariant,
  ShapeArrowHead,
  ShapeFillRule,
  ShapeViewBox,
  // PV-P6a: stroke cap/join/alignment for the shape painter.
  ShapeStrokeCap,
  ShapeStrokeJoin,
  ShapeStrokeAlign,
  TrackKind,
  FrameCount,
  TimelineConfig,
  InitialTrackConfig,
  EngineEvent,
  LoadProjectHistory,
  LoadProjectTransport,
  ProjectLoadedEvent,
  Transition,
  TransitionKind,
  TransitionEasing,
  TransitionDirection,
  Keyframe,
  KeyframeSpring,
  KeyframeChannel,
  KeyframeChannelTrack,
  KeyframeSource,
  AnyKeyframeChannel,
  MaskKeyframeField,
  ClipKeyframes,
  Effect,
  BlendMode,
  ClipMask,
  ClipMaskKind,
  ClipMatte,
  ClipRoto,
  RotoViewMode,
  // PV-P8: sequence clips (animated image / numbered image sequence).
  SequenceKind,
  ClipSequence,
  Marker,
  InOutRange,
  TextOutline,
  TextShadow,
  TextDecoration,
  // PV-P4b: the widened weight union and the italic style, used by the picker.
  FontWeight,
  FontStyle,
  // PV-P4c-1: the shared fill type.
  Paint,
  PaintStop,
  // PV-P4c-2: styled runs of a text clip's content.
  TextSpan,
  // PV-P3a: the text box, its overflow rule and its vertical alignment.
  TextBox,
  TextOverflow,
  TextVerticalAlign,
  TextAnimator,
  TextScramble,
  TextAnimatorTween,
  TextAnimatorChannel,
  TextAnimatorUnit,
  TextAnimatorPreset,
  CaptionWord,
  CaptionMode,
  ClipGenerator,
  ShapeDraw,
  TimelineMode,
  TrackGroup,
  ClipCompound,
  // PV-P3b: layout constraints that replace a clip's base transform.
  ClipLayout,
  LayoutEdge,
  LayoutAlign,
  LayoutRegion,
  // PV-P10b: one audio source's analysis summary, stored on Project.audioMarkers.
  AudioMarkerSet,
  // EG-P1: provenance of a generated component (Clip.component / Project.authored).
  ClipComponentInstance,
  ClipSceneSource,
  ProjectAuthored,
  JsonObject,
  // LM-P1: which local file a media clip came from (Clip.media / MediaAsset.media).
  ClipMediaRef,
} from './types'

// A value, not a type: the depth limit the reader and the resolver both need.
export { MAX_COMPOUND_DEPTH } from './types'

// --- Audio analysis (PV-P10b) ---
export { analyzePcm, PcmAnalyzer, ANALYSIS_VERSION } from './audio/analysis'
// LM-P5: chunked analysis and ranged audio decode.
export { analyzeAudioStream } from './audio/analyzeStream'
export type { AnalyzeAudioStreamOptions } from './audio/analyzeStream'
export {
  openAudioStream,
  streamPeaks,
  resampleLinear,
  NoAudioTrackError,
  STREAM_AUDIO_ABOVE_BYTES,
  WHOLE_FILE_DECODE_MAX_BYTES,
} from './media/audio/streamDecode'
export type {
  AudioStream,
  AudioRange,
  ReadRangeOptions,
  OpenAudioStreamOptions,
  StreamPeaksOptions,
  MediabunnyAudioLike,
} from './media/audio/streamDecode'
export { AudioChunkCache, STREAM_CHUNK_SEC, MAX_STREAM_CHUNKS_PER_SOURCE } from './media/audio/audioChunkCache'
export type { AudioAnalysis, AudioAnalysisOptions } from './audio/analysis'
export {
  encodeEnvelope,
  decodeEnvelope,
  summarizeAnalysis,
  markerSetForClip,
  sourceToTimelineFrame,
  clipBeatFrames,
  clipSilenceRanges,
  beatFramesOnTimeline,
  localBeatsInClip,
  defaultAudioSourceFor,
  MAX_ENVELOPE_FRAMES,
  audioValueAt,
  AUDIO_EXPR_NAMES,
} from './audio/markers'
export type { AudioExprName } from './audio/markers'
// The module-worker wrapper (PV-P10b-2): decode stays on the main thread, this
// runs analyzePcm off it, falling back to the calling thread where there is no
// Worker (Node, a restrictive bundler/CSP).
export { analyzePcmInWorker } from './audio/analyzeInWorker'
export type { AnalyzeInWorkerResult } from './audio/analyzeInWorker'

// --- Captions and text animators (EDX-P8) ---
export {
  estimateWordTimings,
  animatorLengthFrames,
  CAPTION_LOOKS,
  CAPTION_LOOK_SAMPLE,
  findCaptionLook,
  captionLookAnimator,
  captionLookOutlasts,
  captionLookPatch,
  TEXT_ANIMATOR_PRESETS,
  TEXT_ANIMATOR_TWEEN_PRESETS,
  TEXT_ANIMATOR_UNITS,
  TEXT_ANIMATOR_KINDS,
  // PV-P10c-1: frame-accurate caption clips from timed transcript words.
  captionClipsFromTranscript,
  distributeWordsEvenly,
  CAPTION_BOTTOM_Y,
} from './elements/captions'
export type { TranscriptWord, CaptionBuildOptions, CaptionPosition, CaptionLook } from './elements/captions'
export { paintText, textPaintSignature, animatorUnitState, captionWordState } from './renderer/gpu/layers/textPaint'
export { BLEND_MODES } from './types'

// --- Fonts (PV-P4a) ---
export {
  FONT_REGISTRY,
  FONT_CATEGORY_LABELS,
  DEFAULT_FONT_BASE_URL,
  getFont,
  fontFaceFamily,
  fontFamilyCss,
  fontFileUrl,
  fontWeights,
  fontHasItalic,
} from './fonts/registry'
export type { FontDef, FontFile, FontCategory } from './fonts/registry'
export { ensureFonts, fontsEpoch, onFontsChange, resolveFontBaseUrl, collectFontIds } from './fonts/loader'
export type { EnsureFontsOptions } from './fonts/loader'
export { packageFontsBaseUrl } from './fonts/packageFonts'

// --- Effects (registry + per-frame resolution; rendering lands in EDX-P2) ---
export {
  EFFECT_REGISTRY,
  EFFECT_CATEGORIES,
  getEffectDefinition,
  effectsFor,
  clampParam,
  clampEffectParams,
  defaultEffectParams,
  createEffect,
  applyEffectPreset,
  keyframeableParams,
  keyframeableColorParams,
} from './effects/registry'
export { EFFECT_BUNDLES, findEffectBundle, bundleEffects } from './effects/bundles'

// --- Transitions (EDX-P9c) ---
export { TRANSITION_REGISTRY, TRANSITION_KINDS, getTransitionDefinition, isTransitionKind } from './transitions/registry'
export type { TransitionDefinition } from './transitions/registry'

// --- Generators (EDX-P9) ---
export {
  GENERATOR_REGISTRY,
  GENERATOR_CATEGORIES,
  getGeneratorDefinition,
  clampGeneratorParams,
  createGenerator,
  keyframeableGeneratorParams,
} from './generators/registry'
export type { GeneratorDefinition, GeneratorCategory } from './generators/registry'
export { paintGenerator, generatorPaintSignature, counterValue, formatCounter, parseChartValues } from './renderer/gpu/layers/generatorPaint'
export { applyDrawOn, clearDrawOn, DRAW_ON_MODES } from './elements/drawOn'
export type { DrawOnMode } from './elements/drawOn'
export type { EffectBundle } from './effects/bundles'
export type {
  EffectCategory,
  EffectParamValue,
  ParamDef,
  EffectPreset,
  EffectDefinition,
} from './effects/registry'
export {
  resolveEffects,
  resolveMask,
  resolveBlend,
  resolveMatte,
  resolveCompositing,
} from './effects/resolveEffects'
export type { ResolvedEffect, ResolvedMatte, ResolvedCompositing } from './effects/resolveEffects'

// --- Typed keyframe channels: colour and path values (PV-P5c) ---
export { parseColor, formatColor, vecToHex, lerpColor, toRgba } from './utils/color'
export type { Rgba } from './utils/color'
export { parsePathToCubics, sameStructure, morphCubics, serializeCubics, reconcileCubics, splitCubicAt } from './resolver/pathMorph'
export { buildPathTable, samplePathPosition, applyMotionPath, motionPathIssue } from './resolver/motionPath'
export type { PathTable, PathSample } from './resolver/motionPath'
export type { CubicSubpath, Reconciled } from './resolver/pathMorph'


// --- Programmatic compositions (PV-P7) ---
// `MAX_COMPOUND_DEPTH` is already exported above (from './types'); the
// composition module reuses that constant rather than defining its own, so
// it is not re-listed here (a second `export { MAX_COMPOUND_DEPTH }` line
// from a different module is a duplicate-export error, not a merge).
export {
  PROP_TYPES, PROP_NAME_RE,
  parseClipPath, parseFieldPath, getAtPath, setAtPath, interpolateTemplate,
  coerceProp, validateProps, fallbackValue, isMediaUrl,
} from './composition'
export type {
  PropValue, PropType, PropDef, Binding, ProjectComposition,
  PropIssue, PropIssueCode, BindingIssue, BindingIssueCode, CompositionIssue,
  FieldPath, ValidatedProps,
} from './composition'
// PV-P7a-2: instantiate, regenerateIds, deriveComposition and prop().
export {
  instantiate,
  regenerateIds,
  deriveComposition,
  propIdentifier,
  uniquePropName,
  compositionPropReader,
  propReaderFor,
} from './composition'
export type { InstantiateOptions, InstantiateResult, PropReader } from './composition'
// PV-P7c-1: engine commits for a composition (one undo step each).
export { commitComposition, commitPropValues } from './composition'
export type { CommitResult } from './composition'

// --- Engine ---
export { TimelineEngine } from './editor/TimelineEngine'

// --- Restore: stored document → Project ---
export {
  PROJECT_VERSION,
  documentVersionFor,
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
  RelinkMediaOptions,
  RelinkMediaResult,
} from './editor/projectDocument'

// --- Persistence ---
export { serializeProject, deserializeProject } from './project/serialization'

// LM-P1: stamp local-file references onto clips at save time.
export { stampMediaRefs } from './editor/mediaRefs'
export type { StampableAsset } from './editor/mediaRefs'

// --- Playback ---
export { PlaybackEngine } from './playback/PlaybackEngine'
export type { PlaybackSnapshot, PlaybackEngineConfig } from './playback/PlaybackEngine'

// --- Resolver (pure, deterministic, React-free) ---
export { resolveTimeline } from './resolver/resolveTimeline'
export type { ResolveOptions } from './resolver/resolveTimeline'
export { resolveRotoMasks, rotoFrameUrl, parseHexColor, isDrawableRoto } from './resolver/rotoMasks'
// PV-P8: pure sequence-clip helpers — the frame-index rule preview and
// export share, plus the URL and source-identity helpers built on it.
export { isDrawableSequence, sequenceFrameIndex, sequenceFrameUrl, sequenceSourceKey } from './resolver/sequence'
export type {
  Scene,
  ActiveTransition,
  ActiveVideoClip,
  ActiveRotoMask,
  ActiveAudioClip,
  ActiveTextClip,
  ActiveImageClip,
  ActiveShapeClip,
  ActiveFreehandClip,
  ActiveGeneratorClip,
  ActiveCompoundClip,
  // PV-P8: a sequence clip resolved at a frame.
  ActiveSequenceClip,
  ActiveClipBase,
  // PV-P3b: a layout constraint that could not be applied.
  LayoutError,
} from './resolver/scene'
// PV-P3b: the layout solver — a project's own use of `layout`, and the
// title-safe/action-safe insets its `region` values are defined against.
export { projectUsesLayout, TITLE_SAFE_INSET, ACTION_SAFE_INSET } from './resolver/layout'
// PV-P3b: one helper the preview and export worker share to build
// `ResolveOptions` — a measurer only when the project actually uses layout.
export { layoutResolveOptions } from './resolver/resolveOptions'

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

// --- Keyframes (pure sampler + remap; writers that return clip patches) ---
export {
  sampleKeyframes,
  sampleChannel,
  segmentProgress,
  normalizeKeys,
  hasKeyframes,
  remapKeyframes,
  isValidSteps,
  splitKeyframes,
  typeDefaultTransform,
  KEYFRAME_CHANNELS,
  TRANSFORM_CHANNELS,
  isBuiltinKeyframeChannel,
  isExpressionChannel,
  isKeyframeChannelName,
  parseEffectChannel,
  effectChannel,
  presentKeyframeChannels,
  sampleExtendedChannels,
  parseGeneratorChannel,
  // PV-P5c: typed (colour/path) channels.
  COLOR_CHANNELS,
  TYPED_CHANNELS,
  isTypedChannelName,
  normalizeVecKeys,
  normalizePathKeys,
  sampleVecChannel,
  sampleColorChannel,
  samplePathChannel,
  sampleTypedChannels,
  sampleEffectColors,
} from './resolver/keyframes'
export type { KeyframeSample, ChannelExpression, TypedSample } from './resolver/keyframes'
export {
  baselineTransform,
  setKeyframe,
  removeKeyframe,
  clearKeyframeChannel,
  editableTransform,
  gestureBaseTransform,
  routeTransformPatch,
  clampLocalFrame,
  channelKeys,
  keyedChannels,
  allKeyedChannels,
  keyFrameUnion,
  hasKeyAtFrame,
  prevKeyFrame,
  nextKeyFrame,
  keyDragRange,
  keySnapFrames,
  moveKeysAtFrame,
  moveKeysAtFrames,
  removeKeysAtFrame,
  setKeysEasingAtFrame,
  setKeysBezierAtFrame,
  setKeysHoldAtFrame,
  setKeysStepsAtFrame,
  setKeysSpringAtFrame,
  setChannelExpression,
  channelExpression,
  expressionChannels,
  moveKeyframe,
  clearAllKeyframes,
  // PV-P5c: typed (colour/path) channel writers.
  channelValueKind,
  authoredColor,
  setColorKeyframe,
  setPathKeyframe,
  keyFrameSwatches,
} from './elements/keyframes'
export type { ChannelValueKind } from './elements/keyframes'
export type { BaselineContext, SetKeyframeOptions, FilledTransform } from './elements/keyframes'
export { cubicBezier, isValidBezier, normalizeBezier } from './resolver/bezier'
export type { BezierTuple } from './resolver/bezier'
export { BEZIER_PRESETS, approxBezierFor, findBezierPreset, matchBezierPreset, reverseBezier, reverseEase } from './elements/easingPresets'
export { repeatKeysPatch } from './elements/keyRepeat'
export type { RepeatKeysOptions, RepeatKeysResult } from './elements/keyRepeat'

// --- Spring curves (PV-P5a) ---
export {
  SPRING_EPSILON,
  isValidSpring,
  normalizeSpring,
  springDisplacement,
  springSettleSeconds,
  springProgress,
  physicalSpring,
} from './resolver/spring'
export type { SpringParams } from './resolver/spring'
export { SPRING_PRESETS, findSpringPreset, matchSpringPreset } from './elements/springPresets'
export type { SpringPreset, SpringPresetId } from './elements/springPresets'

// --- Expressions (PV-P5b) ---
export {
  MAX_EXPRESSION_LENGTH,
  MAX_EXPRESSION_NODES,
  EXPR_IDENTIFIERS,
  EXPR_FUNCTIONS,
  CLIP_VIEW_FIELDS,
  STAGE_FIELDS,
  EASE_NAMES,
  seedFor,
} from './resolver/expr/scope'
export type { ExprEnv, ExprClipView, ExprErrorCode, ExpressionError } from './resolver/expr/scope'
export { tokenize } from './resolver/expr/tokenize'
export { parseExpression, clearExpressionCache } from './resolver/expr/parse'
export type { ExprNode, ParseResult } from './resolver/expr/parse'
export { evaluateExpression } from './resolver/expr/evaluate'
export { createExpressionContext, authoredChannelValue, sampleChannelExpression } from './resolver/expr/channels'
export type { ExpressionContext, ExpressionHooks } from './resolver/expr/channels'
export type { EvalContext, EvalResult } from './resolver/expr/evaluate'
export {
  sourceFrameFor,
  hasTimeRemap,
  timeRemapKeys,
  remappedSourceFrames,
  speedAt,
  sourceWindowEnd,
  sourceFramesAvailable,
  lastSourceFrame,
} from './resolver/sourceTime'
export {
  SPEED_PRESETS,
  SPEED_PRESET_NAMES,
  speedPresetKeys,
  applySpeedPreset,
  clearSpeedRemap,
  matchSpeedPreset,
} from './elements/speedPresets'
export type { SpeedPresetName, SpeedPresetOption, SpeedPresetParams } from './elements/speedPresets'
export type { BezierPreset } from './elements/easingPresets'

// --- Motion presets (named animations that expand into real keyframes) ---
export {
  MOTION_PRESET_NAMES,
  MOTION_PRESETS,
  SLIDE_TRAVEL,
  motionPresetKeys,
  motionRest,
  applyMotionPreset,
  fadeChannelFor,
  presetsFor,
  staggerPresetPatches,
  MOTION_PRESET_GROUPS,
  CAMERA_MOTION,
  SHAKE_MOTION,
} from './elements/motionPresets'
export { staggerOffsets, STAGGER_FROM_NAMES, type StaggerFrom, type StaggerOptions } from './elements/stagger'
export { scrambleText, resolveScrambleCharset, SCRAMBLE_PRESETS, type ScrambleOptions, type ScrambleCharsetPreset } from './elements/scramble'
export { noise1, shakeSamples } from './elements/noise'
export type { ShakeOptions } from './elements/noise'
export type {
  MotionPresetName,
  MotionPresetGroup,
  MotionPresetOption,
  MotionPresetParams,
  MotionRest,
  PresetKey,
  PresetKeys,
} from './elements/motionPresets'

// --- Beat presets (PV-P10b-3) ---
export {
  BEAT_PRESET_NAMES,
  BEAT_PRESETS,
  BEAT_MOTION,
  isBeatPreset,
  beatPresetKeys,
  applyBeatPreset,
} from './elements/beatPresets'
export type { BeatPresetName, BeatPresetParams, BeatPresetChannel, BeatPresetKeys } from './elements/beatPresets'
export { MAX_BEAT_CUTS, MAX_FREEZES, beatCutFrames, silenceFreezeKeys, silenceFreezePatch } from './elements/beatEdits'
export type { FreezeKey } from './elements/beatEdits'

// --- Range cuts and volume mixing (CHAT-5a) ---
export {
  MAX_REMOVE_RANGES,
  RANGE_MERGE_GAP_SEC,
  RANGE_MIN_SEC,
  clipSourceWindowSec,
  collapseFrame,
  planCaptionRemoval,
  planMemberCuts,
  planSourceRanges,
  segmentIndex,
  sourceRangesToLocalFrames,
} from './elements/rangeEdits'
export type {
  CaptionLike,
  CaptionRemovalPatch,
  CaptionRemovalPlan,
  KeptPiece,
  MemberCutPlan,
  SecondsRange,
  SourceRangePlan,
} from './elements/rangeEdits'
export {
  CROSSFADE_DEFAULT_MS,
  DUCK_DEFAULT_ATTACK_SEC,
  DUCK_DEFAULT_DB,
  DUCK_DEFAULT_RELEASE_SEC,
  JOIN_MAX_GAP_FRAMES,
  dbToGain,
  fadePatch,
  hasVolumeExpression,
  isAudioBearing,
  mergeSpans,
  planCrossfades,
  planDuck,
  volumeAt,
} from './elements/audioMix'
export type { CrossfadePlan, DuckOptions, DuckPlan, FadeRequest, MixPatch } from './elements/audioMix'

// --- Renderer interface ---
export type { Renderer } from './renderer/types'
export { GpuRenderer } from './renderer/gpu/GpuRenderer'
export type { RendererOptions } from './renderer/gpu/types'
export { RotoMaskLayer, fetchRotoMask } from './renderer/gpu/layers/RotoMaskLayer'
export type { RotoMaskLayerOptions, RotoMaskProviderFactory } from './renderer/gpu/layers/RotoMaskLayer'
// LM-P4: trimmed 16 kHz mono audio extraction for speech-to-text.
export { extractAudioForTranscription, NO_AUDIO_TRACK } from './media/audio/extractAudio'
export type { ExtractedAudio, ExtractAudioRange, ExtractAudioOptions, MediabunnyLike } from './media/audio/extractAudio'
export { RotoMaskFrameProvider, decodeRotoMaskWithImageBitmap } from './media/masks/RotoMaskFrameProvider'
export type {
  RotoMaskLoader,
  RotoMaskDecoder,
  RotoMaskImage,
  RotoMaskFrameProviderOptions,
} from './media/masks/RotoMaskFrameProvider'

// --- Sequence clips: decode and draw (PV-P8b) ---
// Optional renderer features load on first use (CONV-8). A host that wants a
// project's effects, generators, sequences, roto masks and Enhance ready before
// the first frame awaits `prepareFeatures(project)`.
export { prepareFeatures, featuresForProject } from './renderer/gpu/features'
export type { FeatureId } from './renderer/gpu/features'
export { SequenceLayer, fetchSequenceFrame } from './renderer/gpu/layers/SequenceLayer'
export type { SequenceLayerOptions } from './renderer/gpu/layers/SequenceLayer'
export { SequenceFrameProvider } from './media/sequence/SequenceFrameProvider'
export type { SequenceFrameProviderOptions, SequenceProviderState } from './media/sequence/SequenceFrameProvider'
export {
  openAnimatedImage,
  openFrameSequence,
  mimeForSource,
  bitmapOptions,
  defaultDecodeEnv,
} from './media/sequence/SequenceReader'
export type {
  SequenceFallback,
  SequenceImage,
  SequenceFrameReader,
  DecodeEnv,
} from './media/sequence/SequenceReader'

// --- Import: animated-image + video-alpha probes, matte pairing (PV-P8d) ---
export {
  fpsFromFrameDurations,
  probeAnimatedImage,
  probeAnimatedImageSrc,
  ANIMATABLE_IMAGE_TYPES,
} from './media/sequence/probeAnimatedImage'
export type { AnimatedImageInfo } from './media/sequence/probeAnimatedImage'
export { probeHasAlpha } from './media/video/alphaProbe'
export type { LoadMediabunny } from './media/video/alphaProbe'
export { matteStem, fileStem, findPairedMatte } from './assets/mattePairing'

// --- Renderer internals (used by overlays + placement helpers) ---
export { resolveDrawRect, transformFromContainRect, transformFromCoverRect, normalizeCrop, FULL_CROP } from './renderer/gpu/layers/drawRect'
export type { CropRect, DrawRect } from './renderer/gpu/layers/drawRect'
export { skewShear, rectShear, MAX_SKEW_RAD } from './renderer/gpu/layers/drawRect'
export type { Shear } from './renderer/gpu/layers/drawRect'
export { tiltOf, rectTilt, tiltFields, tiltHomography, projectTiltedPoint, DEFAULT_PERSPECTIVE } from './renderer/gpu/layers/drawRect'
export type { Tilt, Mat3 } from './renderer/gpu/layers/drawRect'
export { fitPlan, fitModeOf, isFitBackdrop } from './renderer/gpu/layers/fitCrop'
export type { FitMode, FitPlan } from './renderer/gpu/layers/fitCrop'
export {
  resolveShapeRect,
  paintShape,
  shapePaintSignature,
  SHAPE_LIMITS,
  DEFAULT_SHAPE_VIEWBOX,
} from './renderer/gpu/layers/shapePaint'
export type { Shape2DContext } from './renderer/gpu/layers/shapePaint'
// PV-P4c-1: the one fill type and its two helpers. Exported next to the shape
// painter because PV-P6a reuses all three for shape fill and stroke.
export { isPaint, paintSignature, toCanvasPaint, linearGradientPoints } from './renderer/gpu/layers/paint'
export type { PaintBox, PaintContext } from './renderer/gpu/layers/paint'
export { computeContainViewport } from './renderer/gpu/viewport'
export { computeTextLayout, cssFont, SIDE_MARGIN, LINE_HEIGHT, blockCenter, DEFAULT_MIN_FONT_SIZE, resolveTextBox, wrapText } from './renderer/gpu/layers/textLayout'
export type { LinePiece } from './renderer/gpu/layers/textLayout'
// PV-P4c-2: the span helpers, shared by the resolver, the layout and the inline
// editor so there is ONE implementation of "what is styled here".
export {
  applySpanStyle,
  contentPatch,
  isBoldWeight,
  normalizeSpans,
  remapSpans,
  spanRangeEvery,
  textRuns,
} from './elements/textSpans'
export type { SpanPatch, SpanStyle, TextRun } from './elements/textSpans'
export type { TextLayout, StageRect, ResolvedTextBox } from './renderer/gpu/layers/textLayout'
// Text measuring, DOM-free (PV-P2a): one interface, so layout, element frames
// and the resolver can each hold a measurer instead of a 2D context.
export { createCanvasMeasurer, measureContextFor, trackedWidth } from './renderer/gpu/layers/textMeasure'
export type { MeasureContext, TextMeasurer } from './renderer/gpu/layers/textMeasure'
// The box an element occupies (PV-P2): the overlay, the masks and the harness
// all measure through this one function.
export { elementFrameFor, textMaskFrame, shapeMaskFrame, freehandFrame } from './renderer/gpu/layers/elementFrame'
export type { FramedItem } from './renderer/gpu/layers/elementFrame'
// Freehand: the shared painter (PV-P2b) and the path geometry it places.
export { paintFreehand, freehandPaintSignature, freehandPlacement, freehandRestTransform } from './renderer/gpu/layers/freehandPaint'
export type { FreehandPlacement, Freehand2DContext } from './renderer/gpu/layers/freehandPaint'
export { pathBounds } from './renderer/gpu/layers/pathBounds'
export type { PathBox } from './renderer/gpu/layers/pathBounds'
export { walkPath } from './renderer/gpu/layers/pathLength'
export type { PathVisitor } from './renderer/gpu/layers/pathLength'

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

// --- Video byte cache (warming) ---
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

// --- Media: video frame producers ---
export type { VideoFrameProvider, VideoFrameProviderDeps } from './media/video'
export { createVideoFrameProvider, MockVideoFrameProvider, SyntheticVideoFrameProvider } from './media/video'

// --- Media: audio playback ---
export { AudioPlaybackController } from './media/audio/AudioPlaybackController'
export type { AudioPlaybackControllerOptions } from './media/audio/AudioPlaybackController'
export { defaultAudioResolver, cachedAudioResolver } from './media/audio/audioResolver'
export type { AudioResolver } from './media/audio/audioResolver'

// Audio mixer hooks (useAudioMixer / useMasterVolume / useTrackLevels) moved to
// @elah/react — they are React, and core is not.

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
  determineAssetHasAudio,
  hasAudioDetermined,
  probeHasAudio,
  scheduleThumbnailById,
  snapshotMediaLibrary,
  hydrateMediaLibrary,
  refreshMissingThumbnails,
  // LM-P1: local-media fingerprint and the large-source waveform gate.
  fingerprintBlob,
  FINGERPRINT_CHUNK_BYTES,
  LARGE_LOCAL_SOURCE_BYTES,
  shouldDecodeWaveform,
  // LM-P5: streamed waveform.
  shouldStreamAudio,
  computeStreamedWaveform,
} from './assets'
export type { FingerprintOptions } from './assets'
export { VECTOR_INLINE_MAX_CHARS, isVectorAsset, vectorOriginLine } from './assets'
export type {
  MediaLibrarySnapshotEntry,
  HydrateMediaLibraryOptions,
  HydrateMediaLibraryResult,
} from './assets'
export type {
  MediaAsset,
  MediaAssetAnalysis,
  MediaAssetTopObject,
  MediaAssetVector,
  MediaKind,
  DragMediaPayload,
  ImportFilesOptions,
  ImportFilesResult,
  ImportUrlOptions,
  ImportBlobOptions,
  SkippedImport,
  MediaLibraryState,
  MediaLibraryActions,
} from './assets'

// --- Stores (Ring 1 mirrors + Ring 2 UI state) — vanilla; see @elah/react ---
export { tracksStore } from './stores/tracks.store'
export type { TracksState, TracksActions } from './stores/tracks.store'
export { playbackStore } from './stores/playback.store'
export type { PlaybackState, PlaybackActions } from './stores/playback.store'
export { clipLoadStore } from './stores/clipLoad.store'
export { videoUploadProbe } from './renderer/gpu/layers/videoUploadProbe'
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
export type { CreateClipOptions, CreateCompoundOptions, ShapeClipMetadata, FreehandClipMetadata } from './elements/base'
// Compound clips (PV-P1): the factory, its length helper and the audio walk.
export { compoundLength, createCompoundClip, flattenAudioClips } from './elements/compound'
export type { CreateCompoundClipOptions, FlatAudioClip } from './elements/compound'
// Nest and unnest (PV-P1a-3): the pure edit, and the refusal it returns.
export { nestProject, unnestProject } from './elements/compound'
export type {
  CompoundEditError,
  CompoundEditErrorCode,
  CompoundEditResult,
  NestOptions,
  NestResult,
  UnnestResult,
} from './elements/compound'
export { createVideoClip } from './elements/video'
export { createAudioClip } from './elements/audio'
export { createTextClip } from './elements/text'
export { createImageClip } from './elements/image'
// PV-P8: the sequence clip factory and its cycle-length helper.
export { createSequenceClip, sequenceCycleFrames } from './elements/sequence'
export type { CreateSequenceClipOptions } from './elements/sequence'
export { createShapeClip } from './elements/shape'
export type { CreateShapeClipOptions } from './elements/shape'
export { createFreehandClip } from './elements/freehand'
export type { CreateFreehandClipOptions } from './elements/freehand'
// Freehand AUTHORING (PV-P2c): turn sampled pointer positions into the two
// fields a drawing commits. Pure and DOM-free, so the editor's overlay owns the
// gesture and this owns the geometry.
export {
  pointsToPathData,
  freehandFromDrag,
  FREEHAND_MIN_SAMPLE_PX,
  FREEHAND_PATH_PRECISION,
  FREEHAND_MAX_POINTS,
} from './elements/freehand'
export type { StagePoint, FreehandDraft } from './elements/freehand'
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

// --- Compound templates: four whole nested timelines, not one clip's style (PV-P1d) ---
export {
  COMPOUND_TEMPLATES,
  findCompoundTemplate,
  lowerThird,
  socialHandle,
  reelHook,
  ctaCard,
  compoundTemplateDuration,
  compoundTemplateRamp,
  COMPOUND_TEMPLATE_REFERENCE_WIDTH,
  COMPOUND_TEMPLATE_REFERENCE_HEIGHT,
  COMPOUND_TEMPLATE_DEFAULT_SECONDS,
  COMPOUND_TEMPLATE_MAX_RAMP_FRAMES,
  COMPOUND_TEMPLATE_MIN_ANIMATED_FRAMES,
} from './elements/compoundTemplates'
export type { CompoundTemplate, CompoundTemplateOptions } from './elements/compoundTemplates'

// --- Actions ---
export { splitClipAtPlayhead } from './actions/splitClipAtPlayhead'
export type { SplitAtPlayheadData } from './actions/splitClipAtPlayhead'
export { rippleDelete, rippleTrim, rippleEdgeTrim } from './actions/ripple'
export type { RippleDeleteData, RippleEdge, RippleEdgeTrimData } from './actions/ripple'
export type { ActionResult, ActionFailureReason } from './actions/types'

// --- Placement, magnetic mode, pro trims and links (PV-T1) ---
export {
  resolveMainTrackId,
  isMagneticMain,
  nearestCut,
  removeForMode,
  moveForMode,
  trimForMode,
} from './actions/placement'
export { rollEdit, slideClip, slipClip, slipBounds } from './actions/trimModes'
export { expandLinked, splitLinked } from './actions/links'
export { retimeCaptions, planCaptionRetime } from './actions/retimeCaptions'
export type { RetimePrev, CaptionRetimePatch, CaptionRetimePlan } from './actions/retimeCaptions'
export { detachClipAudio, reattachClipAudio, reattachCandidate, canReattachAudio } from './actions/detachAudio'
export type { DetachAudioData } from './actions/detachAudio'
export {
  ensureTrackOfKind,
  ensureVideoTrack,
  ensureAudioTrack,
  ensureElementsTrack,
  findFreeTrackAt,
} from './actions/tracks'
export type { TrackTarget, TrackTargetRefusal } from './actions/tracks'
export type { ClipPlacement, PlacementMode, PlaceOptions, PlacementFailure } from './visitor/place'
export type { PlaceClipsResult, RippleMainResult } from './editor/TimelineEngine'
export { timelineUiStore } from './stores/timelineUi.store'
export type { TimelineUiState, TimelineUiActions, TimelineTool } from './stores/timelineUi.store'

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

// --- Utilities ---
export { framesToTimecode, secondsToFrames, framesToSeconds, getTotalFrames, clipsOverlap } from './utils/frames'
export { generateId, withSeededIds, mulberry32, seededIdsActive } from './utils/id'
export { snapFrame, buildSnapPoints, resolveOverlapEdgeSnap, DEFAULT_OVERLAP_TOLERANCE } from './utils/snap'

// --- Timeline geometry (pure; shared by the timeline UI and non-DOM consumers) ---
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
export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec, ExportContainer, FrameSink } from './export'
export { sourceAwareFetch, sourceAwareAudioResolver } from './export'
export type { AssetBlobFetcher } from './export'
// REN-4: the browser-support gate the export UI asks before offering Export.
export { detectExportSupport, EXPORT_UNSUPPORTED_MESSAGE } from './export'
export type { ExportSupport, ExportSupportEnv, ExportSupportFeature } from './export'
// REN-5: codec probes (HEVC is offered only when EXPORT_OFFER_HEVC is true) and GIF limits.
export { probeVideoCodecSupport, ensureVideoCodecSupport, offeredVideoCodecs, EXPORT_OFFER_HEVC, GIF_DEFAULT_MAX_FPS, GIF_DEFAULT_MAX_SHORT_EDGE, GIF_MAX_FRAMES } from './export'
export type { IsConfigSupported, VideoConfigProbeInput } from './export'
// PV-P7b-1: a stored-ZIP writer shared with PV-P9a's PNG sequences, and a
// one-row-at-a-time variant renderer built on instantiate() + exportVideo().
export { zipStore, crc32 } from './export'
export type { ZipFile } from './export'
export { renderVariants } from './export'
export type { VariantRow, VariantProgress, RenderVariantsOptions, VariantResult } from './export'
// PV-P9a-1: export range (in/out) and the container/codec/transparency
// matrix, resolved before the worker is spawned.
export { resolveExportRange } from './export'
export { resilientCanvasSink } from './export/resilientSink'
export type { ResilientSinkOptions } from './export/resilientSink'
export type { ExportRangeMode, ExportFrameRange } from './export'
export { resolveExportFormat, webmAlphaExportSupported, ensureTransparencyGate, clearWebmAlphaExportCache } from './export'
export type { ResolvedExportFormat, AlphaGateDeps, AlphaGateResult } from './export'
// PV-P10a: the export audio mix — volume keyframes, track/master volume and
// solo, all following the range `resolveExportRange` resolved above.
export { renderAudioMix } from './export'
// Clip audio settings: mute, boost, fades and Enhance (preview and export share these).
export {
  readClipAudio,
  clipAudioGain,
  fadeFrames,
  hasAudioEnvelopeShape,
  activeEnhance,
  enhanceSignature,
  enhancePlan,
  dbGain,
  MAX_BOOST_DB,
  MAX_FADE_SEC,
  DEFAULT_ENHANCE,
} from './audio/clipAudio'
export type { EnhanceStage } from './audio/clipAudio'
export { buildEnhanceChain, disconnectEnhanceChain, latencyLead } from './media/audio/enhanceChain'
export type { EnhanceChain } from './media/audio/enhanceChain'
export {
  ensureDenoiseWorklet,
  DENOISE_WORKLET_SOURCE,
  DENOISE_LATENCY_SAMPLES,
  DENOISE_PROCESSOR_NAME,
} from './media/audio/denoiseWorklet'
export {
  fullMixRange,
  audibleSpan,
  scheduleAudioClip,
  gainAutomation,
  applyGainEvents,
  isAudioTrackAudible,
  GAIN_EPSILON,
} from './export'
export type {
  AudioMixRange,
  GainEvent,
  AudioClipSchedule,
  GainParamLike,
  GainAutomationAncestry,
} from './export'

/**
 * The export worker's per-frame paint, without the codec.
 *
 * Exported so the export output can be compared against the preview WITHOUT
 * muxing an MP4 and decoding it back — see `/dev/compound`, which is where the
 * preview-vs-export parity row for compounds is measured. It takes the resolved
 * scene and the decoded media as arguments, so a caller supplies them; a real
 * export gets them from the frame loop's decoders.
 *
 * Safe to import outside a worker: the module installs its `onmessage` entry
 * point only inside a real WorkerGlobalScope.
 */
export { renderFrame } from './export/ExportWorker'

// The editor context (EditorContext / useEditor / useTimelineEngine /
// usePlaybackEngine) is React, so it lives in @elah/react.

// --- Debug/trace ---
export { installTraceGlobal, trace, traceEnabled } from './debug/trace'
export type { TraceChannel } from './debug/trace'
export { PerfSummary } from './debug/PerfSummary'

// --- Vector math (PV-P6b-1): only the two symbols web importers need; the
// rest of pathOps/color/place stays internal to core for the SVG/Lottie
// importers built directly on top of it (PV-P6b-2/3, PV-P6c-*). ---
export { fitTransform, VECTOR_IMPORT_FIT } from './vector/place'

// --- SVG import (PV-P6b-2): shapes, groups, use, the skip list and the
// fidelity fixtures. `SvgNode` is DOM-free; `svgToProject`'s own converter
// internals (style.ts, the walk) stay internal to core. ---
export { svgToProject } from './vector/svg/svgToProject'
export { SVG_FIDELITY_FIXTURES } from './vector/svg/fixtures'
export type { SvgFixture } from './vector/svg/fixtures'
export type { SvgNode, SvgImportOptions, SvgImportResult, SvgSkip } from './vector/svg/types'
export {
  compoundClipFor,
  importedVectorClip,
  projectFromClips,
  maxShapesForStage,
  VECTOR_TEXTURE_BUDGET_BYTES,
  COMPOUND_TRACK_KIND,
} from './vector/importClip'

// --- Lottie import (PV-P6c-2): the importer entry point and its fixtures.
// The pure sampling/transform/shape modules (PV-P6c-1) stay internal to
// core, same as SVG's. ---
export { lottieToClip } from './vector/lottie/convert'
export type { LottieImportOptions, LottieImportReport, LottieImportResult, LottieSkip } from './vector/lottie/convert'
export { LOTTIE_FIXTURES } from './vector/lottie/fixtures'
export type { LottieFixture } from './vector/lottie/fixtures'
export type { LottieJson } from './vector/lottie/types'


// --- Media capability probes (PV-P8a): whether this scope can decode
// animated images and round-trip a transparent WebM, measured before any
// rendering code exists. ---
export { probeImageDecode, probeWebmAlpha, probeScope, PROBED_IMAGE_TYPES } from './media/capabilities'
export type { ProbedImageType, ImageDecodeSupport, WebmAlphaSupport, ScopeCapabilities } from './media/capabilities'
export { runCapabilityProbe } from './media/runCapabilityProbe'
export type { CapabilityReport } from './media/runCapabilityProbe'

// --- Subpath entries (CONV-7) ---
// The experimental layers are NOT exported from this root. Import them from their
// own entries: `/spec` (VideoSpec compiler, components, systems, vocabulary,
// component instances), `/html` (HTML/CSS scene subset), `/ops` (project
// describe and edit ops) and `/icons` (the vendored icon set).

