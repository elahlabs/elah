/**
 * All shared types for @elah/editor.
 * Time is always represented as integer frame counts — never float seconds.
 * FPS is a project-level constant stored in Project.fps.
 */

/** An exact frame position. Always a non-negative integer. */
export type FrameCount = number

export type TextAnimationKind = 'fade'

/**
 * Entry/exit animation descriptor for text clips.
 * Resolved into opacity inside resolveTimeline — both renderers consume it
 * via the existing opacity field, so parity is automatic.
 */
export interface TextAnimation {
  in?: TextAnimationKind
  out?: TextAnimationKind
  /** Duration of the in/out ramp in frames (shared by both directions) */
  durationFrames: number
}

/**
 * Spatial transform applied to a clip at render time.
 * All values are normalized so they remain resolution-independent.
 */
export interface Transform {
  /** Horizontal position, normalized 0..1 relative to stage width */
  x: number
  /** Vertical position, normalized 0..1 relative to stage height */
  y: number
  /** Uniform scale factor; 1 = native size */
  scale: number
  /** Rotation in radians; positive = clockwise */
  rotation: number
  /** Anchor point within the clip's own bounding box, normalized 0..1 */
  anchor: { x: number; y: number }
}

export type ClipType = 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand'

/** Variant of the 'shape' clip — determines which SVG primitive is rendered. */
export type ShapeVariant = 'rect' | 'circle' | 'triangle'

export type TrackKind = 'video' | 'audio' | 'elements'

/**
 * A single clip placed on the timeline.
 * startFrame + durationFrames define its position and length on the timeline.
 * sourceStartFrame + sourceDurationFrames define the trim window into the source.
 * Use `transform` to position / scale / rotate the clip in the stage coordinate space.
 */
export interface Clip {
  id: string
  trackId: string
  type: ClipType
  name: string

  /** Position on the timeline (frame where this clip starts) */
  startFrame: FrameCount
  /** How many frames this clip occupies on the timeline */
  durationFrames: FrameCount

  /** Trim in-point into the source asset */
  sourceStartFrame: FrameCount
  /** Length of the source asset (used for trim constraints) */
  sourceDurationFrames: FrameCount

  /** Source URL for video / audio / image clips */
  src?: string
  /**
   * Optional reference to a MediaAsset in the MediaLibrary. When set, the
   * renderer prefers this lookup over `src`. Both can coexist during
   * the migration to an assetId-only model.
   */
  assetId?: string
  /** Text content for text clips */
  content?: string

  // --- Text style (text clips only; all optional, the TextLayer applies defaults) ---
  /** Glyph size in stage-space pixels */
  fontSize?: number
  /** CSS color string for the glyphs */
  color?: string
  /** CSS font-family */
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'

  // --- Shape style (shape clips only) ---
  /** Which SVG primitive to render */
  shapeKind?: ShapeVariant
  /** CSS color string for the shape fill */
  shapeFill?: string
  /** CSS color string for the shape stroke */
  shapeStroke?: string
  /** Stroke width in stage-space pixels */
  shapeStrokeWidth?: number

  // --- Freehand style (freehand clips only) ---
  /** SVG path data string (the 'd' attribute value) */
  pathData?: string
  /** CSS color string for the stroke */
  strokeColor?: string
  /** Stroke width in stage-space pixels */
  strokeWidth?: number

  volume?: number // 0 – 1
  opacity?: number // 0 – 1
  locked?: boolean
  disabled?: boolean
  /** Optional spatial transform; undefined means the renderer applies its own default */
  transform?: Transform
  /** Entry/exit animation for text clips */
  textAnimation?: TextAnimation
  /** Entry/exit animation for shape clips */
  shapeAnimation?: TextAnimation
}

/** A track lane that holds clips */
export interface Track {
  id: string
  name: string
  kind: TrackKind
  /** Render order: lower = closer to top of timeline */
  order: number
  /** Height in pixels */
  height: number
  locked: boolean
  disabled: boolean
  muted: boolean
  solo: boolean
  /** Linear gain multiplier for the track, 0..2. Default 1 (unity). */
  volume?: number
}

/**
 * The full project state. This is the engine's source of truth.
 * Passed to Immer for structural-sharing mutations.
 * `stage` defines the output canvas dimensions; defaults to 1080×1920 (portrait).
 */
export interface Project {
  id: string
  /** Frames per second — integer (e.g. 24, 30, 60) */
  fps: number
  /** Output canvas dimensions in pixels */
  stage: { width: number; height: number }
  tracks: Track[]
  /** clips indexed by trackId, sorted by startFrame */
  clips: Record<string, Clip[]>
  transitions: Transition[]
  version: number
  /** Linear master gain for all audio output, 0..2. Default 1 (unity). */
  masterVolume?: number
}

/** A track to create up-front when the engine is constructed. */
export interface InitialTrackConfig {
  kind: TrackKind
  /** Display name; falls back to a kind-based default when omitted. */
  name?: string
}

/** Config passed when creating a TimelineEngine instance */
export interface TimelineConfig {
  fps: number
  /** Output canvas dimensions; defaults to 1080×1920 (portrait) */
  stage?: { width: number; height: number }
  /** Default height for new tracks in pixels */
  defaultTrackHeight?: number
  /** Max undo steps kept in history */
  maxHistorySize?: number
  /**
   * Tracks created in the empty project before any user edits. When omitted,
   * a single "Track 1" video track is created (backwards-compatible default).
   * Pass an explicit list for a fixed-lane editor (e.g. video / audio / text).
   */
  initialTracks?: InitialTrackConfig[]
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type TransitionKind = 'fade' | 'slide' | 'wipe'
export type TransitionEasing = 'linear' | 'ease-in' | 'ease-out'
export type TransitionDirection = 'left' | 'right' | 'up' | 'down'

/**
 * A transition between two adjacent clips on the same track.
 * startFrame marks where the transition begins (before the cut point).
 * The cut is at startFrame + durationFrames / 2 (centered).
 * Both clips are rendered simultaneously during [startFrame, startFrame + durationFrames).
 *
 * Adding a new transition kind = handle it in resolveTimeline (opacity/scene) and
 * TransitionOverlay (CSS). Everything else is plug-and-play.
 */
export interface Transition {
  id: string
  kind: TransitionKind
  fromClipId: string
  toClipId: string
  trackId: string
  /** Frame where the transition begins. = toClip.startFrame - durationFrames / 2 */
  startFrame: FrameCount
  durationFrames: FrameCount
  direction?: TransitionDirection
  easing?: TransitionEasing
}

/** Events emitted by TimelineEngine */
export type EngineEvent =
  | 'change'
  | 'track:added'
  | 'track:removed'
  | 'clip:added'
  | 'clip:removed'
  | 'clip:updated'
  | 'clip:split'
  | 'transition:added'
  | 'transition:removed'
  | 'history:change'

export type EngineEventPayload = {
  change: Project
  'track:added': Track
  'track:removed': string
  'clip:added': Clip
  'clip:removed': { clipId: string; trackId: string }
  'clip:updated': Clip
  'clip:split': { leftId: string; rightId: string; trackId: string }
  'transition:added': Transition
  'transition:removed': string
  'history:change': { canUndo: boolean; canRedo: boolean }
}
