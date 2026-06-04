/**
 * All shared types for @elah/editor.
 * Time is always represented as integer frame counts — never float seconds.
 * FPS is a project-level constant stored in Project.fps.
 */

/** An exact frame position. Always a non-negative integer. */
export type FrameCount = number

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

export type ClipType = 'video' | 'audio' | 'text' | 'image'

export type TrackKind = 'video' | 'audio' | 'text'

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

  volume?: number   // 0 – 1
  opacity?: number  // 0 – 1
  locked?: boolean
  disabled?: boolean
  /** Optional spatial transform; undefined means the renderer applies its own default */
  transform?: Transform
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
  version: number
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
  | 'history:change'

export type EngineEventPayload = {
  change: Project
  'track:added': Track
  'track:removed': string
  'clip:added': Clip
  'clip:removed': { clipId: string; trackId: string }
  'clip:updated': Clip
  'clip:split': { leftId: string; rightId: string; trackId: string }
  'history:change': { canUndo: boolean; canRedo: boolean }
}
