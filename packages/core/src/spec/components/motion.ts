/**
 * The motion toolkit every component builds with (AV-8).
 *
 * ---------------------------------------------------------------------------
 * Why one shared toolkit
 * ---------------------------------------------------------------------------
 * Two components built by two hands with two ideas of "an entrance" read as two
 * designers. A motion designer's work is recognisable by a small, consistent
 * vocabulary applied everywhere: the same arrival curve, the same stagger, the
 * same idle float, exits that are quicker than entrances. That vocabulary lives
 * here, once, and every component in `./library/` speaks it.
 *
 * The craft, in numbers (standard energy; `ctx.t` scales them):
 *   - arrivals 0.45 s, on a spring, from a short travel (40–80 px), never linear
 *   - exits 0.3 s — faster than arrivals, easing IN, slightly shrinking
 *   - siblings stagger 60–90 ms; a list never arrives at once
 *   - nothing holds perfectly still: an idle float of 4–8 px over ~3 s
 *   - hold on screen long enough to read: ~0.3 s + words / 3.5 per second
 *
 * Units are the spec's: seconds, stage fractions for position, px for sizes,
 * degrees for rotation keys. EXPRESSIONS are the exception: they evaluate in
 * ENGINE units (rotation in radians), so the expression helpers here say so.
 *
 * Everything returns plain spec data — `SpecKey[]`, expression strings,
 * `SpecElement`s — so a component is a pure function and a test can read it.
 */

import type { SpecDraw, SpecElement, SpecExpression, SpecKey, SpecFormat } from '../types'
import type { ComponentContext } from './types'

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const ARRIVE_SEC = 0.45
export const EXIT_SEC = 0.3
export const STAGGER_SEC = 0.07
/** The travel of a rise-in, in stage px. */
export const RISE_PX = 56

/** Seconds a line needs on screen to be read: 0.3 s plus 3.5 words a second. */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return 0.3 + words / 3.5
}

/** The start of the `i`th sibling, `step` seconds apart (energy-scaled). */
export function staggerAt(ctx: ComponentContext, start: number, i: number, step = STAGGER_SEC): number {
  return start + ctx.t(step) * i
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Stage px → fraction of width. */
export const fx = (format: SpecFormat, px: number) => px / format.width
/** Stage px → fraction of height. */
export const fy = (format: SpecFormat, px: number) => px / format.height

// ---------------------------------------------------------------------------
// Arrivals and exits — explicit keys, so every one shares the same curves
// ---------------------------------------------------------------------------

export interface ArriveOptions {
  /** Seconds from the element's own start. Default 0. */
  at?: number
  /** Seconds the arrival takes. Default `ARRIVE_SEC`, energy-scaled. */
  duration?: number
}

/**
 * Fade up while rising `RISE_PX` into place on a snappy spring. The workhorse
 * arrival: type, cards, labels.
 */
export function riseIn(ctx: ComponentContext, baseY: number, opts: ArriveOptions = {}): SpecKey[] {
  const at = opts.at ?? 0
  const d = opts.duration ?? ctx.t(ARRIVE_SEC)
  const travel = fy(ctx.format, RISE_PX * (ctx.style.energy === 'bold' ? 1.4 : ctx.style.energy === 'calm' ? 0.7 : 1))
  return [
    { channel: 'opacity', at, value: 0 },
    { channel: 'opacity', at: at + d * 0.6, value: 1, curve: 'cubic-out' },
    { channel: 'y', at, value: baseY + travel },
    { channel: 'y', at: at + d, value: baseY, curve: 'spring:snappy' },
  ]
}

/** Scale up from small with a bounce and a quick fade. Icons, badges, dots, chips. */
export function popIn(ctx: ComponentContext, opts: ArriveOptions & { from?: number } = {}): SpecKey[] {
  const at = opts.at ?? 0
  const d = opts.duration ?? ctx.t(ARRIVE_SEC)
  const from = opts.from ?? (ctx.style.energy === 'calm' ? 0.7 : 0.35)
  return [
    { channel: 'opacity', at, value: 0 },
    { channel: 'opacity', at: at + d * 0.35, value: 1, curve: 'cubic-out' },
    { channel: 'scale', at, value: from },
    { channel: 'scale', at: at + d, value: 1, curve: ctx.style.energy === 'calm' ? 'spring:gentle' : 'spring:bouncy' },
  ]
}

/** Slide in from off-frame along x, settling on a spring. Chips flying in. */
export function flyInX(ctx: ComponentContext, baseX: number, fromX: number, opts: ArriveOptions = {}): SpecKey[] {
  const at = opts.at ?? 0
  const d = opts.duration ?? ctx.t(ARRIVE_SEC * 1.3)
  return [
    { channel: 'opacity', at, value: 0 },
    { channel: 'opacity', at: at + d * 0.25, value: 1, curve: 'cubic-out' },
    { channel: 'x', at, value: fromX },
    { channel: 'x', at: at + d, value: baseX, curve: 'spring:snappy' },
  ]
}

/**
 * Leave: quicker than the arrival, easing IN, shrinking 4 % — so the eye lets
 * go of it before the next thing lands. `endAt` is the element's duration.
 */
export function exitOut(ctx: ComponentContext, endAt: number, opts: { duration?: number } = {}): SpecKey[] {
  const d = opts.duration ?? ctx.t(EXIT_SEC)
  const at = Math.max(0, endAt - d)
  return [
    { channel: 'opacity', at, value: 1 },
    { channel: 'opacity', at: endAt, value: 0, curve: 'quad-in' },
    { channel: 'scale', at, value: 1 },
    { channel: 'scale', at: endAt, value: 0.96, curve: 'quad-in' },
  ]
}

/**
 * Merge key lists for one element, dropping any `scale`/`opacity` key of a later
 * list that lands inside an earlier list's span on the same channel. A pop-in
 * and an exit both key `scale`; they must not interleave.
 */
export function mergeKeys(...lists: SpecKey[][]): SpecKey[] {
  const out: SpecKey[] = []
  const spans = new Map<string, [number, number]>()
  for (const list of lists) {
    const local = new Map<string, [number, number]>()
    for (const k of list) {
      const span = spans.get(k.channel)
      if (span && k.at > span[0] && k.at < span[1]) continue
      out.push(k)
      const l = local.get(k.channel)
      local.set(k.channel, l ? [Math.min(l[0], k.at), Math.max(l[1], k.at)] : [k.at, k.at])
    }
    for (const [ch, s] of local) {
      const prev = spans.get(ch)
      spans.set(ch, prev ? [Math.min(prev[0], s[0]), Math.max(prev[1], s[1])] : s)
    }
  }
  return out.sort((a, b) => (a.channel === b.channel ? a.at - b.at : a.channel < b.channel ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Idle motion — expressions (ENGINE units)
// ---------------------------------------------------------------------------

/**
 * A slow vertical float so nothing on screen is ever perfectly still.
 * `amplitudePx` stage px, `period` seconds, `phase` seconds (offset siblings so
 * a row does not bob in lockstep). On `y`, whose engine unit is a stage fraction.
 */
export function floatY(ctx: ComponentContext, amplitudePx = 6, period = 3.2, phase = 0): SpecExpression {
  const amp = +fy(ctx.format, amplitudePx).toFixed(5)
  return { channel: 'y', source: `value + sin((t + ${+phase.toFixed(3)}) * 2 * PI / ${period}) * ${amp}` }
}

/** A breathing scale, ±`amount` around the keyed value. */
export function breathe(amount = 0.015, period = 4, phase = 0): SpecExpression {
  return { channel: 'scale', source: `value * (1 + ${amount} * sin((t + ${+phase.toFixed(3)}) * 2 * PI / ${period}))` }
}

/** Continuous rotation in DEGREES per second, written in radians for the engine. */
export function spin(degreesPerSecond: number): SpecExpression {
  return { channel: 'rotation', source: `value + t * ${+(degreesPerSecond / 180).toFixed(5)} * PI` }
}

/** A slow push across a whole beat: `amount` = 0.04 is a 4 % zoom. On a `group`, it moves the beat as one camera. */
export function cameraPush(duration: number, amount = 0.04): SpecKey[] {
  return [
    { channel: 'scale', at: 0, value: 1 },
    { channel: 'scale', at: duration, value: 1 + amount, curve: 'smooth' },
  ]
}

// ---------------------------------------------------------------------------
// Drawn strokes
// ---------------------------------------------------------------------------

/** A stroke reveal starting `at` s into the element, over `duration` s. */
export function drawOn(ctx: ComponentContext, at: number, duration = 0.7): SpecDraw {
  return { at, duration: ctx.t(duration), curve: 'cubic-out' }
}

/**
 * A hand-drawn ellipse in a 100×40 viewBox: slightly off-round, not closed, the
 * pen overshooting its start the way a marker does. Seeded, so one spec always
 * draws the same loop.
 */
export function handEllipsePath(random: () => number): string {
  const j = (n: number) => +(n + (random() - 0.5) * 4).toFixed(2)
  return [
    `M ${j(10)} ${j(24)}`,
    `C ${j(6)} ${j(8)}, ${j(48)} ${j(3)}, ${j(86)} ${j(8)}`,
    `C ${j(99)} ${j(12)}, ${j(97)} ${j(31)}, ${j(70)} ${j(36)}`,
    `C ${j(44)} ${j(40)}, ${j(8)} ${j(37)}, ${j(4)} ${j(26)}`,
    `C ${j(2)} ${j(18)}, ${j(12)} ${j(12)}, ${j(24)} ${j(10)}`,
  ].join(' ')
}

/** A loose underline scribble in a 100×12 viewBox. */
export function underlinePath(random: () => number): string {
  const j = (n: number) => +(n + (random() - 0.5) * 2).toFixed(2)
  return `M ${j(2)} ${j(8)} C ${j(30)} ${j(4)}, ${j(60)} ${j(10)}, ${j(98)} ${j(5)}`
}

/**
 * An elbow callout line from a badge to its label, in a viewBox of the given
 * px size: out horizontally, then vertically. `dir` picks the corner.
 */
export function elbowPath(w: number, h: number, dir: 'up-right' | 'up-left' | 'down-right' | 'down-left'): string {
  const [sx, sy, ex, ey] =
    dir === 'up-right' ? [0, h, w, 0] : dir === 'up-left' ? [w, h, 0, 0] : dir === 'down-right' ? [0, 0, w, h] : [w, 0, 0, h]
  const mx = (sx + ex) / 2
  return `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ey} L ${ex} ${ey}`
}

/**
 * Four bracket corners framing a box — the "focus" device. Returns four path
 * elements (one per corner) the caller times and colours.
 */
export function bracketCorners(
  idPrefix: string,
  box: { x: number; y: number; w: number; h: number },
  format: SpecFormat,
  base: Partial<SpecElement> & { at: number; duration: number },
  arm = 40,
): SpecElement[] {
  const corners: Array<[string, number, number, string]> = [
    ['tl', -1, -1, `M 0 ${arm} L 0 0 L ${arm} 0`],
    ['tr', 1, -1, `M 0 0 L ${arm} 0 L ${arm} ${arm}`],
    ['bl', -1, 1, `M 0 0 L 0 ${arm} L ${arm} ${arm}`],
    ['br', 1, 1, `M ${arm} 0 L ${arm} ${arm} L 0 ${arm}`],
  ]
  return corners.map(([name, sx, sy, d]) => ({
    ...base,
    id: `${idPrefix}-${name}`,
    kind: 'shape' as const,
    shape: 'path' as const,
    path: d,
    viewBox: { x: 0, y: 0, width: arm, height: arm },
    w: arm,
    h: arm,
    // Each corner is an arm×arm square whose outer edges sit ON the box corner.
    x: box.x + (sx * (box.w - arm)) / 2 / format.width,
    y: box.y + (sy * (box.h - arm)) / 2 / format.height,
    cap: 'round',
    join: 'round',
  }))
}
