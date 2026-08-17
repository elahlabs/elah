import type {
  AnimationChannel,
  Clip,
  ClipType,
  ShapeVariant,
  TextAnimation,
  Transform,
} from '../types'
import { generateId } from '../utils/id'
import { toFrame } from '../utils/frames'
import { normalizeAnimationChannels, normalizeTextAnimation } from '../animation/normalize'

// ---------------------------------------------------------------------------
// Per-type option shapes (discriminated union)
// ---------------------------------------------------------------------------

interface BaseCreateOptions {
  trackId: string
  name?: string
  startFrame: number
  durationFrames: number
  volume?: number
  opacity?: number
  transform?: Transform
  /** Clip-relative, frame-based property channels. */
  animations?: AnimationChannel[]
}

interface CreateVideoOptions extends BaseCreateOptions {
  type: 'video'
  src: string
  assetId?: string
}

interface CreateAudioOptions extends BaseCreateOptions {
  type: 'audio'
  src: string
  assetId?: string
}

interface CreateImageOptions extends BaseCreateOptions {
  type: 'image'
  src: string
  assetId?: string
}

/** Style + content for a text clip. Required when type === 'text'. */
export interface TextClipMetadata {
  content: string
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
}

interface CreateTextOptions extends BaseCreateOptions {
  type: 'text'
  /** Required for text clips — carries content + style. */
  text: TextClipMetadata
  /** Optional text entrance, exit, and loop presets. */
  textAnimation?: TextAnimation
}

/** Style metadata for a shape clip. */
export interface ShapeClipMetadata {
  shapeKind: ShapeVariant
  shapeFill?: string
  shapeStroke?: string
  shapeStrokeWidth?: number
}

interface CreateShapeOptions extends BaseCreateOptions {
  type: 'shape'
  shape: ShapeClipMetadata
}

/** Style metadata for a freehand clip. */
export interface FreehandClipMetadata {
  pathData?: string
  strokeColor?: string
  strokeWidth?: number
}

interface CreateFreehandOptions extends BaseCreateOptions {
  type: 'freehand'
  freehand?: FreehandClipMetadata
}

/**
 * Discriminated union of clip creation options.
 * TypeScript narrows the correct shape based on `type`, so callers get
 * errors when they pass video-only fields to a text clip and vice versa.
 */
export type CreateClipOptions =
  | CreateVideoOptions
  | CreateAudioOptions
  | CreateImageOptions
  | CreateTextOptions
  | CreateShapeOptions
  | CreateFreehandOptions

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function for creating a new Clip from typed creation options.
 * All values are normalized: frames are rounded to integers, and defaults
 * are applied for optional fields.
 */
export function createClip(options: CreateClipOptions): Clip {
  const durationFrames = Math.max(1, toFrame(options.durationFrames))

  const base = {
    id: generateId(),
    trackId: options.trackId,
    type: options.type as ClipType,
    name: options.name ?? options.type,
    startFrame: toFrame(options.startFrame),
    durationFrames,
    sourceStartFrame: 0,
    sourceDurationFrames: durationFrames,
    volume: options.volume ?? 1,
    opacity: options.opacity ?? 1,
    locked: false,
    disabled: false,
    ...(options.transform ? { transform: options.transform } : {}),
    ...(options.animations ? { animations: normalizeAnimationChannels(options.animations) } : {}),
  }

  if (options.type === 'text') {
    const { text } = options
    return {
      ...base,
      type: 'text',
      content: text.content,
      ...(text.fontSize !== undefined ? { fontSize: text.fontSize } : {}),
      ...(text.color !== undefined ? { color: text.color } : {}),
      ...(text.fontFamily !== undefined ? { fontFamily: text.fontFamily } : {}),
      ...(text.fontWeight !== undefined ? { fontWeight: text.fontWeight } : {}),
      ...(text.textAlign !== undefined ? { textAlign: text.textAlign } : {}),
      ...(options.textAnimation ? { textAnimation: normalizeTextAnimation(options.textAnimation) } : {}),
    }
  }

  if (options.type === 'shape') {
    const { shape } = options
    return {
      ...base,
      type: 'shape',
      shapeKind: shape.shapeKind,
      ...(shape.shapeFill !== undefined ? { shapeFill: shape.shapeFill } : {}),
      ...(shape.shapeStroke !== undefined ? { shapeStroke: shape.shapeStroke } : {}),
      ...(shape.shapeStrokeWidth !== undefined ? { shapeStrokeWidth: shape.shapeStrokeWidth } : {}),
    }
  }

  if (options.type === 'freehand') {
    const freehand = options.freehand ?? {}
    return {
      ...base,
      type: 'freehand',
      ...(freehand.pathData !== undefined ? { pathData: freehand.pathData } : {}),
      ...(freehand.strokeColor !== undefined ? { strokeColor: freehand.strokeColor } : {}),
      ...(freehand.strokeWidth !== undefined ? { strokeWidth: freehand.strokeWidth } : {}),
    }
  }

  return {
    ...base,
    type: options.type,
    src: options.src,
    assetId: options.assetId,
  }
}
