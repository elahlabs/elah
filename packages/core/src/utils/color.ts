/**
 * Colour maths — pure, DOM-free (PV-P5c).
 *
 * A colour is a straight-alpha sRGB `Rgba` tuple, each component 0..1. This is
 * the ONE parser/formatter every typed colour channel goes through: the
 * sampler stores `Rgba`, the resolver formats it back to a CSS string, and the
 * writer parses whatever the user typed or picked. Keeping it in one place is
 * what makes `parseColor(formatColor(v))` round-trip.
 */

export type Rgba = [number, number, number, number]

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** An array of 3 (alpha defaults to 1) or 4 finite numbers → `Rgba`. Anything else → `undefined`. */
export function toRgba(v: unknown): Rgba | undefined {
  if (!Array.isArray(v) || (v.length !== 3 && v.length !== 4)) return undefined
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  }
  const [r, g, b, a] = v as number[]
  return [r as number, g as number, b as number, a === undefined ? 1 : (a as number)]
}

const NAMED_COLORS: Readonly<Record<string, Rgba>> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
}

const RGB_FN_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/

function hexByte(h: string): number {
  const doubled = h.length === 1 ? h + h : h
  return parseInt(doubled, 16) / 255
}

/**
 * Parse a CSS colour string into `Rgba`. Accepts `transparent`/`black`/`white`
 * (trimmed, case-insensitive), `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, and
 * `rgb()`/`rgba()` with comma or space-separated channels. Anything else,
 * including a non-string, is `undefined` — never a guess.
 */
export function parseColor(css: string | undefined): Rgba | undefined {
  if (typeof css !== 'string') return undefined
  const s = css.trim().toLowerCase()
  if (s === '') return undefined
  const named = NAMED_COLORS[s]
  if (named) return [...named]

  if (s[0] === '#') {
    const hex = s.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return undefined
    if (hex.length === 3) return [hexByte(hex[0]!), hexByte(hex[1]!), hexByte(hex[2]!), 1]
    if (hex.length === 4) return [hexByte(hex[0]!), hexByte(hex[1]!), hexByte(hex[2]!), hexByte(hex[3]!)]
    if (hex.length === 6) return [hexByte(hex.slice(0, 2)), hexByte(hex.slice(2, 4)), hexByte(hex.slice(4, 6)), 1]
    if (hex.length === 8) {
      return [hexByte(hex.slice(0, 2)), hexByte(hex.slice(2, 4)), hexByte(hex.slice(4, 6)), hexByte(hex.slice(6, 8))]
    }
    return undefined
  }

  const m = RGB_FN_RE.exec(s)
  if (!m) return undefined
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  const a = m[4] !== undefined ? Number(m[4]) : 1
  if (![r, g, b, a].every(Number.isFinite)) return undefined
  const clampByte = (n: number) => Math.max(0, Math.min(255, n)) / 255
  return [clampByte(r), clampByte(g), clampByte(b), clamp01(a)]
}

/**
 * `Rgba` → a CSS colour string, deterministic (fixed rounding) so preview and
 * export paint the identical string and the paint signature only changes when
 * the colour does. Opaque colours format as `#rrggbb`; anything with alpha
 * below 1 as `rgba(r, g, b, a)` with alpha rounded to 3 decimals.
 */
export function formatColor(v: ReadonlyArray<number>): string {
  const r = Math.round(clamp01(v[0] ?? 0) * 255)
  const g = Math.round(clamp01(v[1] ?? 0) * 255)
  const b = Math.round(clamp01(v[2] ?? 0) * 255)
  const a = Math.round(clamp01(v[3] ?? 1) * 1000) / 1000
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  if (a >= 1) return `#${hex(r)}${hex(g)}${hex(b)}`
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** The `#rrggbb` of an `Rgba`'s colour, alpha ignored — effect colour params take only hex. */
export function vecToHex(v: ReadonlyArray<number>): string {
  const r = Math.round(clamp01(v[0] ?? 0) * 255)
  const g = Math.round(clamp01(v[1] ?? 0) * 255)
  const b = Math.round(clamp01(v[2] ?? 0) * 255)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Interpolate two colours PREMULTIPLIED, so a fade from `transparent` moves
 * through a fading version of the destination colour rather than through
 * black (component-wise lerp would multiply a zero alpha's arbitrary RGB into
 * the blend). `t` may overshoot 0..1 (a spring, a back-out easing); the result
 * is not clamped here — `formatColor` does that at the end of the pipeline.
 */
export function lerpColor(a: ReadonlyArray<number>, b: ReadonlyArray<number>, t: number): Rgba {
  const aa = a[3] ?? 1
  const ba = b[3] ?? 1
  const pa: Rgba = [(a[0] ?? 0) * aa, (a[1] ?? 0) * aa, (a[2] ?? 0) * aa, aa]
  const pb: Rgba = [(b[0] ?? 0) * ba, (b[1] ?? 0) * ba, (b[2] ?? 0) * ba, ba]
  const o: Rgba = [
    pa[0] + (pb[0] - pa[0]) * t,
    pa[1] + (pb[1] - pa[1]) * t,
    pa[2] + (pb[2] - pa[2]) * t,
    pa[3] + (pb[3] - pa[3]) * t,
  ]
  return o[3] > 1e-6 ? [o[0] / o[3], o[1] / o[3], o[2] / o[3], o[3]] : [0, 0, 0, o[3]]
}
