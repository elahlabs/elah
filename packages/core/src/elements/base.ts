import type {
  Clip,
  ClipCompound,
  ClipGenerator,
  ClipSequence,
  ClipType,
  FontWeight,
  Paint,
  ShapeArrowHead,
  ShapeFillRule,
  ShapeVariant,
  ShapeViewBox,
  ShapeStrokeCap,
  ShapeStrokeJoin,
  ShapeStrokeAlign,
  Transform,
} from '../types'
import { generateId } from '../utils/id'
import { getTotalFrames, toFrame } from '../utils/frames'

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
  /**
   * Widened to `FontWeight` in PV-P4b. This is the change that keeps
   * `packages/timeline/src/commands.ts` compiling WITHOUT being edited: its
   * `buildPasteOptions` copies `clip.fontWeight` in here, and that file is on
   * PV-P4b's Forbidden list. A keyword is still assignable, so every existing
   * caller is unaffected.
   */
  fontWeight?: FontWeight
  textAlign?: 'left' | 'center' | 'right'
}

interface CreateTextOptions extends BaseCreateOptions {
  type: 'text'
  /** Required for text clips — carries content + style. */
  text: TextClipMetadata
}

/** Style metadata for a shape clip. */
export interface ShapeClipMetadata {
  shapeKind: ShapeVariant
  shapeFill?: string
  shapeStroke?: string
  shapeStrokeWidth?: number
  /** `rect` only: 0..0.5 of the shorter box side. */
  cornerRadius?: number
  /** `polygon` only: vertex count (3..12). */
  shapeSides?: number
  /** `polygon` only: present = a star of 2N vertices. */
  shapeInnerRatio?: number
  /** `line` only: arrowhead placement. */
  shapeArrowHead?: ShapeArrowHead
  /** `path` only: SVG path data. */
  shapePath?: string
  /** `path` only: the user space the path is authored in. */
  shapeViewBox?: ShapeViewBox
  /** `path` only: fill rule. */
  shapeFillRule?: ShapeFillRule
  /** Gradient (or solid) fill (PV-P6a). See `Clip.shapeFillPaint`. */
  shapeFillPaint?: Paint
  /** Gradient (or solid) stroke (PV-P6a). See `Clip.shapeStrokePaint`. */
  shapeStrokePaint?: Paint
  /** See `Clip.shapeStrokeDash`. */
  shapeStrokeDash?: number[]
  /** See `Clip.shapeStrokeDashOffset`. */
  shapeStrokeDashOffset?: number
  /** See `Clip.shapeStrokeCap`. */
  shapeStrokeCap?: ShapeStrokeCap
  /** See `Clip.shapeStrokeJoin`. */
  shapeStrokeJoin?: ShapeStrokeJoin
  /** See `Clip.shapeStrokeAlign`. */
  shapeStrokeAlign?: ShapeStrokeAlign
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

/** An adjustment clip (EDX-P7): effects only, no picture of its own. */
interface CreateAdjustmentOptions extends BaseCreateOptions {
  type: 'adjustment'
}

/** A generator clip (EDX-P9): paints particles, light, backgrounds or data. */
interface CreateGeneratorOptions extends BaseCreateOptions {
  type: 'generator'
  generator: ClipGenerator
}

/**
 * Discriminated union of clip creation options.
 * TypeScript narrows the correct shape based on `type`, so callers get
 * errors when they pass video-only fields to a text clip and vice versa.
 */
/** A compound clip (PV-P1): a nested timeline. */
export interface CreateCompoundOptions extends BaseCreateOptions {
  type: 'compound'
  compound: ClipCompound
}

/** A sequence clip (PV-P8): an animated image or a numbered image sequence. */
interface CreateSequenceOptions extends BaseCreateOptions {
  type: 'sequence'
  src?: string
  assetId?: string
  sequence: ClipSequence
}

export type CreateClipOptions =
  | CreateVideoOptions
  | CreateAudioOptions
  | CreateImageOptions
  | CreateTextOptions
  | CreateShapeOptions
  | CreateFreehandOptions
  | CreateAdjustmentOptions
  | CreateGeneratorOptions
  | CreateCompoundOptions
  | CreateSequenceOptions

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
  }

  if (options.type === 'text') {
    const { text } = options
    return {
      ...base,
      type: 'text',
      content: text.content,
      // PV-P2: a new text clip is laid out from the start under the model whose
      // anchor and stretch mean what an image's do. A stored document never
      // gains the field, so every existing clip keeps the legacy placement.
      transformModel: 'v2',
      ...(text.fontSize !== undefined ? { fontSize: text.fontSize } : {}),
      ...(text.color !== undefined ? { color: text.color } : {}),
      ...(text.fontFamily !== undefined ? { fontFamily: text.fontFamily } : {}),
      ...(text.fontWeight !== undefined ? { fontWeight: text.fontWeight } : {}),
      ...(text.textAlign !== undefined ? { textAlign: text.textAlign } : {}),
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
      ...(shape.cornerRadius !== undefined ? { cornerRadius: shape.cornerRadius } : {}),
      ...(shape.shapeSides !== undefined ? { shapeSides: shape.shapeSides } : {}),
      ...(shape.shapeInnerRatio !== undefined ? { shapeInnerRatio: shape.shapeInnerRatio } : {}),
      ...(shape.shapeArrowHead !== undefined ? { shapeArrowHead: shape.shapeArrowHead } : {}),
      ...(shape.shapePath !== undefined ? { shapePath: shape.shapePath } : {}),
      ...(shape.shapeViewBox !== undefined ? { shapeViewBox: shape.shapeViewBox } : {}),
      ...(shape.shapeFillRule !== undefined ? { shapeFillRule: shape.shapeFillRule } : {}),
      ...(shape.shapeFillPaint !== undefined ? { shapeFillPaint: shape.shapeFillPaint } : {}),
      ...(shape.shapeStrokePaint !== undefined ? { shapeStrokePaint: shape.shapeStrokePaint } : {}),
      ...(shape.shapeStrokeDash !== undefined ? { shapeStrokeDash: shape.shapeStrokeDash } : {}),
      ...(shape.shapeStrokeDashOffset !== undefined ? { shapeStrokeDashOffset: shape.shapeStrokeDashOffset } : {}),
      ...(shape.shapeStrokeCap !== undefined ? { shapeStrokeCap: shape.shapeStrokeCap } : {}),
      ...(shape.shapeStrokeJoin !== undefined ? { shapeStrokeJoin: shape.shapeStrokeJoin } : {}),
      ...(shape.shapeStrokeAlign !== undefined ? { shapeStrokeAlign: shape.shapeStrokeAlign } : {}),
    }
  }

  if (options.type === 'freehand') {
    const freehand = options.freehand ?? {}
    return {
      ...base,
      type: 'freehand',
      // PV-P2: a new drawing is placed through its transform from the start. A
      // stored document never gains the field, so every existing drawing keeps
      // drawing exactly where it was drawn.
      transformModel: 'v2',
      ...(freehand.pathData !== undefined ? { pathData: freehand.pathData } : {}),
      ...(freehand.strokeColor !== undefined ? { strokeColor: freehand.strokeColor } : {}),
      ...(freehand.strokeWidth !== undefined ? { strokeWidth: freehand.strokeWidth } : {}),
    }
  }

  if (options.type === 'adjustment') {
    return { ...base, type: 'adjustment' }
  }

  if (options.type === 'compound') {
    // The nested timeline is the compound's "media": its length is the
    // source length, so trims and split halves stop at its end (PV-T5-1).
    const length = Math.max(1, getTotalFrames(options.compound.project.clips))
    return {
      ...base,
      type: 'compound',
      compound: options.compound,
      sourceDurationFrames: length,
      assetFrames: length,
    }
  }

  if (options.type === 'generator') {
    return { ...base, type: 'generator', generator: options.generator }
  }

  if (options.type === 'sequence') {
    return {
      ...base,
      type: 'sequence',
      ...(options.src !== undefined ? { src: options.src } : {}),
      ...(options.assetId !== undefined ? { assetId: options.assetId } : {}),
      sequence: options.sequence,
    }
  }

  return {
    ...base,
    type: options.type,
    src: options.src,
    assetId: options.assetId,
  }
}
