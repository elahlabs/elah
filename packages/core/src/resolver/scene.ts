import type { ResolvedEffect, ResolvedMatte } from '../effects/resolveEffects'
import type { ExpressionError } from './expr/scope'
import type {
  ClipAudioEnhance,
  CaptionMode,
  CaptionWord,
  TextAnimator,
  TextOutline,
  TextShadow,
  TextDecoration,
  TextBox,
  FontStyle,
  Paint,
  TextSpan,
  FontWeight,
  BlendMode,
  ClipMask,
  SequenceKind,
  ShapeArrowHead,
  ShapeFillRule,
  ShapeVariant,
  ShapeViewBox,
  ShapeStrokeCap,
  ShapeStrokeJoin,
  ShapeStrokeAlign,
  Transform,
  TransitionKind,
  TransitionDirection,
} from '../types'

/**
 * Scene — the output type of resolveTimeline().
 *
 * Describes exactly what is visible and audible at a single frame.
 * The renderer consumes ONLY this object — it never reads Project directly.
 *
 * Array ordering: index 0 = bottom (back) layer, last index = top (front) layer.
 * Renderers draw in forward iteration order so the last element wins visually.
 *
 * This structure is intentionally minimal today but shaped to support:
 * - transitions (reserved array, types TBD)
 * - effects / filters (`effects`, `blend`, `mask`, `matte` on ActiveClipBase)
 * - WebGL/WebGPU (typed array of draw commands, same Scene as input)
 * - WASM export pipelines (pure data, no DOM references)
 */

export interface ActiveClipBase {
  id: string
  trackId: string
  name: string
  /**
   * The source-asset frame that corresponds to the current playback position.
   * = (currentFrame - clip.startFrame) + clip.sourceStartFrame
   * Renderers use this to seek the underlying media element.
   */
  sourceFrame: number
  /** 0–1 opacity for compositing */
  opacity: number
  /**
   * Visual stacking priority: higher = closer to the viewer (front / on top).
   * Computed from track.order so CSS / canvas conventions hold: render in
   * ascending order and the last (highest zIndex) element wins.
   */
  zIndex: number
  /** Spatial transform from the source clip; undefined means the renderer applies its own default */
  transform?: Transform
  /**
   * Compositing, resolved for this frame (effects/resolveEffects.ts). Each is
   * present only when the clip uses it, so an unaffected clip's object is
   * exactly what it was before effects existed. Rendered from EDX-P2 on.
   */
  /** Enabled, known effects in stack order, params sampled and clamped. */
  effects?: ResolvedEffect[]
  /** A non-normal blend mode. */
  blend?: BlendMode
  /** The mask with `mask.*` keys applied. */
  mask?: ClipMask
  /** Track matte reference; the renderer looks the source clip up by id. */
  matte?: ResolvedMatte
}

export interface ActiveVideoClip extends ActiveClipBase {
  type: 'video'
  src: string
  /** Effective volume after track mute is applied. 0–1. */
  volume: number
  /** Rounded-corner mask, 0..0.5 fraction of the shorter rendered side. */
  cornerRadius?: number
  /** Source-space crop window, normalized 0..1, origin top-left. Undefined = full frame. */
  crop?: { x: number; y: number; width: number; height: number }
}

export interface ActiveAudioClip extends ActiveClipBase {
  type: 'audio'
  src: string
  /** Effective volume after track mute is applied. 0–1. */
  volume: number
  /**
   * The clip's playback speed (`Clip.speed`), multiplied into the transport
   * rate by the audio player so preview agrees with the export mix. Absent = 1.
   */
  speed?: number
  /**
   * The clip's Enhance (`Clip.audio.enhance`) when it does anything. The
   * player builds the same chain the export mix does (enhanceChain.ts).
   */
  enhance?: ClipAudioEnhance
}

/** Suffix of the scene audio id synthesised for a video clip's embedded sound. */
export const EMBEDDED_AUDIO_SUFFIX = '#audio'

/**
 * The scene audio id of a merged video clip's own sound (`Clip.embeddedAudio`).
 * Namespaced like `hoistCompoundAudio`'s `${compound}/${clip}` ids so it can
 * never collide with a real clip id.
 */
export function embeddedAudioId(clipId: string): string {
  return clipId + EMBEDDED_AUDIO_SUFFIX
}

/**
 * Inverse of `embeddedAudioId`: the clip id behind a scene audio id, or the id
 * unchanged when it is not an embedded-audio id. Works on hoisted compound ids
 * too (`compound/clip#audio` -> `compound/clip`).
 */
export function clipIdOfSceneAudio(sceneId: string): string {
  return sceneId.endsWith(EMBEDDED_AUDIO_SUFFIX) ? sceneId.slice(0, -EMBEDDED_AUDIO_SUFFIX.length) : sceneId
}

export interface ActiveTextClip extends ActiveClipBase {
  type: 'text'
  content: string
  /** Glyph size in stage-space pixels. Undefined → TextLayer default. */
  fontSize?: number
  /** CSS color string. Undefined → TextLayer default. */
  color?: string
  /** CSS font-family. Undefined → TextLayer default. */
  fontFamily?: string
  /** Bundled font id; see Clip.fontId. Undefined → `fontFamily` as before. */
  fontId?: string
  fontWeight?: FontWeight
  /** PV-P4b: 'italic' paints the italic face or a synthesised oblique. Undefined = normal. */
  fontStyle?: FontStyle
  textAlign?: 'left' | 'center' | 'right'
  /** CSS color string for the box painted behind the glyphs. Undefined = no background. */
  backgroundColor?: string
  /** Opacity of `backgroundColor`, 0–1. Undefined → TextLayer default (1). */
  backgroundOpacity?: number
  /** Space in stage-space pixels between the glyphs and the background/border box. */
  padding?: number
  /** Corner radius of the background/border box, in stage-space pixels. */
  borderRadius?: number
  /** Stroke width of the box border, in stage-space pixels. 0/undefined = no border. */
  borderWidth?: number
  /** CSS color string for the box border. */
  borderColor?: string
  /** EDX-P8 text styling and animation; see Clip. */
  textOutline?: TextOutline
  textShadow?: TextShadow
  /** MC-1d: shadow of the background box; see `Clip.shadow`. */
  shadow?: TextShadow
  /** MC-1d: line through / under every text line; see `Clip.textDecoration`. */
  textDecoration?: TextDecoration
  /** Glyph fill; see Clip.textFill. Undefined = the clip's solid `color`. */
  textFill?: Paint
  /** Styled runs; see Clip.spans. Undefined/empty = one style for the whole text. */
  spans?: TextSpan[]
  textAnimator?: TextAnimator
  /** MOT-5: scramble state at this frame; `charset` is already the literal glyph pool. Absent = plain text. */
  scramble?: { progress: number; charset: string; seed: number; changeEvery: number; preserve: 'spaces' | 'none' }
  words?: CaptionWord[]
  captionMode?: CaptionMode
  captionHighlight?: string
  /**
   * Clip-local frame, present only when the text changes over time
   * (an animator or timed captions) — so static text still paints once.
   */
  localFrame?: number
  /**
   * PV-P2: 'v2' means `transform` acts on the padded box as it does for an
   * image. Absent = the legacy model, where x/y is the block centre and
   * anchor/scaleX/scaleY are ignored.
   */
  transformModel?: 'v2'
  /**
   * PV-P3a: the clip's text box. Absent = the legacy block, which is the default
   * everywhere and which the resolver never writes.
   */
  textBox?: TextBox
}

export interface ActiveImageClip extends ActiveClipBase {
  type: 'image'
  src: string
  /** Rounded-corner mask, 0..0.5 fraction of the shorter rendered side. */
  cornerRadius?: number
  /** Source-space crop window, normalized 0..1, origin top-left. Undefined = full frame. */
  crop?: { x: number; y: number; width: number; height: number }
}

export interface ActiveShapeClip extends ActiveClipBase {
  type: 'shape'
  /** Draw-on (EDX-P9): the visible stretch of the outline, 0..1. Absent = all of it. */
  shapeDraw?: { start: number; end: number }
  shapeKind: ShapeVariant
  shapeFill: string
  shapeStroke: string
  shapeStrokeWidth: number
  /**
   * `rect` only: corner radius as a fraction 0..0.5 of the shorter box side.
   * The same field (and the same keyframe channel) video/image clips use.
   */
  cornerRadius?: number
  /** `polygon` only: vertex count. Undefined → the painter's default. */
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
  /** MC-1d: fill shadow; see `Clip.shadow`. */
  shadow?: TextShadow
  /** MC-1d: per-corner radii of a `rect`; see `Clip.cornerRadii`. */
  cornerRadii?: [number, number, number, number]
}

export interface ActiveFreehandClip extends ActiveClipBase {
  type: 'freehand'
  pathData: string
  strokeColor: string
  strokeWidth: number
  /**
   * PV-P2: 'v2' means `transform` places, scales, stretches and rotates the
   * drawing's own box - the bounds of its path - as it does for an image.
   * Absent = the legacy model, where the transform is not read at all and the
   * drawing stays where it was drawn.
   */
  transformModel?: 'v2'
}

/**
 * A generator clip (EDX-P9): painted from its kind, params and time by
 * `generatorPaint` — the same painter in preview and export.
 */
export interface ActiveGeneratorClip extends ActiveClipBase {
  type: 'generator'
  kind: string
  /** Clamped params with any `gen.*` keys applied for this frame. */
  params: Record<string, number | string | boolean>
  seed: number
  /** Frame within the clip (0 = first). */
  localFrame: number
  durationFrames: number
  fps: number
  /** Placed generators (counter, charts) only. */
  transform?: Transform
}

/**
 * An adjustment clip (EDX-P7): its effects, mask, blend and opacity run on
 * the composite of everything below its zIndex.
 */
export interface ActiveAdjustmentClip extends ActiveClipBase {
  type: 'adjustment'
}

/**
 * A roto mask frame to draw over a video clip for review (`Clip.roto`).
 *
 * Derived from the resolved `ActiveVideoClip` so it always shares that clip's
 * source frame, transform and crop — the mask lands pixel-for-pixel on the
 * video, including through speed changes and transitions.
 */
export interface ActiveRotoMask {
  /** `${clipId}:roto` — distinct from the video's own id in the render graph. */
  id: string
  clipId: string
  trackId: string
  /** Mask frame index, clamped to 0..frameCount-1. */
  sourceFrame: number
  /** Contains a literal `{frame}` placeholder. */
  frameUrlTemplate: string
  frameCount: number
  width: number
  height: number
  mode: 'overlay' | 'matte'
  /** Overlay tint as linear 0..1 RGB. */
  color: [number, number, number]
  /** Overlay strength 0..1 (already multiplied by the clip's opacity). */
  opacity: number
  /** Directly above its video, below anything that was above the video. */
  zIndex: number
  transform?: Transform
  crop?: { x: number; y: number; width: number; height: number }
}

/**
 * A transition that is active at the current frame, ready for renderers.
 *
 * `t` is the eased progress through the transition window (0 = start, 1 = end).
 *
 * The GPU renderer draws each side of the pair into its own target and
 * composites them with the transition shader (`renderer/gpu/transitions.ts`,
 * one `uKind` switch); see `RenderGraph`. The Canvas2D export fallback draws
 * a frozen snapshot of fromClip at globalAlpha=1-t, so only kinds marked
 * `canvas2d` in `transitions/registry.ts` have a fallback.
 *
 * Adding a new kind = one registry entry plus one shader branch.
 */
export interface ActiveTransition {
  id: string
  kind: TransitionKind
  /** Eased progress 0→1 through the transition window. */
  t: number
  direction?: TransitionDirection
  /** Clip id of the outgoing clip. */
  fromClipId: string
  /** Clip id of the incoming clip. Renderers composite the pair with `kind` at `t`. */
  toClipId: string
}

/**
 * A fully-resolved snapshot of the project at a single frame.
 *
 * All arrays are sorted bottom-to-top (index 0 = furthest back).
 * Renderers iterate forward; the last element in each array renders on top.
 *
 * zIndex semantics: higher value = closer to the viewer (front), matching
 * CSS / canvas conventions. The resolver computes zIndex so that the
 * topmost track in the editor UI gets the highest zIndex value.
 *
 * `fps` and `stage` are part of the render contract — the renderer must
 * never ask the engine or project directly for these values.
 */
/**
 * A compound clip (PV-P1): its nested project resolved at `sourceFrame`,
 * drawn at `contentSize` and placed exactly like an image.
 */
export interface ActiveCompoundClip extends ActiveClipBase {
  type: 'compound'
  /** The nested project's Scene at this clip's source frame (its own ids, stage and zIndex space). */
  scene: Scene
  /** The nested project's stage: the compound's natural size, as an image's pixel size is. */
  contentSize: { width: number; height: number }
  /** Rounded-corner mask, 0..0.5 fraction of the shorter rendered side. */
  cornerRadius?: number
  /** Crop window, normalized 0..1 of the content, origin top-left. */
  crop?: { x: number; y: number; width: number; height: number }
}

/**
 * A sequence clip at this frame (PV-P8): which frame of its source to show.
 * Preview and export pick `frameIndex`, computed by `sequenceFrameIndex`, so
 * both draw the same frame.
 */
export interface ActiveSequenceClip extends ActiveClipBase {
  type: 'sequence'
  kind: SequenceKind
  /** `animated-image`: the file URL (the clip's `src`). */
  src?: string
  /** `frames`: URL template; see `ClipSequence`. */
  frameUrlTemplate?: string
  startNumber?: number
  frameCount: number
  /** 0-based frame to show (loop or hold already applied). */
  frameIndex: number
  /** Present only when the sequence loops; layers prefetch across the wrap. */
  loop?: true
  cornerRadius?: number
  crop?: { x: number; y: number; width: number; height: number }
}

/**
 * A layout constraint that could not be applied (PV-P3b). `cycle`: the
 * constraints form a loop (including a clip anchored to itself).
 * `missing-target`: no clip has that id. `unsupported`: this clip or its
 * target cannot be laid out (type, legacy freehand, `fitTo` on a non-shape, a
 * zero-size shape).
 */
export interface LayoutError {
  clipId: string
  reason: 'cycle' | 'missing-target' | 'unsupported'
}

export interface Scene {
  /** The frame this Scene was resolved at. */
  frame: number
  /** Frames per second from the project. Renderers use this for timing. */
  fps: number
  /** Logical output canvas dimensions in pixels. */
  stage: { width: number; height: number }
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  shapes: ActiveShapeClip[]
  freehand: ActiveFreehandClip[]
  /** Transitions active at this frame. Consumed by the GPU transition pass (`RenderGraph`) and the export snapshot fallback. */
  transitions: ActiveTransition[]
  /**
   * Roto review masks. Present only when at least one visible video clip has
   * `roto` with a mode other than `off`, so scenes without roto are unchanged.
   * Not composited by MP4 export.
   */
  rotoMasks?: ActiveRotoMask[]
  /** Adjustment clips (EDX-P7). Present only when at least one is active. */
  adjustments?: ActiveAdjustmentClip[]
  /** Generator clips (EDX-P9). Present only when at least one is active. */
  generators?: ActiveGeneratorClip[]
  /** Compound clips (PV-P1). Present only when at least one is active. */
  compounds?: ActiveCompoundClip[]
  /** Sequence clips (PV-P8). Present only when at least one is active. */
  sequences?: ActiveSequenceClip[]
  /**
   * Expression problems at this frame (PV-P5b): one per clip, channel and code.
   * Present only when non-empty; the channel fell back to its keyed/authored
   * value, so the frame still renders.
   */
  expressionErrors?: ExpressionError[]
  /**
   * Layout problems at this frame (PV-P3b): a cycle, a missing target or an
   * unsupported clip/target. Present only when non-empty.
   */
  layoutErrors?: LayoutError[]
}
