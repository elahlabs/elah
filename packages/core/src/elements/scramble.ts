/**
 * MOT-5: scramble text, the ScrambleTextPlugin equivalent.
 *
 * `scrambleText` is pure: the glyph shown for (seed, glyph index, frame bucket) is a hash, never
 * `Math.random()` or a clock, so any frame paints the same characters whether or not the frame before it was
 * ever rendered (a scrub and a chunked export both need that).
 */

export const SCRAMBLE_PRESETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  symbols: '!<>-_\\/[]{}=+*^?#%&@$',
} as const

export type ScrambleCharsetPreset = keyof typeof SCRAMBLE_PRESETS

export const MAX_SCRAMBLE_CHARSET = 64
export const DEFAULT_SCRAMBLE_CHANGE_EVERY = 2

export function isScramblePreset(id: string): id is ScrambleCharsetPreset {
  return Object.prototype.hasOwnProperty.call(SCRAMBLE_PRESETS, id)
}

/** A preset id or literal charset to the characters it draws from; an empty or oversized literal falls back to `upper`. */
export function resolveScrambleCharset(charset: string | undefined): string {
  if (charset === undefined) return SCRAMBLE_PRESETS.upper
  if (isScramblePreset(charset)) return SCRAMBLE_PRESETS[charset]
  const glyphs = Array.from(charset)
  return glyphs.length === 0 || glyphs.length > MAX_SCRAMBLE_CHARSET ? SCRAMBLE_PRESETS.upper : charset
}

/** Small integer hash (a murmur3-style finaliser over three words); uint32 out. */
export function scrambleHash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

export interface ScrambleOptions {
  /** Preset id or literal string; resolved with `resolveScrambleCharset`. */
  charset?: string
  seed?: number
  /** Frames a noise glyph holds. Default 2. */
  changeEvery?: number
  /** 'spaces' (default) never scrambles whitespace; 'none' scrambles spaces too (newlines are always kept). */
  preserve?: 'spaces' | 'none'
}

/**
 * The string shown at `frame` with `progress` (0 = all noise, 1 = the real text). Non-space glyph i (counting
 * left to right across the whole text) is real once `progress >= (i + 1) / n`, so resolution is monotone: a
 * resolved glyph never reverts as progress rises. Same inputs, same string.
 */
export function scrambleText(text: string, progress: number, frame: number, opts: ScrambleOptions = {}): string {
  const glyphs = Array.from(text)
  const pool = Array.from(resolveScrambleCharset(opts.charset))
  const seed = Number.isFinite(opts.seed) ? Math.trunc(opts.seed as number) : 0
  const hold = Math.max(1, Math.trunc(opts.changeEvery ?? DEFAULT_SCRAMBLE_CHANGE_EVERY) || DEFAULT_SCRAMBLE_CHANGE_EVERY)
  const bucket = Math.floor((Number.isFinite(frame) ? frame : 0) / hold)
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1
  const keepSpaces = opts.preserve !== 'none'
  const scrambles = (g: string): boolean => g !== '\n' && g !== '\r' && (!keepSpaces || !/\s/.test(g))
  let n = 0
  for (const g of glyphs) if (scrambles(g)) n++
  let i = 0
  let out = ''
  for (const g of glyphs) {
    if (!scrambles(g)) {
      out += g
      continue
    }
    i++
    // The epsilon keeps float drift from holding a glyph back at an exact boundary.
    out += p >= i / n - 1e-9 ? g : pool[scrambleHash(seed, i, bucket) % pool.length]!
  }
  return out
}
