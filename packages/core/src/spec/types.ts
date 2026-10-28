/**
 * VideoSpec — the document an AI writes (AV-1a).
 *
 * ---------------------------------------------------------------------------
 * Why this type exists at all
 * ---------------------------------------------------------------------------
 * The engine is already a declarative renderer: a `Project` is JSON, and
 * `resolveTimeline` turns it into pictures. So the honest way to let a model
 * make a whole video is to let it WRITE THE DOCUMENT — not to hand it a menu of
 * canned scenes, and not to make it emit fifty edit ops against eleven fixed
 * screen regions.
 *
 * But a raw `Project` is not writable by a language model, and the reasons are
 * specific and few. This type exists to remove exactly those reasons and
 * nothing else:
 *
 *   - Tracks. A `Project` needs `tracks[]` with eleven fields each, a
 *     `trackId` on every clip, and an `order` that decides compositing. Two
 *     clips that overlap on one track make the engine's `update` visitor THROW,
 *     which would roll back the whole batch. Here: `layer` is a number, and the
 *     compiler packs elements into as many lanes as it takes.
 *   - Frames. Everything in a `Project` is integer frames at the project's fps.
 *     Here: seconds.
 *   - Radians. `Transform.rotation` is radians. Here: degrees.
 *   - Keyframe shape. A key lives at
 *     `keyframes.channels[ch] = { source: { kind }, keys: [{ id, frame, ... }] }`
 *     with stable ids, and an expression is the same structure with
 *     `source: { kind: 'expression', source }` and `keys: []`. Here: a flat list
 *     of `{ channel, at, value, curve }`, and `expressions` as `{ channel,
 *     source }`.
 *   - `sourceStartFrame` / `sourceDurationFrames`, which a generated graphic
 *     must carry but which mean nothing to an author.
 *   - Ids. Every clip, key and track needs one, and references between them
 *     (`layout.anchorTo.clip`, `fitTo.clip`, an expression's `clip("id")`) are
 *     BY CLIP ID — ids the author cannot know before the document is built.
 *     Here: the author names elements, and the compiler rewrites the references.
 *   - Vocabulary. `fontId`, motion presets, reveals, easings, springs,
 *     generators, effects and icons are all open name spaces where a wrong name
 *     is a silent no-op or a crash. Here: every name is checked against the same
 *     registry the prompt is generated from, and a bad one becomes an ISSUE.
 *
 * Everything else about a clip passes through by name, and `raw` is the escape
 * hatch for the rest. When you are tempted to add a field here, first check
 * whether the `Clip` field can simply be spelled the same way — the value of
 * this layer is that it is THIN, and every synonym is a thing that can drift.
 *
 * ---------------------------------------------------------------------------
 * Units, stated once
 * ---------------------------------------------------------------------------
 *   - TIME is seconds. `at` is from the start of the video; inside a `group` it
 *     is from the start of the group. Keyframe `at` is from the start of its own
 *     element.
 *   - POSITION (`x`, `y`) is a FRACTION of the stage, 0..1, naming the element's
 *     anchor point — the same convention as `Transform`. 0.5/0.5 is the centre.
 *   - SIZE (`w`, `h`, `size`, `gap`, `padding`, stroke widths) is PIXELS on the
 *     spec's own `format`, because type and stroke are chosen against a measure,
 *     not a fraction. The compiler converts to the engine's box model.
 *   - ANGLE is degrees, clockwise.
 *   - COLOUR is `#rgb`/`#rrggbb`, or a `$token` naming one in `design.colors`.
 *
 * This file is types and constant name lists only: no logic, no imports from
 * anywhere that could pull the renderer in. `units.ts` owns the conversions and
 * `compile.ts` owns the decisions.
 */

import type { Clip } from '../types'

/** Bumped only for a breaking change to the shape below. */
export const SPEC_VERSION = 1

// ---------------------------------------------------------------------------
// Name lists — closed sets, shared by the compiler, the JSON schema and the
// prompt vocabulary so the three cannot drift.
// ---------------------------------------------------------------------------

/** What an element IS. Note these are spec kinds, not `Clip.type`s: `icon` */
/** compiles to a path shape and `group` compiles to a compound. */
export const SPEC_KINDS = ['text', 'shape', 'icon', 'image', 'audio', 'generator', 'group'] as const
export type SpecKind = (typeof SPEC_KINDS)[number]

/**
 * Shapes an author may ask for. Wider than the engine's `ShapeVariant` by two
 * conveniences the compiler lowers:
 *   - `ellipse` → a `circle` stretched by `scaleX`/`scaleY`
 *   - `arc`     → a `circle` with no fill, a stroke, `draw` keys, and a -90°
 *                 rotation so it starts at twelve o'clock instead of three
 */
export const SPEC_SHAPES = ['rect', 'circle', 'ellipse', 'triangle', 'polygon', 'line', 'path', 'arc'] as const
export type SpecShape = (typeof SPEC_SHAPES)[number]

/**
 * Channels an author may key or drive with an expression.
 *
 * `draw` is here because a stroke reveal is the whole point of several of these
 * pieces, but it CANNOT take an expression — the resolver excludes `time` and
 * `draw` — so `expressions` naming it is an issue, not a silent no-op.
 */
export const SPEC_CHANNELS = [
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'volume',
  'cornerRadius',
  'draw',
] as const
export type SpecChannel = (typeof SPEC_CHANNELS)[number]

/** Channels that may only be keyed, never given an expression. */
export const SPEC_NON_EXPRESSION_CHANNELS: ReadonlyArray<SpecChannel> = ['draw']

/**
 * Font ROLES. An author says `"$serif"` and the design block says which bundled
 * family that is, so one line changes every emphasis word in the piece. A raw
 * font id is also accepted wherever a role is.
 */
export const FONT_ROLES = ['sans', 'serif', 'display', 'mono', 'hand'] as const
export type FontRole = (typeof FONT_ROLES)[number]

export const SPEC_ALIGNS = ['left', 'center', 'right'] as const
export const SPEC_EDGES = ['top', 'bottom', 'left', 'right'] as const
export const SPEC_ANCHOR_ALIGNS = ['start', 'center', 'end'] as const
export const SPEC_CAPS = ['butt', 'round', 'square'] as const
export const SPEC_JOINS = ['miter', 'round', 'bevel'] as const
export const SPEC_ANIMATOR_UNITS = ['char', 'word', 'line'] as const

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export interface SpecFormat {
  width: number
  height: number
  fps: number
}

/** The palette and type choices, named once and referenced as `$name`. */
export interface SpecDesign {
  /** `[{ name: 'accent', value: '#22c55e' }]` — referenced as `"$accent"`. */
  colors?: Array<{ name: string; value: string }>
  /** `[{ role: 'serif', font: 'playfair-display' }]` — referenced as `"$serif"`. */
  fonts?: Array<{ role: string; font: string }>
}

/** A keyframe in author units. */
export interface SpecKey {
  channel: string
  /** Seconds from the start of the element that owns it. */
  at: number
  value: number
  /**
   * A named easing (`cubic-out`), a bezier preset (`overshoot`), or
   * `spring:<id>` (`spring:bouncy`). Describes the segment ARRIVING at this
   * key, which is the engine's convention — so the first key's curve is unused.
   */
  curve?: string
  /** Hold this value until the next key. */
  hold?: boolean
}

export interface SpecExpression {
  channel: string
  /**
   * `resolver/expr` source, <= 512 characters. `clip("other-element-id")`
   * reads another element: the compiler rewrites the id, so write the ELEMENT
   * id, not a clip id.
   */
  source: string
}

export interface SpecEffect {
  kind: string
  preset?: string
  params?: Array<{ name: string; value: number | string | boolean }>
}

export interface SpecLayout {
  /** Sit outside `edge` of another element's box, `gap` px away. */
  anchorTo?: { element: string; edge: string; align?: string; gap?: number }
  /** Stage-edge-to-box-edge distances in px. `left` wins over `right`. */
  pin?: { left?: number; right?: number; top?: number; bottom?: number }
  /** Shapes only: become another element's box grown by `padding` px. */
  fitTo?: { element: string; padding?: number }
}

/** The pill/chip behind a line of text: the engine's text box fields. */
export interface SpecPill {
  fill?: string
  stroke?: string
  strokeWidth?: number
  /** Corner radius in px. Half the height or more reads as a capsule. */
  radius?: number
  padding?: number
}

/** A per-unit reveal: `TextAnimator` in author units. */
export interface SpecReveal {
  /** `typewriter` | `fade` | `rise` | `pop`, per `TEXT_ANIMATOR_PRESETS`. */
  preset: string
  unit?: string
  /** Seconds between units. */
  stagger?: number
  /** Seconds one unit takes to arrive. */
  duration?: number
}

/** A styled run inside one text element. Cannot change the FAMILY — see below. */
export interface SpecSpan {
  start: number
  end: number
  weight?: number | string
  italic?: boolean
  color?: string
}

/** A stroke reveal, in author units: `shapeDraw` plus its `draw` keys. */
export interface SpecDraw {
  /** Where the visible stroke starts, 0..1 along the outline. Default 0. */
  from?: number
  /** Where it ends when fully drawn, 0..1. Default 1. */
  to?: number
  /** Seconds into the element before the stroke begins. Default 0. */
  at?: number
  /** Seconds the stroke takes. Omitted = the element's whole length. */
  duration?: number
  /** Curve of the reveal, as `SpecKey.curve`. */
  curve?: string
}

/**
 * One thing on screen.
 *
 * Deliberately ONE interface rather than a discriminated union, because the
 * JSON schema the model answers with is one flat nullable bag (OpenAI strict
 * mode is happiest that way, and `editorOps.schema.ts` already proves the
 * pattern). `kind` says which fields are read; the compiler reports a field
 * that does not belong to the kind rather than failing.
 */
export interface SpecElement {
  /** Author's own id. Referenced by `anchorTo`, `fitTo` and `clip("...")`. */
  id: string
  kind: SpecKind
  /** Shown on the timeline. Defaults to the text, the icon name or the kind. */
  name?: string

  /** Seconds from the start of the video, or of the group that holds it. */
  at: number
  /** Seconds. */
  duration: number
  /**
   * Compositing order: a HIGHER layer draws in front. The compiler owns the
   * mapping to `Track.order` — do not assume the two run the same way.
   */
  layer?: number

  // --- placement -----------------------------------------------------------
  /** Fraction of stage width, 0..1, of this element's anchor point. */
  x?: number
  /** Fraction of stage height, 0..1. */
  y?: number
  /** The anchor's position inside the element's own box. Default centre. */
  anchor?: { x: number; y: number }
  /** Width in stage px. Shapes, icons and images. */
  w?: number
  /** Height in stage px. */
  h?: number
  /** Multiplied on top of the size above. Default 1. */
  scale?: number
  /** Degrees, clockwise. */
  rotation?: number
  /** 0..1. */
  opacity?: number
  layout?: SpecLayout

  // --- text ----------------------------------------------------------------
  text?: string
  /** A `$role` or a bundled font id. */
  font?: string
  /** 100..900, or `normal` / `bold`. Clamped to the family's real weights. */
  weight?: number | string
  italic?: boolean
  /** Cap height in stage px. */
  size?: number
  color?: string
  align?: string
  letterSpacing?: number
  lineHeight?: number
  /** Wrap width in px. */
  maxWidth?: number
  pill?: SpecPill
  reveal?: SpecReveal
  /**
   * Runs inside `text`. NOTE: a span cannot change the font FAMILY, and every
   * span is ignored while a `reveal` is running. An emphasis word in another
   * face is therefore its own element, anchored to this one.
   */
  spans?: SpecSpan[]
  outline?: { color?: string; width?: number }
  shadow?: { color?: string; blur?: number; offsetX?: number; offsetY?: number }

  // --- shape / icon --------------------------------------------------------
  shape?: SpecShape
  /** `polygon` only, 3..12. A hexagon is `polygon` with 6. */
  sides?: number
  /** `polygon` only: star points when < 1. */
  innerRatio?: number
  /** `path` only: SVG `d` data. */
  path?: string
  /** `path` only: the user space `d` is authored in. Default `0 0 24 24`. */
  viewBox?: { x: number; y: number; width: number; height: number }
  /** A colour, `$token`, or a gradient. */
  fill?: string | SpecPaint
  stroke?: string | SpecPaint
  strokeWidth?: number
  /** Dash pattern in px. */
  dash?: number[]
  cap?: string
  join?: string
  /** Corner radius in px; `rect` only. */
  radius?: number
  draw?: SpecDraw
  /** Icon name from `ICON_NAMES`. */
  icon?: string

  // --- image / audio -------------------------------------------------------
  /** Only ever a URL the brief supplied; the model must not invent one. */
  src?: string
  volume?: number
  fadeIn?: number
  fadeOut?: number

  // --- generator -----------------------------------------------------------
  /** A `GENERATOR_REGISTRY` kind: `counter`, `progressBar`, `particles`, ... */
  generator?: string
  preset?: string
  params?: Array<{ name: string; value: number | string | boolean }>

  // --- motion --------------------------------------------------------------
  /** A motion preset played on the way in, e.g. `pop-in`. */
  enter?: string
  /** A motion preset played on the way out, e.g. `fade-out`. */
  exit?: string
  /** Seconds each ramp takes. Omitted lets the preset decide. */
  enterDuration?: number
  exitDuration?: number
  keys?: SpecKey[]
  expressions?: SpecExpression[]
  effects?: SpecEffect[]
  blend?: string

  // --- structure -----------------------------------------------------------
  /** `group` only: the elements inside, timed relative to the group. */
  children?: SpecElement[]

  /**
   * Fields spread onto the compiled `Clip` last, for anything this type does
   * not spell. Unchecked by design and reported as an `info` issue, so a spec
   * that leans on it is visible rather than mysterious.
   */
  raw?: Partial<Clip>
}

/** A gradient, in the engine's own `Paint` shape minus the solid case. */
export type SpecPaint =
  | { type: 'linear'; angle: number; stops: Array<{ offset: number; color: string }> }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: Array<{ offset: number; color: string }> }

/** A sound effect cue, resolved to a real clip by the client (AV-5). */
export interface SpecSfx {
  /** Seconds. */
  at: number
  /** What to search for: `whoosh`, `pop`, `tick`, `click`, `swoosh`. */
  cue: string
  /** 0..1. Default 0.6 — an effect sits under the piece, not on top of it. */
  gain?: number
}

export interface VideoSpec {
  version?: number
  title?: string
  format: SpecFormat
  /** Seconds. The compiler trusts the elements over this when they disagree. */
  duration: number
  /** A colour or `$token` painted behind everything. */
  background?: string
  design?: SpecDesign
  elements: SpecElement[]
  sfx?: SpecSfx[]
}

// ---------------------------------------------------------------------------
// Compile result
// ---------------------------------------------------------------------------

/**
 * Something the compiler could not honour.
 *
 * `error` — a named thing does not exist (a font, a preset, an icon, a
 *           channel), or a reference points at nothing. The field is dropped
 *           and the element is kept, because half a piece is a better answer
 *           than none and the author can be told exactly what to fix.
 * `warn`  — honoured, but changed: a weight snapped to the family's real
 *           files, a nesting depth flattened, a duration clamped.
 * `info`  — worth saying: a `raw` field was spread.
 *
 * There is no `throw`. A compiler that throws on the fiftieth element of a
 * generated document loses the other forty-nine.
 */
export interface SpecIssue {
  severity: 'error' | 'warn' | 'info'
  /** Dotted path into the spec: `elements[3].keys[1].curve`. */
  path: string
  /** Stable machine code: `unknown-font`, `bad-reference`, `clamped`. */
  code: string
  message: string
}

export interface CompileResult {
  project: import('../types').Project
  issues: SpecIssue[]
  /** Author element id → the clip id it became. */
  elementClipIds: Record<string, string>
  /** Every bundled font the document needs, for `ensureFonts` before preview. */
  fontIds: string[]
}

export interface CompileOptions {
  /** Makes ids deterministic, so two compiles of one spec are comparable. */
  seed?: number
  /** Prefix for generated ids. Default `av`. */
  idPrefix?: string
}
