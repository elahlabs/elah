/**
 * CSS colour parsing, formatting and mixing — for vector imports (fill/stroke
 * strings from an SVG document) and gradient stop interpolation later
 * (PV-P6b-3). DOM-free: no `CSS.supports`, no canvas round-trip.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Exactly the 20 CSS Level 1/2 colour keywords this importer resolves. */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
}

function parseHex(hexWithHash: string): Rgba | null {
  const hex = hexWithHash.slice(1)
  if (!/^[0-9a-f]+$/.test(hex)) return null

  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    }
  }
  if (hex.length === 4) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: parseInt(hex[3] + hex[3], 16) / 255,
    }
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    }
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    }
  }
  return null
}

function parseChannel(p: string): number | null {
  if (p.endsWith('%')) {
    const v = Number(p.slice(0, -1))
    if (!Number.isFinite(v)) return null
    return Math.round((Math.min(100, Math.max(0, v)) * 255) / 100)
  }
  const v = Number(p)
  if (!Number.isFinite(v)) return null
  return Math.round(Math.min(255, Math.max(0, v)))
}

function parseAlphaPart(p: string): number | null {
  if (p.endsWith('%')) {
    const v = Number(p.slice(0, -1))
    if (!Number.isFinite(v)) return null
    return Math.min(1, Math.max(0, v / 100))
  }
  const v = Number(p)
  if (!Number.isFinite(v)) return null
  return Math.min(1, Math.max(0, v))
}

function parseRgbFn(str: string): Rgba | null {
  const match = /^rgba?\(([^)]*)\)$/.exec(str)
  if (!match) return null

  let inner = match[1].trim()
  let alphaPart: string | null = null
  const slashIdx = inner.indexOf('/')
  if (slashIdx >= 0) {
    alphaPart = inner.slice(slashIdx + 1).trim()
    inner = inner.slice(0, slashIdx).trim()
  }

  let parts: string[]
  if (inner.includes(',')) {
    parts = inner
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '')
  } else {
    parts = inner.split(/\s+/).filter((p) => p !== '')
  }

  if (alphaPart === null && parts.length === 4) {
    alphaPart = parts.pop() ?? null
  }
  if (parts.length !== 3) return null

  const r = parseChannel(parts[0])
  if (r === null) return null
  const g = parseChannel(parts[1])
  if (g === null) return null
  const b = parseChannel(parts[2])
  if (b === null) return null

  let a = 1
  if (alphaPart !== null) {
    const parsedA = parseAlphaPart(alphaPart)
    if (parsedA === null) return null
    a = parsedA
  }

  return { r, g, b, a }
}

/**
 * '#rgb' '#rgba' '#rrggbb' '#rrggbbaa', 'rgb()/rgba()' (comma or space
 * syntax, optional '/ alpha', % channels), 'transparent', 20 named colours.
 * Case-insensitive. Anything else → null.
 */
export function parseCssColor(s: string): Rgba | null {
  const str = s.trim().toLowerCase()
  if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (str.startsWith('#')) return parseHex(str)
  if (str.startsWith('rgb')) return parseRgbFn(str)
  const named = NAMED_COLORS[str]
  if (named) return parseHex(named)
  return null
}

/** a ≥ 1 → '#rrggbb' (lower case); otherwise 'rgba(r, g, b, a)' with a rounded to 3 decimals. */
export function formatCssColor(c: Rgba): string {
  if (c.a >= 1) {
    const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
  }
  const a = Math.round(c.a * 1000) / 1000
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`
}

/**
 * Multiply a colour's alpha. alphaMul ≥ 1 → the input string unchanged.
 * Unparseable → the input string unchanged (the caller records it).
 */
export function withAlpha(color: string, alphaMul: number): string {
  if (alphaMul >= 1) return color
  const c = parseCssColor(color)
  if (!c) return color
  return formatCssColor({ ...c, a: c.a * alphaMul })
}

/** Linear, non-premultiplied; r/g/b rounded. */
export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    a: a.a + (b.a - a.a) * t,
  }
}
