/**
 * textAnimation — pure resolution of a clip's entry/exit animation into the two
 * channels every renderer already understands: `opacity` and `Transform`.
 *
 * No React, no DOM, no renderer imports. Deterministic: the same arguments always
 * produce the same sample, which is what lets playback and export agree frame for
 * frame.
 *
 * ---------------------------------------------------------------------------
 * Two ways to describe an animation, one way to sample it
 * ---------------------------------------------------------------------------
 * An end can be described either as a single `TextAnimationKind` enum (`in` /
 * `out`) or as a layered `MotionSpec` (`inMotion` / `outMotion`) that drives
 * opacity, offset, scale and rotation at once with its own easing curve.
 *
 * These are NOT two code paths. `motionForKind` resolves an enum into a
 * `MotionSpec`, and everything below samples specs — so the enum is sugar and
 * cannot drift from the model. The enum remains what the properties panel's
 * Entry/Exit selects write and what every already-saved project contains;
 * `legacyAnimationParity.test.ts` pins it to ~30k recorded samples so that
 * sugar stays bit-for-bit identical to what shipped before the layered model.
 *
 * A layered spec on an end WINS over an enum on the same end.
 *
 * ---------------------------------------------------------------------------
 * Direction semantics (read this before wiring it into the resolver)
 * ---------------------------------------------------------------------------
 * `in` and `out` are NOT mirror images of each other, and the asymmetry is the
 * whole point:
 *
 *   in  — the clip *travels toward* its authored resting position. It starts one
 *         full travel vector away from rest and arrives EXACTLY at rest on the
 *         frame the ramp completes (localFrame === durationFrames).
 *   out — the clip *departs from* rest. It sits at rest until the out ramp
 *         opens, then moves one full travel vector away from it.
 *
 * A kind names the DIRECTION OF TRAVEL, identically for both ends. `slide-up`
 * means "motion in the upward direction" in both cases, so:
 *
 *   in:  'slide-up'  → starts BELOW rest, moves up into rest.
 *   out: 'slide-up'  → starts at rest, moves up and away.
 *
 * Which means a clip with `{ in: 'slide-up', out: 'slide-up' }` drifts upward
 * for its whole life, never reversing. That is intentional. If you want it to
 * leave the way it came, pair `in: 'slide-up'` with `out: 'slide-down'`.
 *
 * ---------------------------------------------------------------------------
 * Coordinate space
 * ---------------------------------------------------------------------------
 * `Transform.x` / `.y` are normalized 0..1 of the stage, origin top-left, and
 * they address the clip's CENTRE for both of the clip types that can carry an
 * animation:
 *   - text  — `computeTextLayout` reads `transform.x/y` as the block centre
 *             (textLayout.ts:169-173).
 *   - shape — `paintShape` reads them as the shape centre (ShapeLayer.ts:58-59).
 * y therefore grows DOWNWARD, so "up" is a negative y delta.
 *
 * Slide distance is expressed in those same normalized units, which means the
 * same constant covers a different number of pixels per axis on a non-square
 * stage (on 1080x1920: 0.15 is 288px vertically but only 162px horizontally).
 * That is accepted — the alternative, correcting for aspect, would make a
 * "slide up" and a "slide left" cover visibly different fractions of the frame.
 *
 * ---------------------------------------------------------------------------
 * The transform-or-nothing rule (a jump bug lives here)
 * ---------------------------------------------------------------------------
 * `Clip.transform === undefined` does not mean "identity" — it means "the
 * renderer applies its own default", and the defaults DIFFER PER CLIP TYPE:
 *
 *   text  — centre (0.5, 0.5), scale 1     (textLayout.ts:152, :169-173)
 *   shape — centre (0.5, 0.5), scale 0.5   (ShapeLayer.ts:58-61, mirrored in
 *                                           ExportWorker.ts:644-649)
 *
 * So the moment we synthesize a transform for a clip that had none, we must
 * reproduce that clip type's default exactly or the clip jumps (a shape would
 * double in size). Hence `defaultTransform` is a REQUIRED argument and the two
 * correct values are exported below — pass `DEFAULT_TEXT_TRANSFORM` for text
 * clips and `DEFAULT_SHAPE_TRANSFORM` for shape clips.
 *
 * For the same reason, a pure-opacity animation (`fade`, or no kinds at all)
 * returns NO transform: leaving the field undefined keeps the renderer default
 * in play, which is strictly safer than re-deriving it.
 */

import type {
  MotionSpec,
  TextAnimation,
  TextAnimationEasing,
  TextAnimationKind,
  Transform,
} from '../types'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How far a `slide-*` kind travels, in normalized stage units (see "Coordinate
 * space" above): 0.15 of stage height for up/down, 0.15 of stage width for
 * left/right.
 *
 * Deliberately a nudge rather than an off-screen entry. Travelling in from off
 * the stage would require knowing the clip's rendered size and its resting
 * position, and this module has neither — a text block's box depends on font
 * metrics that only exist once a 2D context has measured it. A fixed, modest
 * distance is the largest offset that is guaranteed not to strand a clip
 * outside the frame for the length of its ramp.
 */
export const SLIDE_TRAVEL_NORMALIZED = 0.15

/**
 * How far a `spin` kind rotates across the ramp, in radians. Positive is
 * clockwise (see `Transform.rotation`), so an entry starts a quarter turn
 * counter-clockwise from the authored angle and rotates clockwise into it, and
 * an exit carries a further quarter turn clockwise out of it.
 *
 * A quarter turn rather than a full one: at a typical 15-frame ramp a 2*PI spin
 * is a blur, and it reads as a glitch on a clip whose authored rotation is
 * already non-zero.
 */
export const SPIN_TRAVEL_RADIANS = Math.PI / 2

/**
 * The transform a TEXT clip with `transform === undefined` is rendered with
 * today. Stage centre, native glyph size, no rotation.
 * Verified: textLayout.ts:152 (scale ?? 1), :169-173 (centre ?? 0.5/0.5),
 * TextLayer.ts:53 (rotation 0 → identity matrix).
 */
export const DEFAULT_TEXT_TRANSFORM: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
}

/**
 * The transform a SHAPE clip with `transform === undefined` is rendered with
 * today. Note `scale: 0.5` — a shape's scale is a fraction of the stage's short
 * side, and 0.5 is the renderer's default, NOT 1.
 * Verified: ShapeLayer.ts:58-61 (and ExportWorker.ts:644-649, which mirrors it).
 *
 * `anchor` is carried only to satisfy `Transform`; neither the text layer nor
 * the shape layer reads it — both treat x/y as the centre unconditionally.
 */
export const DEFAULT_SHAPE_TRANSFORM: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 0.5,
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
}

// ---------------------------------------------------------------------------
// The kind catalogue (single source of truth for UI option lists)
// ---------------------------------------------------------------------------

/** One selectable entry in an animation picker. */
export interface TextAnimationKindOption {
  kind: TextAnimationKind
  /** Human-readable label, e.g. "Slide Up". */
  label: string
  /**
   * Which clip types may offer this kind. Text-only kinds are the ones no
   * shape renderer can express. `spin` WAS text-only, because neither shape
   * painter read `transform.rotation`; both now rasterize through
   * `shapePaint.paintShape`, which rotates about the box centre, so it applies
   * to both. The field stays because the distinction is still real for any
   * future kind that depends on glyph layout.
   */
  appliesTo: 'both' | 'text-only'
}

/**
 * Keyed by `TextAnimationKind`, so adding a kind to the union is a COMPILE
 * error here until it is described. Declaration order is the UI order —
 * `TEXT_ANIMATION_KINDS` is derived from this object's keys.
 */
const KIND_CATALOGUE: Record<TextAnimationKind, Omit<TextAnimationKindOption, 'kind'>> = {
  fade: { label: 'Fade', appliesTo: 'both' },
  spin: { label: 'Spin', appliesTo: 'both' },
  'slide-up': { label: 'Slide Up', appliesTo: 'both' },
  'slide-down': { label: 'Slide Down', appliesTo: 'both' },
  'slide-left': { label: 'Slide Left', appliesTo: 'both' },
  'slide-right': { label: 'Slide Right', appliesTo: 'both' },
}

/**
 * Every animation kind with its label — the list UI pickers should render, so
 * that an option list can never drift from the union. Ordered as declared in
 * `KIND_CATALOGUE`.
 */
export const TEXT_ANIMATION_KINDS: ReadonlyArray<TextAnimationKindOption> = (
  Object.keys(KIND_CATALOGUE) as TextAnimationKind[]
).map((kind) => ({ kind, ...KIND_CATALOGUE[kind] }))

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** What one frame of an animation resolves to. */
export interface TextAnimationSample {
  /**
   * Animation-driven opacity, 0..1. Independent of the clip's own authored
   * `opacity` — combine them at the call site. `Math.min` reproduces today's
   * fade behaviour exactly.
   */
  opacity: number
  /**
   * The transform to render this frame with, present ONLY when the animation
   * moves or rotates the clip. When absent the caller must leave the clip's own
   * `transform` alone (including leaving it undefined) — see the
   * transform-or-nothing rule in the module doc.
   */
  transform?: Transform
}

export interface SampleTextAnimationArgs {
  /** The clip's `textAnimation` / `shapeAnimation`. `undefined` is a no-op. */
  animation: TextAnimation | undefined
  /** Frames since the clip started: `currentFrame - clip.startFrame`. */
  localFrame: number
  /** The clip's length on the timeline: `clip.durationFrames`. */
  clipDurationFrames: number
  /** The clip's authored transform. `undefined` = author never placed it. */
  transform: Transform | undefined
  /**
   * The transform the renderer would apply to this clip type if `transform` is
   * undefined. Pass `DEFAULT_TEXT_TRANSFORM` for text, `DEFAULT_SHAPE_TRANSFORM`
   * for shapes. Required precisely so it cannot be forgotten.
   */
  defaultTransform: Transform
}

/**
 * Clamp a stored `durationFrames` into a usable ramp length.
 *
 * Nothing validates this field on load — `readClip` spreads stored clip fields
 * through untouched (projectDocument.ts:205) — so 0, a negative, a fraction,
 * `NaN` and `Infinity` all reach us. Every one of them collapses to a whole
 * number of frames >= 1, which is what keeps the divisions below finite.
 * `Infinity` in particular has to be caught: a ramp of infinite length would
 * pin an entry at progress 0 and leave the clip permanently displaced.
 */
export function resolveRampFrames(durationFrames: number): number {
  if (!Number.isFinite(durationFrames)) return 1
  return Math.max(1, Math.floor(durationFrames))
}

/** Displacement + rotation a kind covers over one ramp, in transform units. */
interface KindEffect {
  dx: number
  dy: number
  dRotation: number
  /** True when this kind drives opacity instead of geometry. */
  fades: boolean
}

const NO_EFFECT: KindEffect = { dx: 0, dy: 0, dRotation: 0, fades: false }

/**
 * The travel a kind describes, as a delta applied over one ramp.
 *
 * Exhaustive by construction: the `default` branch assigns `kind` to `never`,
 * so adding a member to `TextAnimationKind` fails to compile here rather than
 * silently rendering as a no-op. That failure mode is exactly what the previous
 * inline `if (anim.in === 'fade')` checks in the resolver had, and designing it
 * out is the point of this module.
 */
function effectForKind(kind: TextAnimationKind): KindEffect {
  switch (kind) {
    case 'fade':
      return { dx: 0, dy: 0, dRotation: 0, fades: true }
    case 'spin':
      return { dx: 0, dy: 0, dRotation: SPIN_TRAVEL_RADIANS, fades: false }
    // y grows downward, so "up" is negative.
    case 'slide-up':
      return { dx: 0, dy: -SLIDE_TRAVEL_NORMALIZED, dRotation: 0, fades: false }
    case 'slide-down':
      return { dx: 0, dy: SLIDE_TRAVEL_NORMALIZED, dRotation: 0, fades: false }
    case 'slide-left':
      return { dx: -SLIDE_TRAVEL_NORMALIZED, dy: 0, dRotation: 0, fades: false }
    case 'slide-right':
      return { dx: SLIDE_TRAVEL_NORMALIZED, dy: 0, dRotation: 0, fades: false }
    default: {
      // Unreachable while the switch is exhaustive. Returning rather than
      // throwing keeps a corrupt stored kind from taking down every frame of
      // playback.
      const unhandled: never = kind
      void unhandled
      return NO_EFFECT
    }
  }
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/**
 * Overshoot magnitude for the `back-*` curves. 1.70158 is the constant Penner's
 * original easing set uses, which overshoots by ~10% — enough to read as a
 * snap-into-place, small enough not to look like a mistake on a text block that
 * is already near the edge of frame.
 */
const BACK_OVERSHOOT = 1.70158

/**
 * Every curve, keyed by name so adding a member to `TextAnimationEasing` is a
 * compile error here until it has an implementation — the same
 * exhaustive-by-construction trick `KIND_CATALOGUE` uses.
 *
 * All take and return progress where 0 is the ramp's start and 1 its end.
 * `back-*` and `elastic-out` deliberately leave 0..1 partway through; callers
 * that cannot tolerate that (opacity) clamp at the point of use.
 */
const EASINGS: Record<TextAnimationEasing, (t: number) => number> = {
  linear: (t) => t,
  'sine-in': (t) => 1 - Math.cos((t * Math.PI) / 2),
  'sine-out': (t) => Math.sin((t * Math.PI) / 2),
  'sine-in-out': (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  'quad-in': (t) => t * t,
  'quad-out': (t) => t * (2 - t),
  'quad-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  'cubic-in': (t) => t ** 3,
  'cubic-out': (t) => 1 - (1 - t) ** 3,
  'cubic-in-out': (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  'quart-in': (t) => t ** 4,
  'quart-out': (t) => 1 - (1 - t) ** 4,
  'quart-in-out': (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  'quint-in': (t) => t ** 5,
  'quint-out': (t) => 1 - (1 - t) ** 5,
  'quint-in-out': (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  'expo-in': (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  // 2^-10t decays to ~0.001 at t=1, so the endpoint is special-cased to land
  // exactly on 1 rather than 0.999 — otherwise an entry never quite arrives.
  'expo-out': (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  'expo-in-out': (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2
  },
  'circ-in': (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
  'circ-out': (t) => Math.sqrt(Math.max(0, 1 - (t - 1) ** 2)),
  'circ-in-out': (t) =>
    t < 0.5
      ? (1 - Math.sqrt(Math.max(0, 1 - (2 * t) ** 2))) / 2
      : (Math.sqrt(Math.max(0, 1 - (-2 * t + 2) ** 2)) + 1) / 2,
  'back-in': (t) => (BACK_OVERSHOOT + 1) * t ** 3 - BACK_OVERSHOOT * t ** 2,
  'back-out': (t) =>
    1 + (BACK_OVERSHOOT + 1) * (t - 1) ** 3 + BACK_OVERSHOOT * (t - 1) ** 2,
  'back-in-out': (t) => {
    const c2 = BACK_OVERSHOOT * 1.525
    return t < 0.5
      ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
      : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
  },
  'elastic-in': (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    return -(2 ** (10 * t - 10)) * Math.sin(((t * 10 - 10.75) * (2 * Math.PI)) / 3)
  },
  'elastic-out': (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // One full oscillation, decaying. Period chosen so the first overshoot is
    // the largest and the clip has visibly settled by the end of the ramp.
    return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1
  },
  'elastic-in-out': (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    const c5 = (2 * Math.PI) / 4.5
    const s = Math.sin((20 * t - 11.125) * c5)
    return t < 0.5 ? -(2 ** (20 * t - 10) * s) / 2 : (2 ** (-20 * t + 10) * s) / 2 + 1
  },
  'bounce-in': (t) => 1 - bounceOut(1 - t),
  'bounce-out': bounceOut,
  'bounce-in-out': (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
}

/** Penner bounce-out (easings.net constants), shared by the three `bounce-*` curves. */
function bounceOut(t: number): number {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) {
    const u = t - 1.5 / d
    return n * u * u + 0.75
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d
    return n * u * u + 0.9375
  }
  const u = t - 2.625 / d
  return n * u * u + 0.984375
}

/**
 * Apply a named curve. An unknown name (a corrupt stored document) falls back to
 * `fallback` — the curve that end would have used had `ease` been omitted —
 * rather than throwing. A wrong-looking ramp is recoverable; a thrown exception
 * inside the resolver takes down every frame of playback.
 */
function ease(name: TextAnimationEasing | undefined, fallback: TextAnimationEasing, t: number): number {
  const fn = EASINGS[name ?? fallback] ?? EASINGS[fallback]
  return fn(t)
}

/** Names of every easing curve, for UI pickers. Ordered as declared. */
export const TEXT_ANIMATION_EASINGS: ReadonlyArray<TextAnimationEasing> = Object.keys(
  EASINGS,
) as TextAnimationEasing[]

/**
 * The one easing table, for other samplers (`resolver/keyframes.ts`). Same
 * unknown-name tolerance as `ease()`: a corrupt name reads as `linear` rather
 * than throwing inside the resolver.
 */
export function evaluateEasing(name: TextAnimationEasing | undefined, t: number): number {
  return ease(name, 'linear', t)
}

// ---------------------------------------------------------------------------
// Enum kind → MotionSpec
// ---------------------------------------------------------------------------

/**
 * Resolve one of the legacy `TextAnimationKind` enums into the layered model, so
 * there is exactly ONE sampling path rather than an old one and a new one
 * drifting apart.
 *
 * `direction` matters because a kind names a DIRECTION OF TRAVEL, and the two
 * ends read that direction differently (see the module doc): an entry starts one
 * travel vector away from rest and moves along it into place, so its extreme is
 * the NEGATED vector; an exit starts at rest and departs along the vector, so
 * its extreme is the vector itself.
 *
 * The easing defaults reproduce the shipped behaviour exactly — geometry eased
 * (out on entry, in on exit), opacity linear. `legacyAnimationParity.test.ts`
 * pins that against 30k recorded samples.
 */
export function motionForKind(kind: TextAnimationKind, direction: 'in' | 'out'): MotionSpec {
  const effect = effectForKind(kind)
  const sign = direction === 'in' ? -1 : 1

  const spec: MotionSpec = {
    ease: direction === 'in' ? 'quad-out' : 'quad-in',
    opacityEase: 'linear',
  }

  if (effect.fades) spec.opacity = 0
  if (effect.dx !== 0) spec.offsetX = effect.dx * sign
  if (effect.dy !== 0) spec.offsetY = effect.dy * sign
  if (effect.dRotation !== 0) spec.rotation = effect.dRotation * sign

  return spec
}

/** True when a spec drives anything the Transform carries. */
function isGeometric(spec: MotionSpec): boolean {
  return (
    (spec.offsetX ?? 0) !== 0 ||
    (spec.offsetY ?? 0) !== 0 ||
    (spec.rotation ?? 0) !== 0 ||
    (spec.scale ?? 1) !== 1
  )
}

/**
 * The spec that governs one end, preferring the layered field over the enum.
 * `undefined` when neither is set, which is what lets a one-ended animation
 * (entry only, no exit) cost nothing.
 */
function specForEnd(
  animation: TextAnimation,
  direction: 'in' | 'out',
): MotionSpec | undefined {
  const layered = direction === 'in' ? animation.inMotion : animation.outMotion
  if (layered) return layered
  const kind = direction === 'in' ? animation.in : animation.out
  return kind ? motionForKind(kind, direction) : undefined
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * Easing. Quadratic, matching `applyEasing` in resolveTimeline.ts:32-37 so the
 * whole codebase accelerates the same way:
 *   ease-out  t*(2-t)   fast then settling
 *   ease-in   t*t       slow then accelerating
 *
 * Applied to GEOMETRY ONLY (position and rotation): an entry decelerates as it
 * lands on its resting spot, an exit accelerates as it leaves — the shape of
 * motion people read as deliberate rather than mechanical.
 *
 * Opacity stays LINEAR on purpose. A linear cross-fade is the convention in
 * video, and more concretely: `fade` is the only kind that existed before this
 * module, its ramp was linear (resolveTimeline.ts:181, :184), and every project
 * already on disk was authored against that curve. Easing opacity would silently
 * restyle all of them.
 */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/**
 * Interpolate from `extreme` toward zero — the rest value for every additive
 * channel (offset, rotation).
 *
 * Written as a single multiply rather than as `lerp(extreme, 0, t)` because the
 * two are not bit-identical in IEEE754, and the enum path's recorded output was
 * produced by exactly this form. `legacyAnimationParity.test.ts` catches it if
 * this drifts back to the general lerp.
 */
function decayToRest(extreme: number, t: number): number {
  return extreme * (1 - t)
}

/**
 * Floor on an animated scale. A scale of exactly 0 collapses the block to
 * nothing — and because the editor overlay hit-tests the same box, it also makes
 * the clip unselectable on those frames, which reads as the clip having
 * vanished from the project. Any pop-in wanting "from nothing" gets this
 * instead, which is visually indistinguishable at one frame.
 */
const MIN_ANIMATED_SCALE = 0.001

/**
 * Resolve one frame of a clip's entry/exit animation.
 *
 * Ramp geometry, matching the fade the resolver already shipped:
 *   - the entry ramp covers `[0, ramp]` of clip-local time and reaches rest at
 *     `localFrame === ramp`;
 *   - the exit ramp covers the last `ramp` frames and reaches full travel at
 *     `localFrame === clipDurationFrames` — one frame past the last frame the
 *     clip is actually drawn on, so the final drawn frame lands just short of
 *     the full departure (the same way today's fade bottoms out at `1/ramp`
 *     rather than 0).
 *
 * When the two ramps overlap on a short clip the opacity ramps take the MINIMUM
 * (preserving the existing fade result) and the travel vectors SUM. Summing is
 * what keeps the motion continuous: the clip passes smoothly through — or near
 * — rest instead of popping between an entry offset and an exit offset at the
 * crossover frame.
 */
export function sampleTextAnimation(args: SampleTextAnimationArgs): TextAnimationSample {
  const { animation } = args

  if (
    !animation ||
    (!animation.in && !animation.out && !animation.inMotion && !animation.outMotion)
  ) {
    return { opacity: 1 }
  }

  const ramp = resolveRampFrames(animation.durationFrames)
  const localFrame = finiteOr(args.localFrame, 0)
  const total = Math.max(0, finiteOr(args.clipDurationFrames, 0))

  const inSpec = specForEnd(animation, 'in')
  const outSpec = specForEnd(animation, 'out')

  // 0 on the clip's first frame, reaching 1 when the entry ramp completes.
  const arrived = clamp01(localFrame / ramp)
  // 1 while the clip is at rest, falling to 0 at the end of the clip.
  const remaining = clamp01((total - localFrame) / ramp)

  let opacity = 1
  // Offsets and rotation SUM across the two ends; scale MULTIPLIES, because a
  // scale channel is a multiplier and 0.8 then 0.8 has to mean 0.64, not 0.6.
  let dx = 0
  let dy = 0
  let dRotation = 0
  let scaleFactor = 1
  let geometric = false

  if (inSpec) {
    // How far into the entry the clip is: 0 at the extreme, 1 at rest.
    const p = ease(inSpec.ease, 'quad-out', arrived)
    if (inSpec.opacity !== undefined) {
      // Opacity is phrased in terms of PRESENCE — how far the clip is toward
      // being fully visible — at both ends, so the two are symmetric and
      // neither round-trips a subtraction. Under the default linear curve the
      // entry reduces to exactly `arrived` and the exit to exactly `remaining`,
      // which is bit-for-bit what shipped before the layered model existed.
      const op = ease(inSpec.opacityEase, 'linear', arrived)
      opacity = Math.min(opacity, clamp01(lerp(inSpec.opacity, 1, op)))
    }
    if (isGeometric(inSpec)) {
      geometric = true
      // Decay from the extreme toward rest — zero for the additive channels,
      // one for the multiplicative scale.
      dx += decayToRest(inSpec.offsetX ?? 0, p)
      dy += decayToRest(inSpec.offsetY ?? 0, p)
      dRotation += decayToRest(inSpec.rotation ?? 0, p)
      scaleFactor *= lerp(inSpec.scale ?? 1, 1, p)
    }
  }

  if (outSpec) {
    // How far into the exit the clip is: 0 at rest, 1 at the extreme.
    const departed = 1 - remaining
    const p = ease(outSpec.ease, 'quad-in', departed)
    if (outSpec.opacity !== undefined) {
      // Presence, not departure — see the matching note on the entry above.
      // `remaining` is 1 at rest and 0 at the clip's end, so this lerps from the
      // extreme back up to full opacity exactly as the entry does.
      const op = ease(outSpec.opacityEase, 'linear', remaining)
      opacity = Math.min(opacity, clamp01(lerp(outSpec.opacity, 1, op)))
    }
    if (isGeometric(outSpec)) {
      geometric = true
      dx += lerp(0, outSpec.offsetX ?? 0, p)
      dy += lerp(0, outSpec.offsetY ?? 0, p)
      dRotation += lerp(0, outSpec.rotation ?? 0, p)
      scaleFactor *= lerp(1, outSpec.scale ?? 1, p)
    }
  }

  if (!geometric) {
    // Pure-opacity animation: emit no transform so a clip that never had one
    // keeps getting the renderer's own default.
    return { opacity }
  }

  const rest = args.transform ?? args.defaultTransform

  return {
    opacity,
    // Spread first so scaleX / scaleY / anchor pass through untouched. The
    // animated fields fall back to the neutral values both layers already use
    // (centre 0.5/0.5, rotation 0, scale 1) if a stored transform carries a
    // non-finite number, so a corrupt document can never turn into a NaN
    // transform here.
    transform: {
      ...rest,
      anchor: { ...rest.anchor },
      x: finiteOr(rest.x, 0.5) + dx,
      y: finiteOr(rest.y, 0.5) + dy,
      rotation: finiteOr(rest.rotation, 0) + dRotation,
      // A scale of exactly 0 would collapse the block to nothing and, worse,
      // makes the clip un-hittable in the editor overlay; floor it just above.
      scale: Math.max(MIN_ANIMATED_SCALE, finiteOr(rest.scale, 1) * scaleFactor),
    },
  }
}
