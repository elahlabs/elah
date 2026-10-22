/**
 * All shared types for the editor core.
 * Time is always represented as integer frame counts — never float seconds.
 * FPS is a project-level constant stored in Project.fps.
 */

import type { Paint } from './paint'
export type { Paint, PaintStop } from './paint'
import type { ClipComponentInstance, ClipSceneSource, ProjectAuthored } from './authored'
export type { ClipComponentInstance, ClipSceneSource, JsonObject, ProjectAuthored } from './authored'
import type { ProjectComposition } from '../composition/types'

/** An exact frame position. Always a non-negative integer. */
export type FrameCount = number

/**
 * Entry/exit animation styles available to text and shape clips.
 *
 * `fade` drives opacity only. `spin` and the four `slide-*` kinds drive the
 * clip's `Transform` (rotation / position) and leave opacity untouched.
 * The human-readable option list for UI pickers is
 * `TEXT_ANIMATION_KINDS` in `resolver/textAnimation.ts` — a `Record` keyed by
 * this union, so it cannot drift from it.
 */
export type TextAnimationKind =
  | 'fade'
  | 'spin'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'

/**
 * Entry/exit animation descriptor. Used by both `Clip.textAnimation` and
 * `Clip.shapeAnimation` — the two fields share this one shape.
 *
 * Resolved by `sampleTextAnimation` (see `resolver/textAnimation.ts`) into the
 * two channels every renderer already understands: an opacity ramp and, for the
 * kinds that move or rotate the clip, a concrete `Transform` that replaces the
 * clip's authored one for the frames the ramp covers. Renderers stay
 * animation-unaware, so GPU/export parity is automatic.
 */
/**
 * Easing curves available to a `MotionSpec`.
 *
 * `quad-in` / `quad-out` are the curves the enum animation kinds have always
 * used, kept so the legacy path is expressible in the new model rather than
 * living beside it.
 *
 * `back-*` and `elastic-out` OVERSHOOT — they return values outside 0..1 partway
 * through. That is the point: overshoot is most of what reads as deliberate
 * motion design rather than a linear slide. It also means any channel driven by
 * them must tolerate passing its target and coming back, which is fine for
 * position/rotation/scale and is why opacity is clamped at the point of use.
 */
export type TextAnimationEasing =
  | 'linear'
  | 'sine-in'
  | 'sine-out'
  | 'sine-in-out'
  | 'quad-in'
  | 'quad-out'
  | 'quad-in-out'
  | 'cubic-in'
  | 'cubic-out'
  | 'cubic-in-out'
  | 'quart-in'
  | 'quart-out'
  | 'quart-in-out'
  | 'quint-in'
  | 'quint-out'
  | 'quint-in-out'
  | 'expo-in'
  | 'expo-out'
  | 'expo-in-out'
  | 'circ-in'
  | 'circ-out'
  | 'circ-in-out'
  | 'back-in'
  | 'back-out'
  | 'back-in-out'
  | 'elastic-in'
  | 'elastic-out'
  | 'elastic-in-out'
  | 'bounce-in'
  | 'bounce-out'
  | 'bounce-in-out'

/**
 * One end of a layered animation: the state the clip is in at the FAR end of
 * its ramp, with the near end always being the clip's authored resting state.
 *
 * Rest is structurally fixed — opacity 1, zero offset, scale multiplier 1, zero
 * rotation delta — so only the extreme is stored. Encoding both ends would allow
 * a spec whose "to" is not rest, i.e. a clip that never reaches the state the
 * author set in the properties panel, which is a bug generator rather than a
 * feature.
 *
 * Read direction differs per end, and that asymmetry mirrors how the two ramps
 * actually work:
 *   in  — the clip STARTS at the extreme and arrives at rest as the ramp closes.
 *   out — the clip starts at rest and DEPARTS to the extreme.
 *
 * Every field is optional; an omitted channel is left at rest and contributes
 * nothing, so a spec only describes what it actually animates.
 */
export interface MotionSpec {
  /** Opacity at the extreme, 0..1. Rest is 1. Omitted = no opacity ramp. */
  opacity?: number
  /** Horizontal offset from rest at the extreme, normalized 0..1 of stage width. */
  offsetX?: number
  /** Vertical offset from rest at the extreme, normalized 0..1 of stage height. */
  offsetY?: number
  /**
   * Scale MULTIPLIER at the extreme, applied on top of the clip's authored
   * scale. 0.8 = starts (or ends) at 80% of whatever size the author chose.
   * A multiplier rather than an absolute so a template never fights the scale
   * slider. Rest is 1.
   */
  scale?: number
  /** Rotation delta from rest at the extreme, in radians. Positive = clockwise. */
  rotation?: number
  /**
   * Curve for the geometric channels (offset, scale, rotation).
   * Defaults to `quad-out` on an entry and `quad-in` on an exit — an entry
   * decelerating into place and an exit accelerating away, which is what the
   * enum kinds have always done.
   */
  ease?: TextAnimationEasing
  /**
   * Curve for opacity, kept separate because it usually wants to stay linear
   * while the geometry overshoots. Defaults to `linear`, which is both the
   * video convention for a cross-fade and what every already-authored project
   * was written against.
   */
  opacityEase?: TextAnimationEasing
}

export interface TextAnimation {
  in?: TextAnimationKind
  out?: TextAnimationKind
  /** Duration of the in/out ramp in frames (shared by both directions) */
  durationFrames: number
  /**
   * Layered entry motion. When present this REPLACES whatever `in` names —
   * the enum is resolved into a `MotionSpec` internally, so the two are the
   * same machinery and this is simply the expressive form of it.
   *
   * Lets a single end drive several channels at once (fade AND rise AND scale),
   * which the one-kind-per-end enum cannot express. Written by text templates;
   * the properties panel's Entry/Exit selects still write `in` / `out`.
   */
  inMotion?: MotionSpec
  /** Layered exit motion. Replaces `out` when present. See `inMotion`. */
  outMotion?: MotionSpec
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
  /**
   * Extra horizontal stretch multiplied on top of `scale`. Omitted means 1, so
   * every transform written before free resize existed stays uniform.
   */
  scaleX?: number
  /** Extra vertical stretch multiplied on top of `scale`. Omitted means 1. */
  scaleY?: number
  /**
   * MOT-8: horizontal shear in radians (CSS skewX): a point moves along x by tan(skewX) * y,
   * measured from the box centre. Applied to the scaled box BEFORE `rotation` (CSS
   * "rotate() skew()" order). Omitted or 0 draws exactly as before.
   */
  skewX?: number
  /** MOT-8: vertical shear in radians (CSS skewY): a point moves along y by tan(skewY) * x. */
  skewY?: number
  /**
   * MOT-8 phase B: tilt about the horizontal axis, in radians (CSS rotateX): positive tips the top
   * edge away from the viewer. Drawn in perspective by image, video, sequence and compound clips
   * (text, shape and freehand clips ignore it, in preview and export alike). Omitted or 0 = flat.
   */
  rotateX?: number
  /** MOT-8 phase B: turn about the vertical axis, in radians (CSS rotateY): positive swings the right edge away. */
  rotateY?: number
  /** MOT-8 phase B: eye distance in stage px for rotateX/Y; default 1200. Static (not keyed). */
  perspective?: number
}

/**
 * `adjustment` (EDX-P7): a clip with no picture of its own. Its effect stack,
 * mask, blend and opacity apply to everything composited below it.
 */
export type ClipType = 'video' | 'audio' | 'text' | 'image' | 'shape' | 'freehand' | 'adjustment' | 'generator' | 'compound' | 'sequence'

/** A sequence clip's source (PV-P8). */
export type SequenceKind = 'animated-image' | 'frames'

/**
 * A sequence clip's source (PV-P8): an animated image (GIF, animated
 * WebP/PNG/AVIF) or a numbered image sequence. Preview and export pick the
 * frame with `sequenceFrameIndex` (resolver/sequence.ts), so both show the
 * same one.
 */
export interface ClipSequence {
  /**
   * 'animated-image': one file (GIF, animated WebP/PNG/AVIF) decoded with
   * WebCodecs `ImageDecoder`; the file URL is the clip's own `src`, so upload
   * repointing, relinking and missing-media reporting treat it like any media
   * clip.
   * 'frames': one image file per frame at `frameUrlTemplate`.
   */
  kind: SequenceKind
  /** 'frames' only: URL with `{frame}` (plain integer) or `{frame:N}` (zero-padded to N digits, N = 1..9). */
  frameUrlTemplate?: string
  /** 'frames' only: the number substituted for sequence frame 0. Default 0. */
  startNumber?: number
  /** Frames in one cycle. Integer >= 1. */
  frameCount: number
  /** The sequence's own frame rate, frames per second, independent of the project's. > 0. */
  fps: number
  /** Repeat after the last frame. Absent or false = hold the last frame. */
  loop?: boolean
  /** Intrinsic frame size in px when known (set at import). UI placement only; renderers use the decoded frame's size. */
  width?: number
  height?: number
}

/**
 * A generator clip's recipe (EDX-P9): a registered kind
 * (`generators/registry.ts`), its flat params, and a seed so particles are
 * the same on every render.
 */
export interface ClipGenerator {
  kind: string
  params: Record<string, number | string | boolean>
  seed?: number
}

/**
 * Shape draw-on (EDX-P9): the visible stretch of the outline, 0..1 along its
 * length. `end` is keyframeable as the `draw` channel.
 */
export interface ShapeDraw {
  start: number
  end: number
}

// ---------------------------------------------------------------------------
// Text styling, animators and captions (EDX-P8)
// ---------------------------------------------------------------------------

/**
 * A CSS font weight (PV-P4b): the keywords older documents hold, or 100..900.
 *
 * The union is deliberately WIDE at the storage layer and NARROW everywhere a
 * value is produced for a system family: a bundled face ships discrete weights,
 * but `'sans-serif'` has no weight axis the canvas can honour, so the picker
 * snaps a number back to a keyword when the clip is not on a bundled font.
 */
export type FontWeight = 'normal' | 'bold' | number

/** PV-P4b. Absent = normal. */
export type FontStyle = 'normal' | 'italic'

/**
 * A styled run inside a text clip's `content` (PV-P4c). Offsets are UTF-16
 * code units: `start` inclusive, `end` exclusive, 0 ≤ start < end ≤ content.length.
 * Written sorted and non-overlapping (`normalizeSpans`); readers tolerate
 * anything by flattening per character. A field left out inherits the clip.
 */
export interface TextSpan {
  start: number
  end: number
  fontWeight?: FontWeight
  fontStyle?: FontStyle
  /** Solid colour for the run; wins over `textFill` and `color`. */
  color?: string
}

export interface TextOutline {
  color: string
  /** Stage px. */
  width: number
}

export interface TextShadow {
  color: string
  /** Blur radius, stage px. */
  blur: number
  offsetX: number
  offsetY: number
}

/** A line drawn through or under every laid-out text line (MC-1d). */
export type TextDecoration = 'underline' | 'line-through'

/** How a text box treats text that does not fit (PV-P3a). */
export type TextOverflow = 'wrap' | 'shrink' | 'clip'
export type TextVerticalAlign = 'top' | 'middle' | 'bottom'

/**
 * A text clip's box (PV-P3a). Lengths are stage px at `transform.scale` 1 and
 * scale with it. Absent = the legacy block: wrapped at 90 % of the stage width,
 * as wide as its longest line, line height 1.2, no tracking.
 */
export interface TextBox {
  /** Wrap width. The box is exactly this wide and `textAlign` aligns lines inside it. Absent = 90 % of the stage, box hugs the longest line. */
  width?: number
  /** 'shrink': most lines before the font shrinks. 'clip': lines past it are dropped. With either, the box is this many lines tall. Ignored by 'wrap'. Integer >= 1. */
  maxLines?: number
  overflow: TextOverflow
  /** The smallest size 'shrink' may reach, px. Default 8. */
  minFontSize?: number
  /** Where lines sit in a box taller than they are (maxLines with 'shrink' or 'clip'). Default 'middle'. */
  verticalAlign?: TextVerticalAlign
  /** Extra px between characters, never after the last. May be negative. Default 0. */
  letterSpacing?: number
  /** Line advance as a multiple of the font size. Default 1.2 (`LINE_HEIGHT`). */
  lineHeight?: number
}

export type TextAnimatorUnit = 'char' | 'word' | 'line'
export type TextAnimatorPreset = 'typewriter' | 'fade' | 'rise' | 'pop'

/**
 * Reveals text a unit at a time: unit n starts `n × staggerFrames` into the
 * clip and takes `durationFrames` to arrive. Spaces are not units.
 */
/** MOT-5: see `Clip.textScramble`. */
export interface TextScramble {
  charset: 'upper' | 'lower' | 'alnum' | 'symbols' | (string & {})
  seed?: number
  changeEvery?: number
  preserve?: 'spaces' | 'none'
}

export interface TextAnimator {
  unit: TextAnimatorUnit
  preset: TextAnimatorPreset
  staggerFrames: number
  durationFrames: number
  /** MOT-3: unit order, fed to `staggerOffsets`. Absent = `start` (unit n at n x staggerFrames). */
  from?: 'start' | 'end' | 'center' | 'edges' | 'random'
  /** MOT-3: spreads the stagger distance (`staggerOffsets` ease). */
  staggerEase?: TextAnimationEasing
  /** MOT-3: ease for `tween` channels. Default linear. Ignored by the four presets. */
  ease?: TextAnimationEasing
  /**
   * MOT-3: per-unit `[from, to]` channels over `durationFrames`; replaces the preset's look. dx/dy are multiples
   * of the font size, rotation is radians, blur is px. A tween-authored animator keeps `preset: 'fade'` as the
   * fallback older builds read.
   */
  tween?: TextAnimatorTween
}

export type TextAnimatorChannel = 'opacity' | 'dx' | 'dy' | 'scale' | 'rotation' | 'blur'
export type TextAnimatorTween = Partial<Record<TextAnimatorChannel, [number, number]>>

/** One spoken word; frames are clip-local, `end` exclusive. */
export interface CaptionWord {
  text: string
  start: FrameCount
  end: FrameCount
}

/**
 * - karaoke: words already spoken take the highlight colour.
 * - highlight: only the word being spoken takes it.
 * - reveal: words appear as they are spoken, with a small pop.
 * - static: plain text; the timings are kept but unused.
 */
export type CaptionMode = 'static' | 'karaoke' | 'highlight' | 'reveal'

/**
 * Variant of the 'shape' clip — determines which SVG primitive is rendered.
 *
 * There is deliberately no `ellipse` member: `circle` is painted with
 * `ctx.ellipse(cx, cy, halfW, halfH)`, so an ellipse is a circle with
 * `scaleX`/`scaleY`. `triangle` stays its own variant rather than folding into
 * `polygon` with 3 sides, because its base sits on the box's bottom corners —
 * not a regular inscribed 3-gon — and every document drawn with it would move.
 */
export type ShapeVariant = 'rect' | 'circle' | 'triangle' | 'polygon' | 'line' | 'path'

/** Arrowhead placement for the 'line' shape variant. */
export type ShapeArrowHead = 'none' | 'end' | 'both'

/** SVG fill rule for the 'path' shape variant. */
export type ShapeFillRule = 'nonzero' | 'evenodd'

/**
 * User-space box a `path` shape's `d` data is authored in, mapped into the
 * clip's rendered box with an object-fit-contain fit (aspect preserved, so a
 * stretched box letterboxes the art rather than skewing it).
 */
export interface ShapeViewBox {
  x: number
  y: number
  width: number
  height: number
}

/** Stroke end caps (PV-P6a). Same names as the canvas `lineCap`. */
export type ShapeStrokeCap = 'butt' | 'round' | 'square'
/** Stroke corner joins (PV-P6a). Same names as the canvas `lineJoin`. */
export type ShapeStrokeJoin = 'miter' | 'round' | 'bevel'
/** Where a stroke sits relative to the outline (PV-P6a). */
export type ShapeStrokeAlign = 'center' | 'inside' | 'outside'

export type TrackKind = 'video' | 'audio' | 'elements'

/** The target edge a laid-out clip attaches to (PV-P3b). */
export type LayoutEdge = 'top' | 'bottom' | 'left' | 'right'
/** Alignment along that edge: start = left/top edges flush, end = right/bottom edges flush. */
export type LayoutAlign = 'start' | 'center' | 'end'
/**
 * The ops `Region` names plus the two safe areas. Kept as its own literal list
 * (rather than importing `ops/types.ts`'s `Region`) so `types` stays
 * import-free.
 */
export type LayoutRegion =
  | 'center'
  | 'top'
  | 'bottom'
  | 'lower-third'
  | 'upper-third'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'safe-title'
  | 'safe-action'

/**
 * PV-P3b: constraints that replace a clip's BASE position (and, for `fitTo`,
 * size) before keyframes and entry/exit motion apply. Lengths are stage px.
 * Precedence, lowest first: region → pin (per axis) → anchorTo → fitTo.
 * Text, shape and v2 freehand clips; targets may be text, shape or freehand.
 * Targets are read at rest (their laid-out base, no keys, no motion), so a
 * clip does not follow its target's animation.
 */
export interface ClipLayout {
  /** Sit outside `edge` of clip `clip`'s box, `gap` px away (default 0), aligned by `align` (default 'center'). */
  anchorTo?: { clip: string; edge: LayoutEdge; align?: LayoutAlign; gap?: number }
  /** A region names where the box goes inside title-safe; 'safe-title'/'safe-action' only keep it inside that area. */
  region?: LayoutRegion
  /** Stage-edge-to-box-edge distances. left wins over right, top over bottom. */
  pin?: { left?: number; right?: number; top?: number; bottom?: number }
  /** Shapes only: become clip `clip`'s box grown by `padding` (default 0) on every side, with its rotation. */
  fitTo?: { clip: string; padding?: number }
}

/**
 * Which local file a media clip came from (LM-P1). The renderer never reads
 * it: `src` is what plays. `id` is a content fingerprint `local:<sha256-hex>`
 * (see `fingerprintBlob`); `folder` is the footage folder's name plus the
 * file's path segments inside it. It is what lets a reloaded project find its
 * footage again once the `blob:` URL in `src` is dead.
 */
export interface ClipMediaRef {
  v: 1
  id: string
  name: string
  byteSize: number
  lastModified: number
  kind: 'video' | 'audio' | 'image'
  mime?: string
  folder?: { name: string; path: string[] }
}

/** On-device voice clean-up for one clip, each strength 0..1 (0 = that half off). */
export interface ClipAudioEnhance {
  /** Rumble high-pass plus spectral noise reduction. */
  noise: number
  /** Presence EQ, gentle compression and make-up gain. */
  voice: number
}

/** `Clip.audio`: settings that shape a clip's own sound. See audio/clipAudio.ts. */
export interface ClipAudio {
  muted?: boolean
  /** Extra gain on top of `volume`, 0..12 dB. */
  boostDb?: number
  fadeInSec?: number
  fadeOutSec?: number
  enhance?: ClipAudioEnhance
}

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

  /** Present on the compound clip of a generated component (EG-P1). Never read by the renderer, never bumps PROJECT_VERSION. */
  component?: ClipComponentInstance
  /** The HTML/CSS a `write_scene` compound was converted from (CMP-EDIT-3). Never read by the renderer, never bumps PROJECT_VERSION. */
  scene?: ClipSceneSource
  /** The spec element id this clip was compiled from (EG-P1). Never read by the renderer, never bumps PROJECT_VERSION. */
  partId?: string

  /** Position on the timeline (frame where this clip starts) */
  startFrame: FrameCount
  /** How many frames this clip occupies on the timeline */
  durationFrames: FrameCount

  /** Trim in-point into the source asset */
  sourceStartFrame: FrameCount
  /** Length of the source asset (used for trim constraints) */
  sourceDurationFrames: FrameCount
  /**
   * How many frames the clip's source media holds, at 1x (PV-T5-1). Set when
   * the clip is made from an asset whose length is known; carried to both
   * halves of a split and to clones by the spread in those visitors. Trims,
   * slips, speed changes and remaps stop at the end of the media when it is
   * present, which is what lets a split half be trimmed back out to the media
   * it came from. Absent on older clips and on clips with no known length:
   * those keep the legacy limits based on `sourceDurationFrames`.
   */
  assetFrames?: FrameCount

  /**
   * Linked clips (PV-T1): every clip sharing a `linkId` moves, trims, splits
   * and deletes together in the timeline (a video and its audio, say). A
   * split's right half and a clone never inherit it; absent = not linked.
   */
  linkId?: string
  /**
   * The user's label colour for the clip on the timeline (PV-T1): a label id
   * `label-1`…`label-8` or `#rrggbb`. Not `color`, which is the text glyph
   * colour. Absent = the clip type's colour.
   */
  labelColor?: string

  /** Source URL for video / audio / image clips */
  src?: string
  /**
   * Optional reference to a MediaAsset in the MediaLibrary. When set, the
   * renderer prefers this lookup over `src`. Both can coexist during
   * the migration to an assetId-only model.
   */
  assetId?: string
  /**
   * The local file this clip's media came from (LM-P1). Never read by the
   * renderer and never bumps PROJECT_VERSION; `readClip` validates or drops it.
   */
  media?: ClipMediaRef
  /** Text content for text clips */
  content?: string

  // --- Text style (text clips only; all optional, the TextLayer applies defaults) ---
  /** Glyph size in stage-space pixels */
  fontSize?: number
  /** CSS color string for the glyphs */
  color?: string
  /** CSS font-family */
  fontFamily?: string
  /**
   * A bundled font by id (PV-P4a; `fonts/registry.ts`). When the id is known it
   * wins over `fontFamily`, which stays as the fallback for an unknown id.
   * Absent = `fontFamily` as before.
   */
  fontId?: string
  /**
   * 'normal' | 'bold' in documents written before PV-P4b; bundled fonts store
   * 100..900. A NUMBER is only meaningful with a bundled `fontId` — a system
   * family has no weight axis the canvas can honour, so a numeric weight on one
   * is normalised back to a keyword by the picker (see `legacyWeight`).
   */
  fontWeight?: FontWeight
  /**
   * 'italic' paints the family's italic face, or a synthesised oblique when it
   * has none. Absent = normal. A clip with neither this nor a numeric weight
   * paints the pre-PV-P4b font string, byte for byte.
   */
  fontStyle?: FontStyle
  textAlign?: 'left' | 'center' | 'right'
  /** CSS color string for the box painted behind the glyphs. Undefined = no background. */
  backgroundColor?: string
  /** Opacity of `backgroundColor`, 0–1. Default 1. */
  backgroundOpacity?: number
  /** Space in stage-space pixels between the glyphs and the background/border box. */
  padding?: number
  /** Corner radius of the background/border box, in stage-space pixels. */
  borderRadius?: number
  /** Stroke width of the box border, in stage-space pixels. 0 (or omitted) = no border. */
  borderWidth?: number
  /** CSS color string for the box border. */
  borderColor?: string

  // --- Text styling, animators and captions (EDX-P8) ---
  /** Glyph outline, drawn under the fill. Width in stage px. */
  textOutline?: TextOutline
  /** Glyph shadow; zero offset + a large blur reads as a glow. */
  textShadow?: TextShadow
  /**
   * Line drawn on every laid-out line, in the glyph colour (MC-1d). Thickness
   * `max(1, fontSize / 14)`. Absent = none, byte-identical to before.
   */
  textDecoration?: TextDecoration
  /**
   * Glyph fill (PV-P4c). When present it replaces `color` for the glyphs;
   * a gradient spans the glyph box (the layout box without padding) and turns
   * with the text. Absent = `color`, exactly as before.
   */
  textFill?: Paint
  /** Styled runs of `content` (PV-P4c). Absent or empty = one style for the whole text. */
  spans?: TextSpan[]
  /** Per-character/word/line reveal with stagger. */
  textAnimator?: TextAnimator
  /**
   * Scramble text (MOT-5): glyphs resolve from noise into the real text as `text.scramble` runs 0..1 (no keys = the real text).
   * `charset` is a preset id (upper, lower, alnum, symbols) or a literal of at most 64 characters; `changeEvery` is the frames a
   * noise glyph holds (default 2). Deterministic per frame. Older builds ignore it and show the real text.
   */
  textScramble?: TextScramble
  /** Word timings, clip-local frames, in reading order. */
  words?: CaptionWord[]
  /** How `words` drive the text. Absent or 'static' = plain text. */
  captionMode?: CaptionMode
  /** Colour for spoken/active words in 'karaoke' and 'highlight' modes. */
  captionHighlight?: string

  // --- Shape style (shape clips only) ---
  /** Which SVG primitive to render */
  shapeKind?: ShapeVariant
  /** CSS color string for the shape fill */
  shapeFill?: string
  /** CSS color string for the shape stroke */
  shapeStroke?: string
  /** Stroke width in stage-space pixels */
  shapeStrokeWidth?: number
  /** `polygon` only: vertex count, clamped to 3..12 by the painter. Default 5. */
  shapeSides?: number
  /**
   * `polygon` only: when present the polygon becomes a STAR of `2 × shapeSides`
   * vertices, alternating the full radius with this fraction of it. Absent =
   * a plain convex polygon.
   */
  shapeInnerRatio?: number
  /** `line` only: where to paint a filled arrowhead. Default 'none'. */
  shapeArrowHead?: ShapeArrowHead
  /** `path` only: SVG path data (the `d` attribute value). */
  shapePath?: string
  /** `path` only: the user space `shapePath` is authored in. Default 0 0 100 100. */
  shapeViewBox?: ShapeViewBox
  /** `path` only: fill rule for self-intersecting paths. Default 'nonzero'. */
  shapeFillRule?: ShapeFillRule
  /**
   * Gradient (or solid) fill (PV-P6a). Wins over `shapeFill` when present;
   * `shapeFill` stays the fallback colour older builds and the colour swatch use.
   */
  shapeFillPaint?: Paint
  /** Gradient (or solid) stroke (PV-P6a). Wins over `shapeStroke` when present. */
  shapeStrokePaint?: Paint
  /**
   * Dash pattern, alternating dash and gap lengths in stage px (canvas
   * `setLineDash`). Absent, empty, all zeros or invalid = a solid stroke.
   * Ignored while a draw-on (`shapeDraw`) is animating, which owns the dash.
   */
  shapeStrokeDash?: number[]
  /** Offset into the dash pattern, stage px. Only read with `shapeStrokeDash`. */
  shapeStrokeDashOffset?: number
  /** Absent = 'butt', except the `line` variant, which keeps its legacy 'round'. */
  shapeStrokeCap?: ShapeStrokeCap
  /** Absent = 'miter'. */
  shapeStrokeJoin?: ShapeStrokeJoin
  /**
   * Absent = 'center'. 'inside'/'outside' draw a doubled-width stroke clipped to
   * the inside or outside of the fill region. Ignored by `line` and while a
   * draw-on is animating.
   */
  shapeStrokeAlign?: ShapeStrokeAlign
  /**
   * Drop shadow cast by the FILL of a shape (every kind but `line`, which has
   * no fill) and by a text clip's background box (MC-1d). Stage px, the same
   * shape as `textShadow`. The stroke casts nothing. Absent = no shadow.
   */
  shadow?: TextShadow
  /**
   * `rect` shapes only (MC-1d): per-corner radii [tl, tr, br, bl], each a
   * fraction 0..0.5 of the shorter box side like `cornerRadius`. Wins over
   * `cornerRadius` when present. Absent = `cornerRadius`, as before.
   */
  cornerRadii?: [number, number, number, number]

  // --- Freehand style (freehand clips only) ---
  /** SVG path data string (the 'd' attribute value) */
  pathData?: string
  /** CSS color string for the stroke */
  strokeColor?: string
  /** Stroke width in stage-space pixels */
  strokeWidth?: number

  volume?: number   // 0 – 1
  opacity?: number  // 0 – 1
  /**
   * Merged A/V: this VIDEO clip carries its own sound — one clip, picture and
   * audio, so trim/move/split/speed cannot desync them.
   *
   *   true     the container's audio is heard in preview and mixed into export
   *   false    detached: the audio now lives in a separate `audio` clip, linked
   *            to this one by `linkId` (see actions/detachAudio.ts)
   *   absent   a clip written before merged A/V, or one whose source has no
   *            audio: no audio path at all, i.e. the pre-merge behavior. This
   *            is what every stored project already has, which is why absence —
   *            not `false` — must mean silent.
   *
   * Video clips only; ignored on every other type and stripped on read. No
   * audio is emitted while the clip is time-remapped, the same rule
   * hoistCompoundAudio() follows for nested compounds.
   */
  embeddedAudio?: boolean
  /**
   * The clip's own audio settings: mute, boost, fades and Enhance. Audio clips
   * and video clips with `embeddedAudio` only; validated on read by
   * `readClipAudio` (audio/clipAudio.ts), which also holds the envelope the
   * preview and the export mix both apply. Absent = none of it.
   */
  audio?: ClipAudio
  /**
   * Playback speed multiplier for VIDEO clips only (audio clips on this
   * timeline are stripped of audio, so no time-stretch is needed). 1 = normal
   * speed (default when omitted). Clamped to [0.25, 4] by TimelineEngine's
   * setClipSpeed(). Changing it recomputes `durationFrames` so the clip's
   * on-timeline length reflects the new speed while `sourceStartFrame` /
   * `sourceDurationFrames` continue to describe the trim window into the
   * source asset at 1x. See resolveTimeline.ts for how this maps timeline
   * frames to source frames, and ExportWorker.ts for how export honors it.
   */
  speed?: number
  /**
   * Rounded-corner mask, as a fraction 0..0.5 of the *shorter* rendered side.
   * 0 (or omitted) = square corners; 0.5 = a full ellipse, which on a square
   * draw rect is a circle.
   *
   * Read by video/image clips (a shader SDF mask) and by the `rect` shape
   * variant (an arcTo-traced path). One field rather than a `shapeCornerRadius`
   * twin, so the existing `cornerRadius` keyframe channel animates both.
   */
  cornerRadius?: number
  /**
   * Source-space crop window, normalized 0..1 of the media's natural size,
   * origin top-left. Omitted = the full frame. Video/image clips only.
   */
  crop?: { x: number; y: number; width: number; height: number }
  /**
   * PQ-1a: where the subject sits in the SOURCE frame (0..1, origin top-left), set once per shot by `setFit`.
   * A point (or a box when `width`/`height` are given) for later tools to keep clear. Not drawn.
   */
  focus?: { x: number; y: number; width?: number; height?: number }
  locked?: boolean
  disabled?: boolean
  /** Optional spatial transform; undefined means the renderer applies its own default */
  transform?: Transform
  /**
   * PV-P2: how `transform` is read by text and freehand clips. Absent = the
   * legacy model (text: x/y is the block centre and anchor/scaleX/scaleY are
   * ignored; freehand: the transform is ignored). 'v2' = the clip has a real
   * content box on which anchor, scale, scaleX/scaleY and rotation act exactly
   * as they do for images and shapes. The clip factories set it on new clips;
   * a stored document never gains it. Other clip types ignore it.
   */
  transformModel?: 'v2'
  /**
   * PV-P3b: constraints that replace this clip's BASE position (and, for
   * `fitTo`, size) before keyframes and entry/exit motion apply. Absent = the
   * clip's own `transform` (or its type default) as before. Text, shape and
   * v2 freehand clips only; see `ClipLayout`.
   */
  layout?: ClipLayout
  /**
   * PV-P3a: fixed width, line limit, overflow, tracking, line height. Absent =
   * legacy layout. Text clips only; every other type ignores it.
   */
  textBox?: TextBox
  /** Entry/exit animation for text clips */
  textAnimation?: TextAnimation
  /** Entry/exit animation for shape clips */
  shapeAnimation?: TextAnimation
  /** Shape draw-on (EDX-P9): visible part of the outline; keyed via `draw`. */
  shapeDraw?: ShapeDraw
  /** Generator clips (EDX-P9): what the clip paints. */
  generator?: ClipGenerator
  /** Sequence clips (PV-P8). The animated file itself is `src`. */
  sequence?: ClipSequence
  /** Compound clips (PV-P1): the nested timeline. Present exactly when `type === 'compound'`. */
  compound?: ClipCompound
  /**
   * Per-channel keyframes. Sampled by `resolver/keyframes.ts` into ABSOLUTE
   * values that replace the authored channel for that frame; `textAnimation`
   * / `shapeAnimation` then layer on top of the result as they always have.
   * Written through `elements/keyframes.ts`, which bakes a concrete
   * `transform` alongside the first transform key so the two never disagree.
   */
  keyframes?: ClipKeyframes
  /**
   * Motion along a path (MOT-1). While set, the resolver replaces `x`/`y` with the path
   * position at the keyed `motion.progress` (0..1, arc length; 0 with no keys), so every
   * renderer sees a plain `Transform`. `d` is SVG path data in stage px (`space: 'stage'`,
   * default); `space: 'clip'` reads it as an offset from its own start, added to the authored
   * x/y. `orient` adds the tangent angle plus `offsetRotation` (degrees) to `rotation`. Only
   * the first subpath is followed. Additive: an older build ignores it and shows the clip at
   * its static x/y.
   */
  motionPath?: { d: string; orient?: boolean; offsetRotation?: number; space?: 'stage' | 'clip' }

  // --- Effects and compositing. All optional: a clip without them resolves
  // exactly as before. Order of application once rendered: crop → effects
  // (array order) → transform/opacity/corner mask → mask → matte → blend. ---
  /** Standard effect stack, applied top to bottom in source space. */
  effects?: Effect[]
  /** How the clip composites onto what is below it. Omitted = normal. */
  blend?: BlendMode
  /** One shape mask in the clip's own draw box. */
  mask?: ClipMask
  /**
   * Track matte: another clip whose alpha or luma cuts this one. Also the
   * seam the rotoscope build uses — a roto job yields a matte clip that other
   * clips reference here.
   */
  matte?: ClipMatte
  /**
   * A rotoscope mask run attached for REVIEW: a per-frame mask image sequence
   * drawn over (or instead of) this video clip. Distinct from `mask` (a shape
   * in the clip's box) and `matte` (another clip cutting this one): this one
   * only visualises a roto result and never changes the composite. Video only.
   */
  roto?: ClipRoto
}

/** How a roto mask is shown over its clip. `off` keeps the run attached but draws nothing. */
export type RotoViewMode = 'overlay' | 'matte' | 'off'

/**
 * A completed roto run's mask sequence. Frame `n` of the sequence is the mask
 * for SOURCE frame `n` of the clip's media, at the media's own pixel size.
 */
export interface ClipRoto {
  kind: 'sequence'
  /** Server id of the run the frames belong to. */
  runId: string
  /** URL with a literal `{frame}` placeholder, replaced by the integer frame index. */
  frameUrlTemplate: string
  frameCount: number
  /** Mask pixel size; equals the source media's display size. */
  width: number
  height: number
  view: {
    mode: RotoViewMode
    /** Overlay tint, '#rrggbb'. */
    color: string
    /** Overlay strength, 0..1. Ignored in matte mode. */
    opacity: number
  }
}

// ---------------------------------------------------------------------------
// Effects, blend, mask, matte, markers
// ---------------------------------------------------------------------------

/**
 * One entry in a clip's effect stack. `kind` is validated against the
 * registry (`effects/registry.ts`) at resolve time, never at read time: an
 * unknown kind is kept in the document (a newer build may know it) and
 * resolves as disabled. Params are FLAT scalars so an agent can author them;
 * colours are '#rrggbb' strings and enums are strings.
 */
export interface Effect {
  /** Stable id. A key addresses one param as `fx.<id>.<param>`. */
  id: string
  kind: string
  /** Undefined = enabled. */
  enabled?: boolean
  params: Record<string, number | string | boolean>
  /** The registry preset these params came from. A UI badge only. */
  preset?: string
}

export type BlendMode =
  | 'normal'
  | 'add'
  | 'screen'
  | 'multiply'
  | 'overlay'
  | 'softLight'
  | 'darken'
  | 'lighten'
  | 'difference'

export const BLEND_MODES: ReadonlyArray<BlendMode> = [
  'normal',
  'add',
  'screen',
  'multiply',
  'overlay',
  'softLight',
  'darken',
  'lighten',
  'difference',
]

export type ClipMaskKind = 'rect' | 'ellipse' | 'path' | 'gradient'

/** A mask in the clip's draw box; box fields are normalized 0..1 of that box. */
export interface ClipMask {
  kind: ClipMaskKind
  x: number
  y: number
  width: number
  height: number
  /** Radians, about the mask box centre. */
  rotation?: number
  /** Edge softness, 0..1 of the shorter mask side. */
  feather?: number
  invert?: boolean
  /** `path` only: SVG path data in `viewBox` space. */
  path?: string
  viewBox?: ShapeViewBox
  /** `gradient` only: direction in radians. */
  angle?: number
}

export interface ClipMatte {
  /** The clip whose alpha or luminance cuts this one. */
  sourceClipId: string
  kind: 'alpha' | 'luma'
  invert?: boolean
}

/** A named point (or range) on the project timeline. */
export interface Marker {
  id: string
  /** Absolute timeline frame. */
  frame: FrameCount
  /** Present = a range marker. */
  durationFrames?: FrameCount
  name: string
  color?: string
  kind?: 'marker' | 'chapter' | 'beat'
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/**
 * A keyframable property. Every channel is a SCALAR — position is two
 * independent channels, not a vec2, and there is no spatial motion path. That
 * is the CapCut simplification, and it is also what keeps the schema shallow
 * enough for an agent to author reliably (no nested numeric arrays).
 *
 * Transform channels use `Transform` units: `x`/`y` normalized 0..1 of the
 * stage, `scale` a multiplier, `rotation` radians. `opacity`/`volume` are
 * 0..1, `cornerRadius` 0..0.5 of the shorter rendered side.
 */
export type KeyframeChannel =
  | 'x'
  | 'y'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'skewX'
  | 'skewY'
  | 'rotateX'
  | 'rotateY'
  | 'opacity'
  | 'volume'
  | 'cornerRadius'

export interface Keyframe {
  /** Stable id. Agents and UI address a key by id, never by array index. */
  id: string
  /**
   * Integer frame RELATIVE to the clip's start (0 = the clip's first frame).
   * Relative so moving a clip is a no-op; `split`/`trim`/`setClipSpeed` remap
   * it through `remapKeyframes` / `splitKeyframes`.
   */
  frame: number
  value: number
  /**
   * Curve of the segment LEADING INTO this key, i.e. from the previous key to
   * this one. The first key's easing is therefore unused. One name per key
   * keeps the field count half of a handle-pair model and is what
   * CapCut/Creatomate/WAAPI all do.
   */
  easing: TextAnimationEasing
  /**
   * A raw cubic-bezier `[x1, y1, x2, y2]` for curves the named set cannot
   * express (the curve editor's handles). When present and finite it wins
   * over `easing` (EDX-P6); x handles are clamped to 0..1, y may overshoot.
   */
  easingBezier?: [number, number, number, number]
  /**
   * Staircase: the segment arriving at this key advances in `steps` equal
   * jumps (jump-end, like CSS and GSAP `steps(n)`). Integer 1..64. Loses to
   * `spring` and `easingBezier`, beats `easing`. Older builds ignore it.
   */
  steps?: number
  /** Step: hold this key's value until the next key, ignoring its easing. */
  hold?: true
  /**
   * Spring into this key (PV-P5a). Wins over `easingBezier` and `easing`.
   * Solved in closed form and normalised in time: the spring's settle time is
   * stretched onto the segment, so the value lands exactly on this key's value
   * on this key's frame, whatever the key spacing. Only the damping ratio and
   * velocity change the SHAPE; stiffness and mass matter through them.
   * Stored values are unvalidated; the sampler clamps.
   */
  spring?: KeyframeSpring
  /**
   * Typed value (PV-P5c): a colour as straight-alpha sRGB `[r, g, b, a]`,
   * each 0..1; `[r, g, b]` reads as alpha 1. Colour channels only (`color`,
   * `shape.fill`, `shape.stroke`, and an `fx.<id>.<param>` colour param); when
   * present, `value` is 0 and unused.
   */
  vec?: number[]
  /**
   * Typed value (PV-P5c): SVG path data for `shape.path`. When present,
   * `value` is 0 and unused.
   */
  path?: string
}

/**
 * A spring for the segment ARRIVING at a key (PV-P5a). When valid it wins over
 * `easingBezier` and `easing`. Solved in closed form and normalised in time:
 * the spring's settle time is stretched onto the segment, so the value lands
 * exactly on this key's value on this key's frame, whatever the key spacing.
 * Only the damping ratio and velocity/ω0 change the SHAPE; stiffness and mass
 * matter through them. Stored values are unvalidated; the sampler clamps.
 */
export interface KeyframeSpring {
  /** Spring constant k. Must be > 0; clamped to 1..10000. */
  stiffness: number
  /** Damping coefficient c. Must be >= 0; raised so the damping ratio is >= 0.05. */
  damping: number
  /** Mass m. Default 1; clamped to 0.01..100. */
  mass?: number
  /**
   * Initial velocity toward the target, in segment-distances per second of
   * spring time. Default 0; clamped to -100..100.
   */
  velocity?: number
}

/**
 * One channel's animation. `source` says where per-frame values come from:
 * keyframes; a tracking asset (reserved); or an expression (PV-P5b), whose
 * `value` is the channel's keyed value (or its authored value when it has no
 * keys). Readers treat an unknown kind as 'keyframes', so an older build plays
 * an expression channel from its keys.
 */
export type KeyframeSource =
  | { kind: 'keyframes' }
  | {
      kind: 'track'
      assetId: string
      channel: string
    }
  /** PV-P5b: evaluated per frame by `resolver/expr`; ≤ 512 characters. */
  | { kind: 'expression'; source: string }

export interface KeyframeChannelTrack {
  source: KeyframeSource
  /** Sorted ascending by `frame`; the sampler tolerates violations. */
  keys: Keyframe[]
}

/** Mask fields a key may drive, as `mask.<field>`. */
export type MaskKeyframeField = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'feather'

/**
 * Every channel a clip may STORE keys on. `KeyframeChannel` stays the nine
 * builtins, because UI code types against that exact list. This adds:
 *   - `time` — time remap, value = source frame (stored and remapped; read
 *     by a later phase)
 *   - `fx.<effectId>.<param>` — one effect parameter
 *   - `mask.<field>` — one mask field
 */
export type AnyKeyframeChannel =
  | KeyframeChannel
  | 'time'
  | `fx.${string}.${string}`
  | `mask.${MaskKeyframeField}`
  /** A generator param (EDX-P9). */
  | `gen.${string}`
  /** Shape draw-on end, 0..1 (EDX-P9). */
  | 'draw'
  /** Shape draw-on start, 0..1 (PQ-2a; with `draw` a travelling window). */
  | 'draw.start'
  /** Text font size, stage px, min 1 (MC-2d; text clips). */
  | 'text.fontSize'
  /** Text letter spacing, px, may be negative (MC-2d; text clips). */
  | 'text.letterSpacing'
  /** Scramble-text progress, 0..1 (MOT-5; text clips with `textScramble`). */
  | 'text.scramble'
  /** Shape stroke width, px, min 0 (MC-2d; shape clips). */
  | 'stroke.width'
  /** Transform anchor, 0..1 and unclamped (MC-2d; any clip with a transform). */
  | 'anchor.x'
  | 'anchor.y'
  /** Progress along the clip's `motionPath`, 0..1 by arc length, overshoot allowed (MOT-1). */
  | 'motion.progress'
  /** Text glyph colour (PV-P5c; `vec` keys). */
  | 'color'
  /** Shape fill / stroke colour (PV-P5c; `vec` keys). */
  | 'shape.fill'
  | 'shape.stroke'
  /** Shape path morph (PV-P5c; `path` keys, `path` shapes only). */
  | 'shape.path'

export interface ClipKeyframes {
  channels: Partial<Record<AnyKeyframeChannel, KeyframeChannelTrack>>
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
  /** When true, the track cannot be removed by the user. */
  protected?: boolean
  /**
   * When `'bottom'`, `addTrack` keeps this lane (and any other pinned-bottom
   * lane) below every non-pinned track rather than appending new tracks
   * after it — the Descript-style layout where video sits on top, freely
   * added tracks land in the middle, and a fixed audio+subtitle bar stays at
   * the very bottom regardless of insertion order.
   */
  pinned?: 'bottom'
  /**
   * `'main'` marks the one video track that is magnetic when the project's
   * `timelineMode` is `'magnetic'` (PV-T1): clips on it insert instead of
   * overwriting and closing a gap ripples everything after it. Only ever set
   * on a video track; ignored in free mode.
   */
  role?: 'main'
  /** Header and lane-edge tint: a label id `label-1`…`label-8` or `#rrggbb`. */
  color?: string
}

/**
 * How the timeline places clips (PV-T1). `'free'` (absent) is the
 * Premiere/Resolve model: every track is free, drops overwrite or insert by
 * the user's choice. `'magnetic'` is the CapCut/Final Cut model: the main
 * track (`Track.role === 'main'`) never has an edit leave a gap, and overlay
 * clips downstream of a ripple move with it.
 */
export type TimelineMode = 'free' | 'magnetic'

/**
 * A set of tracks shown as one collapsible row in the timeline (PV-T1). A
 * view grouping only: stacking and compositing still follow `Track.order`.
 */
export interface TrackGroup {
  id: string
  name: string
  trackIds: string[]
  collapsed: boolean
}

/**
 * The full project state. This is the engine's source of truth.
 * Passed to Immer for structural-sharing mutations.
 * `stage` defines the output canvas dimensions; defaults to 1080×1920 (portrait).
 */
/**
 * Deepest compound nesting a document may hold (PV-P1). The root project is
 * level 0; a compound on it holds a level-1 project; a level-4 project may not
 * contain another compound. The reader refuses deeper documents.
 */
export const MAX_COMPOUND_DEPTH = 4

/**
 * A compound clip's content (PV-P1): a nested project held BY VALUE, with its
 * own tracks, clips, transitions and stage. Its `fps` always equals the
 * parent's (the reader enforces it). Its stage is the compound's natural size:
 * the renderer draws the nested timeline at that size and places the result
 * like an image. `sourceStartFrame` is the nested frame shown at the clip's
 * first frame; `speed` and `time` keys map timeline frames to nested frames
 * exactly as they do for video.
 */
export interface ClipCompound {
  project: Project
}

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
  /** Timeline markers, in any order. Absent = none. */
  markers?: Marker[]
  /**
   * The in/out range (I/O), absolute frames, `out` exclusive. Drives loop
   * playback today and the export range later. Absent = whole timeline.
   */
  inOut?: InOutRange
  /** Placement model (PV-T1). Absent = `'free'`, which is what every older document means. */
  timelineMode?: TimelineMode
  /** Collapsible track groups (PV-T1). Absent = none. */
  trackGroups?: TrackGroup[]
  /**
   * The project as a template (PV-P7): typed props, the clip fields they are
   * bound to, and their current values. Absent = an ordinary project. The
   * renderer never reads it, so it never bumps PROJECT_VERSION.
   */
  composition?: ProjectComposition
  /** Audio analysis summaries, at most one per `src` (PV-P10b). Absent = none. */
  audioMarkers?: AudioMarkerSet[]
  /**
   * The authored document a generated piece came from (EG-P1), kept so a later
   * phase can re-expand it. Never read by the renderer, never bumps PROJECT_VERSION.
   * Absent = an ordinary project.
   */
  authored?: ProjectAuthored
  /**
   * The style kit this project was made in (PQ-2c): an id the host's kit list names. Never read by
   * the renderer, never bumps PROJECT_VERSION. An unknown id is kept (a newer build may know it).
   */
  styleKit?: string
}

/** A marked range of the timeline; `out` is exclusive and always > `in`. */
export interface InOutRange {
  in: FrameCount
  out: FrameCount
}

/**
 * One audio source's analysis summary (PV-P10b): beats, silences and optional
 * envelopes in SOURCE frames counted at `fps`. Keyed by `src`, the one clip
 * field that survives a reload. Written by beat detection; read by the ruler,
 * beat presets, beat ops and `audio.*` expressions. Never drawn as markers.
 */
export interface AudioMarkerSet {
  /** The clip `src` this set describes. */
  src: string
  /** Frames below are counted at this rate. Consumers ignore a set whose fps differs from the project's. */
  fps: number
  /** `ANALYSIS_VERSION` of the analyser that wrote it. */
  version: number
  /** Beats per minute, one decimal. Absent when no steady tempo was found. */
  bpm?: number
  /** Beat frames in the source, ascending integers ≥ 0. */
  beats: number[]
  /** Silent stretches in the source, `[start, end)` frames, ascending. */
  silences: Array<[number, number]>
  /** Base64 of one byte per source frame (0..255 → 0..1). Absent for sources longer than `MAX_ENVELOPE_FRAMES`. */
  envelopes?: { level: string; low: string; mid: string; high: string }
}

/** A track to create up-front when the engine is constructed. */
export interface InitialTrackConfig {
  kind: TrackKind
  /** Display name; falls back to a kind-based default when omitted. */
  name?: string
  /** Height in pixels; falls back to the engine's defaultTrackHeight when omitted. */
  height?: number
  /** When true, the track cannot be removed by the user. */
  protected?: boolean
  /** See `Track.pinned`. */
  pinned?: 'bottom'
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

/**
 * Transition styles. The first three are what version-1/2 documents know;
 * the rest (EDX-P9c) are GPU-only and stamp a document version 3. Labels and
 * capabilities live in `transitions/registry.ts`.
 */
export type TransitionKind =
  | 'fade'
  | 'slide'
  | 'wipe'
  | 'zoom'
  | 'spin'
  | 'whip'
  | 'glitchCut'
  | 'warpDissolve'
  | 'lumaWipe'
export type TransitionEasing = 'linear' | 'ease-in' | 'ease-out'
export type TransitionDirection = 'left' | 'right' | 'up' | 'down'

/**
 * A transition between two adjacent clips on the same track.
 * startFrame marks where the transition begins (before the cut point).
 * The cut is at startFrame + durationFrames / 2 (centered).
 * Both clips are rendered simultaneously during [startFrame, startFrame + durationFrames).
 *
 * Adding a new transition kind = one entry in `transitions/registry.ts` and one
 * branch in the GPU transition shader (`renderer/gpu/transitions.ts`).
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
  /**
   * A whole stored composition replaced the current one (see
   * `TimelineEngine.loadProject`). Distinct from 'change' because a restore is
   * not an edit: it is the new baseline, so anything holding transport state,
   * a selection, or a "saved" marker has to start over rather than diff.
   */
  | 'project:loaded'

/**
 * What the playhead should do when a composition is loaded.
 *
 * `'rewind'` — opening or reloading a document: stop and return to frame 0,
 * because the frame the user was on belonged to a composition that is gone.
 * `'keep'` — a repair pass over the composition already on screen (see
 * `relinkProjectMedia`), where moving the playhead would be an unexplained
 * jump the user did not ask for.
 */
export type LoadProjectTransport = 'rewind' | 'keep'

/**
 * What undo/redo should do when a composition is loaded.
 *
 * `'reset'` — an open or a reload: the document that just arrived *is* the
 * history's starting point, and ctrl+Z must not walk back into the empty
 * timeline that existed before it landed.
 * `'keep'` — a repair pass over the composition already on screen (see
 * `relinkProjectMedia`), which lands an unpredictable stretch of time after the
 * open. By then the user may have trimmed a clip, added a title, or be
 * mid-drag; throwing their undo stack away to swap an internal reference would
 * be a loss they never asked for and cannot explain.
 */
export type LoadProjectHistory = 'reset' | 'keep'

export interface ProjectLoadedEvent {
  project: Project
  transport: LoadProjectTransport
}

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
  'project:loaded': ProjectLoadedEvent
}
