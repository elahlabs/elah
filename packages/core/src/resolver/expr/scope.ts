/**
 * The expression language's vocabulary and its bounds (PV-P5b-1).
 *
 * This module is the whole attack surface of the language: every name, every
 * function and every limit an expression may reach is named here, once. The
 * tokenizer, parser and evaluator all read these tables rather than each
 * carrying their own copy, because a whitelist that exists in two places is a
 * whitelist that will disagree with itself.
 *
 * Nothing here is JavaScript. An expression is a small, total, deterministic
 * language: no `eval`, no `new Function`, no `with`, no dynamic import, and no
 * clock or randomness (Principle 5 of the plan). A document can therefore be
 * shipped to a stranger's browser and evaluated there with the same result, and
 * a frame can be re-rendered later and produce the same pixels.
 *
 * DOM-free, so the export worker can import it through `resolveTimeline`.
 */

import { BEZIER_PRESETS } from '../../elements/easingPresets'
import { SPRING_PRESETS } from '../../elements/springPresets'
import { TEXT_ANIMATION_EASINGS } from '../textAnimation'

/** A clip as an expression sees it via clip("id or name"): its KEYFRAMED rest at
 *  the current timeline frame (no expressions, so no chains or cycles). Transform
 *  units: x, y 0..1 of the stage; rotation radians; scale multipliers. */
export interface ExprClipView {
  x: number
  y: number
  scale: number
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  /** Timeline seconds. */
  start: number
  /** Seconds. */
  duration: number
}

/** Everything an expression can read. Shared interface — P7a fills `prop`, P10b fills `audio`. */
export interface ExprEnv {
  /** Seconds since the clip's first frame. */
  t: number
  /** Clip-local frame (0 = first frame). */
  frame: number
  fps: number
  /** Clip length in seconds. */
  duration: number
  /** 0 on the first frame, 1 on the last (0 for a 1-frame clip). */
  progress: number
  /** The channel's keyed value at this frame, else its authored value. */
  value: number
  stage: { width: number; height: number }
  clip(id: string): ExprClipView | undefined
  prop?(name: string): number | string | undefined
  audio?(name: string): number | undefined
}

export type ExprErrorCode =
  | 'too-long'
  | 'too-complex'
  | 'syntax'
  | 'unknown-identifier'
  | 'unknown-function'
  | 'unknown-member'
  | 'unknown-easing'
  | 'arity'
  | 'type'
  | 'unknown-clip'
  | 'domain'
  | 'non-finite'
  | 'prop-unavailable'
  | 'audio-unavailable'
  | 'unsupported-channel'

/** One problem, as `Scene.expressionErrors` will carry it (PV-P5b-2). */
export interface ExpressionError {
  clipId: string
  channel: string
  code: ExprErrorCode
  message: string
  pos?: number
}

// --- Bounds -----------------------------------------------------------------

/** Longest source accepted. A keyframe channel is 512 characters of budget, and
 *  anything longer is a paste accident rather than an authored expression. */
export const MAX_EXPRESSION_LENGTH = 512
/** Most AST nodes accepted. Counted WHILE parsing, so a hostile input cannot
 *  build a deep tree before the limit stops it. */
export const MAX_EXPRESSION_NODES = 256
/** Longest string literal. The only strings in the language are names. */
export const MAX_STRING_LITERAL = 64

// --- Identifiers ------------------------------------------------------------

/** Readable names. `stage` is deliberately here: it is legal in the grammar and
 *  rejected by the static check unless it is the object of a `.`. */
export const EXPR_IDENTIFIERS: ReadonlySet<string> = new Set([
  't',
  'frame',
  'fps',
  'duration',
  'progress',
  'value',
  'PI',
  'stage',
])

/** The two fields of `stage`. */
export const STAGE_FIELDS: ReadonlySet<string> = new Set(['width', 'height'])

/** The nine readable fields of a clip view — exactly `ExprClipView`'s keys. */
export const CLIP_VIEW_FIELDS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'start',
  'duration',
])

// --- Functions --------------------------------------------------------------

/**
 * The whole whitelist, as `name → [min, max]` argument counts.
 *
 * Arity is checked at PARSE time, not at runtime: an expression with the wrong
 * number of arguments is a static error, so the resolver can report it once
 * when the document is opened rather than once per frame forever.
 */
export const EXPR_FUNCTIONS: ReadonlyMap<string, readonly [number, number]> = new Map<string, readonly [number, number]>([
  ['sin', [1, 1]],
  ['cos', [1, 1]],
  ['abs', [1, 1]],
  ['floor', [1, 1]],
  ['ceil', [1, 1]],
  ['round', [1, 1]],
  ['sqrt', [1, 1]],
  ['exp', [1, 1]],
  ['log', [1, 1]],
  ['pow', [2, 2]],
  ['min', [1, 8]],
  ['max', [1, 8]],
  ['clamp', [3, 3]],
  ['lerp', [3, 3]],
  ['smoothstep', [3, 3]],
  ['wiggle', [2, 3]],
  ['spring', [1, 4]],
  ['ease', [1, 2]],
  ['loop', [2, 2]],
  ['pingpong', [2, 2]],
  ['pulse', [2, 3]],
  ['clip', [1, 1]],
  ['prop', [1, 1]],
  ['audio', [1, 1]],
])

/**
 * Valid second arguments of `ease()`: a bezier preset id, a named easing, or a
 * spring preset as `spring:<id>`.
 *
 * The spring ids are namespaced rather than bare so `ease(x, "bouncy")` is an
 * error instead of silently meaning something else — a bezier preset is already
 * called `snappy`, so the two vocabularies genuinely collide.
 */
export const EASE_NAMES: ReadonlySet<string> = new Set<string>([
  ...BEZIER_PRESETS.map((p) => p.id),
  ...TEXT_ANIMATION_EASINGS,
  ...SPRING_PRESETS.map((p) => `spring:${p.id}`),
])

/**
 * FNV-1a 32-bit of `${clipId}:${channel}`, unsigned — the `wiggle` seed.
 *
 * Hashing happens ONCE per channel when the document is opened, never inside the
 * evaluator: hashing per call would cost a string walk per channel per frame for
 * no benefit, and the value only has to be stable, not secret.
 *
 * Unsigned (`>>> 0`) because `Math.imul` returns a signed 32-bit int and the
 * sign would make the seed depend on arithmetic representation.
 */
export function seedFor(clipId: string, channel: string): number {
  const key = `${clipId}:${channel}`
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
