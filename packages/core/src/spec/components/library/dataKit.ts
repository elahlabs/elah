/**
 * Shared helpers for the data/list/group components (AV-8b): stat-ring,
 * stat-bars, big-number, icon-row, badge-callouts, chip-cloud, checklist,
 * testimonial-cards, comparison. `motion.ts` (AV-8, shared with AV-8a) is the
 * toolkit every component speaks; this file is the handful of extra pieces
 * this half of the library needed and AV-8a did not: a counter's params (with
 * `prefix`/`suffix` always explicit — the generator defaults `suffix` to
 * `'+'`, which is wrong on anything that isn't a follower count), estimating
 * a text pill's width for the overlap tests, a margin-safe centring clamp, a
 * row-of-variable-widths layout, and a "reveal from the centre outward"
 * ordering for icon rows and badge arrangements.
 *
 * Candidate for the shared toolkit (recorded in the ticket's Result): a
 * `appearTo`/`disappearFrom` pair — `riseIn`/`popIn`/`exitOut` all assume the
 * element's resting opacity is 1, but a track ring, a divider or a shadow
 * rests at a much lower opacity, and re-deriving that by hand at every call
 * site is exactly the kind of thing `motion.ts` exists to give one answer to.
 */

import type { SpecFormat, SpecKey } from '../../types'
import type { ComponentContext } from '../types'
import { ARRIVE_SEC, EXIT_SEC } from '../motion'

/** Stage fraction kept clear at both edges (see the craft brief's layout section). */
export const MARGIN = 0.06

/** Compositing order, low to high — a higher `layer` draws in front. */
export const LAYER = {
  back: 0,
  mid: 1,
  front: 2,
  label: 3,
  accent: 4,
} as const

/** A pill/text box's width, in stage px — the same estimate the ticket's overlap tests use. */
export function estimateTextWidth(text: string, size: number, padding = 0): number {
  return text.length * size * 0.55 + 2 * padding
}

/** Clamp a box's CENTRE (stage fraction) so its edges stay inside the safe margin. */
export function clampCenter(center: number, halfSizeFrac: number): number {
  const lo = MARGIN + halfSizeFrac
  const hi = 1 - MARGIN - halfSizeFrac
  if (lo > hi) return 0.5
  return Math.min(hi, Math.max(lo, center))
}

export interface CounterOptions {
  from?: number
  decimals?: number
  /** Default '' — the generator's own default is a follower-count '+', wrong for a plain stat. */
  prefix?: string
  suffix?: string
  fontSize: number
  color: string
  /** Fraction of the clip's own length the count animates over. */
  countFraction?: number
}

/** `counter` generator params, with `prefix`/`suffix` ALWAYS explicit (see file doc). */
export function counterParams(to: number, opts: CounterOptions): Array<{ name: string; value: number | string | boolean }> {
  const params: Array<{ name: string; value: number | string | boolean }> = [
    { name: 'from', value: opts.from ?? 0 },
    { name: 'to', value: to },
    { name: 'decimals', value: opts.decimals ?? 0 },
    { name: 'separator', value: true },
    { name: 'prefix', value: opts.prefix ?? '' },
    { name: 'suffix', value: opts.suffix ?? '' },
    { name: 'fontSize', value: opts.fontSize },
    { name: 'color', value: opts.color },
  ]
  if (opts.countFraction !== undefined) params.push({ name: 'countFraction', value: opts.countFraction })
  return params
}

/** Centres (stage px) for boxes of `widths` (stage px), `gap` px apart, centred on `centerPx`. */
export function rowCenters(widths: number[], gap: number, centerPx: number): number[] {
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)
  let cursor = centerPx - total / 2
  const centers: number[] = []
  for (const w of widths) {
    cursor += w / 2
    centers.push(cursor)
    cursor += w / 2 + gap
  }
  return centers
}

/** 0-based reveal rank of index `i` among `n` siblings: centre first, then outward, left before right on ties. */
export function centerOutRank(n: number, i: number): number {
  const mid = (n - 1) / 2
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => {
    const da = Math.abs(a - mid)
    const db = Math.abs(b - mid)
    return da !== db ? da - db : a - b
  })
  return order.indexOf(i)
}

/** Deterministic jitter in `[-amount, amount]` from `ctx.random()`. */
export function jitter(random: () => number, amount: number): number {
  return (random() - 0.5) * 2 * amount
}

/**
 * A stage-px length as a raw `scaleX`/`scaleY` CHANNEL value — NOT the same
 * unit as the `scale` channel. `pixelBox` (units.ts) sets a shape's static
 * `scaleX`/`scaleY` to `w / shortSide` / `h / shortSide` (`transform.scale`
 * defaults to 1, the true uniform multiplier `popIn`/`riseIn` key); keying
 * `scaleX`/`scaleY` directly — the only way to grow a box from one edge via
 * `anchor`, since a uniform `scale` shrinks toward the box's CENTRE — means
 * writing values in that SAME normalisation, not 0..1 of "full size". A key
 * of literal `1` would size the box to the whole short side of the stage.
 */
export function pxToScale(px: number, format: SpecFormat): number {
  return px / Math.min(format.width, format.height)
}

/**
 * Fade (and optionally pop) up to a RESTING opacity below 1 — a track ring at
 * 15%, a divider at 100% but a shadow at 10%. `riseIn`/`popIn` always rest at
 * 1; this is that pair's missing sibling.
 */
export function appearTo(ctx: ComponentContext, target: number, opts: { at?: number; duration?: number; fromScale?: number } = {}): SpecKey[] {
  const at = opts.at ?? 0
  const d = opts.duration ?? ctx.t(ARRIVE_SEC)
  const keys: SpecKey[] = [
    { channel: 'opacity', at, value: 0 },
    { channel: 'opacity', at: at + d, value: target, curve: 'cubic-out' },
  ]
  if (opts.fromScale !== undefined) {
    keys.push({ channel: 'scale', at, value: opts.fromScale }, { channel: 'scale', at: at + d, value: 1, curve: 'spring:gentle' })
  }
  return keys
}

/** The exit half of `appearTo`: fades from `from` (not 1) down to 0, quicker, easing in. */
export function disappearFrom(ctx: ComponentContext, from: number, endAt: number, opts: { duration?: number } = {}): SpecKey[] {
  const d = opts.duration ?? ctx.t(EXIT_SEC)
  const at = Math.max(0, endAt - d)
  return [
    { channel: 'opacity', at, value: from },
    { channel: 'opacity', at: endAt, value: 0, curve: 'quad-in' },
  ]
}
