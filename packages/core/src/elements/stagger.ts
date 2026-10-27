/**
 * Rich stagger offsets (MOT-2): GSAP's `stagger: { each, from, grid, ease }` as a pure function. A stagger is only
 * a per-item frame offset, so the result feeds `staggerPresetPatches` and the HTML converter and the output stays
 * native keys.
 */
import { evaluateEasing } from '../resolver/textAnimation'
import type { TextAnimationEasing } from '../types'

export const STAGGER_FROM_NAMES = ['start', 'end', 'center', 'edges', 'random'] as const
export type StaggerFromName = (typeof STAGGER_FROM_NAMES)[number]
/** A name, or the index (with a grid, the row-major cell index) the stagger radiates from. */
export type StaggerFrom = StaggerFromName | number

export interface StaggerOptions {
  /** Frames per unit of distance from the origin. */
  each: number
  from?: StaggerFrom
  /** Spreads the normalised distance (0..1) before it is scaled back to frames. */
  ease?: TextAnimationEasing
  /** Items laid out row-major in `cols` columns; distance becomes Euclidean over (col,row). `rows` defaults to ceil(count/cols). */
  grid?: { cols: number; rows?: number }
  /** Seed for `from: 'random'`. */
  seed?: number
}

export const STAGGER_DEFAULT_SEED = 0x9e3779b1

/** mulberry32: small, fast, and identical on every platform. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seeded random permutation of 0..count-1: item `i` gets rank `perm[i]`. */
function randomRanks(count: number, seed: number): number[] {
  const rnd = prng(seed)
  const perm = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = perm[i]!
    perm[i] = perm[j]!
    perm[j] = tmp
  }
  return perm
}

/** Raw (un-normalised) distance of every item from the origin, in item steps (grid: cells). */
function distances(count: number, from: StaggerFrom, seed: number, grid?: { cols: number; rows?: number }): number[] {
  if (from === 'random') return randomRanks(count, seed)
  const last = count - 1
  if (!grid) {
    return Array.from({ length: count }, (_, i) => {
      if (typeof from === 'number') return Math.abs(i - Math.min(last, Math.max(0, Math.round(from))))
      if (from === 'end') return last - i
      if (from === 'center') return Math.abs(i - last / 2)
      if (from === 'edges') return Math.min(i, last - i)
      return i
    })
  }
  const cols = Math.max(1, Math.round(grid.cols))
  const rows = Math.max(1, Math.round(grid.rows ?? Math.ceil(count / cols)))
  const cell = (i: number): [number, number] => [i % cols, Math.floor(i / cols)]
  if (from === 'edges') {
    // Cells to the nearest outer cell of the grid.
    return Array.from({ length: count }, (_, i) => {
      const [x, y] = cell(i)
      return Math.min(x, cols - 1 - x, y, rows - 1 - y)
    })
  }
  let ox = 0
  let oy = 0
  if (typeof from === 'number') [ox, oy] = cell(Math.min(last, Math.max(0, Math.round(from))))
  else if (from === 'end') [ox, oy] = [cols - 1, rows - 1]
  else if (from === 'center') [ox, oy] = [(cols - 1) / 2, (rows - 1) / 2]
  return Array.from({ length: count }, (_, i) => {
    const [x, y] = cell(i)
    return Math.hypot(x - ox, y - oy)
  })
}

/**
 * Frame offset of each of `count` items. Integer frames, length `count`, never negative. With the defaults (from
 * `start`, no ease, no grid) it is exactly `i * each`, the stagger the converter always had. Otherwise the
 * distance from the origin is normalised by the farthest item, eased, and scaled back by `farthest * each`.
 */
export function staggerOffsets(count: number, opts: StaggerOptions): number[] {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0))
  if (n === 0) return []
  const each = Number.isFinite(opts.each) ? Math.max(0, opts.each) : 0
  const from = opts.from ?? 'start'
  if (from === 'start' && !opts.ease && !opts.grid) return Array.from({ length: n }, (_, i) => Math.round(i * each))
  const dist = distances(n, from, opts.seed ?? STAGGER_DEFAULT_SEED, opts.grid)
  const max = dist.reduce((m, d) => Math.max(m, d), 0)
  return dist.map((d) => {
    if (max === 0) return 0
    const t = opts.ease ? evaluateEasing(opts.ease, d / max) : d / max
    return Math.max(0, Math.round(t * max * each))
  })
}
