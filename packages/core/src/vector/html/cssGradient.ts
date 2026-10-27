/**
 * CSS gradient string → engine `Paint` (MC-1a). `vector/gradient.ts` converts
 * gradients described in their own coordinate space; it has no text parser, and
 * the browser hands the scene converter a string (`getComputedStyle`). The
 * engine's linear `Paint` already uses CSS geometry, so this is a thin front end:
 * the only changes are the angle origin (CSS 0deg points up, the engine's 0 points
 * right) and the stop list, which goes through the shared `clipStops`.
 *
 * `conic-gradient` (MC-1d) maps onto the engine's `conic` Paint, which keeps the
 * CSS convention (`from <angle>`, 0 = up) so nothing is converted here.
 *
 * DOM-free. An unparseable gradient is a result, not a throw: the caller reports
 * it as a skipped feature.
 */

import type { Paint } from '../../types'
import { parseCssColor } from '../color'
import { clipStops, type GradientStopIn } from '../gradient'

export type CssGradientResult =
  | { ok: true; paint: Paint; approximations: string[] }
  | { ok: false; reason: string }

interface Box {
  width: number
  height: number
}

/** Split on commas that are not inside parentheses. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/** The text between the outer parentheses of `name(...)`, or null. */
function argsOf(css: string, name: string): string | null {
  const s = css.trim()
  const lower = s.toLowerCase()
  if (!lower.startsWith(name + '(') || !s.endsWith(')')) return null
  return s.slice(name.length + 1, -1)
}

const ANGLE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)$/i

function angleDeg(token: string): number | null {
  const m = ANGLE_RE.exec(token.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  switch (m[2].toLowerCase()) {
    case 'deg':
      return n
    case 'grad':
      return n * 0.9
    case 'rad':
      return (n * 180) / Math.PI
    default:
      return n * 360
  }
}

/** CSS angle (0 = up, clockwise) for `to <side> [<side>]`; corners depend on the box. */
function sideAngle(words: string[], box: Box): number | null {
  const set = new Set(words)
  const v = set.has('top') ? 'top' : set.has('bottom') ? 'bottom' : null
  const h = set.has('left') ? 'left' : set.has('right') ? 'right' : null
  if (v === null && h === null) return null
  if (v !== null && h === null) return v === 'top' ? 0 : 180
  if (h !== null && v === null) return h === 'right' ? 90 : 270
  // A corner: the gradient line is perpendicular to the diagonal that does NOT pass through the corner.
  const w = box.width
  const hh = box.height
  const base = (Math.atan2(hh, w) * 180) / Math.PI // top-right direction (h, -w) as a CSS angle
  if (v === 'top' && h === 'right') return base
  if (v === 'bottom' && h === 'right') return 180 - base
  if (v === 'bottom' && h === 'left') return 180 + base
  return 360 - base
}

interface RawStop {
  color: string
  /** 0..1, or null for "unspecified". */
  pos: number | null
}

function parseStops(args: string[], lineLength: number, conic = false): RawStop[] | null {
  const stops: RawStop[] = []
  for (const arg of args) {
    // A stop is `<color> [<position>]`, possibly with two positions (`red 10% 30%`).
    const parts: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of arg) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (/\s/.test(ch) && depth === 0) {
        if (cur !== '') parts.push(cur)
        cur = ''
      } else cur += ch
    }
    if (cur !== '') parts.push(cur)
    if (parts.length === 0) return null
    const color = parts[0]
    if (parseCssColor(color) === null) return null
    const positions: number[] = []
    for (const p of parts.slice(1)) {
      if (conic) {
        // A conic stop sits at a percentage of the turn or at an angle on it.
        const pct = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(p)
        const deg = pct ? null : angleDeg(p)
        if (!pct && deg === null) return null
        positions.push(pct ? parseFloat(pct[1]) / 100 : (deg as number) / 360)
        continue
      }
      const pm = /^([+-]?(?:\d+\.?\d*|\.\d+))(%|px)$/i.exec(p)
      if (!pm) return null
      const n = parseFloat(pm[1])
      positions.push(pm[2] === '%' ? n / 100 : lineLength > 0 ? n / lineLength : 0)
    }
    if (positions.length > 2) return null
    if (positions.length === 0) stops.push({ color, pos: null })
    else for (const pos of positions) stops.push({ color, pos })
  }
  return stops.length >= 1 ? stops : null
}

/** CSS stop fix-up: ends default to 0 and 1, positions never decrease, gaps spread evenly. */
function resolveStops(raw: RawStop[]): GradientStopIn[] {
  const pos = raw.map((s) => s.pos)
  if (pos[0] === null) pos[0] = 0
  if (pos[pos.length - 1] === null) pos[pos.length - 1] = 1
  let max = -Infinity
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] !== null) {
      max = Math.max(max, pos[i] as number)
      pos[i] = max
    }
  }
  let i = 0
  while (i < pos.length) {
    if (pos[i] !== null) {
      i++
      continue
    }
    const a = i - 1
    let b = i
    while (pos[b] === null) b++
    const from = pos[a] as number
    const to = pos[b] as number
    for (let k = a + 1; k < b; k++) pos[k] = from + ((to - from) * (k - a)) / (b - a)
    i = b + 1
  }
  return raw.map((s, k) => ({ offset: pos[k] as number, color: s.color }))
}

/**
 * Parse `linear-gradient(...)` or `radial-gradient(...)` into a `Paint`.
 * `box` (stage px) is only read for `to <corner>` angles and `px` stop positions;
 * the default is a square. Repeating gradients are not accepted.
 */
export function cssGradientToPaint(css: string, box: Box = { width: 1, height: 1 }): CssGradientResult {
  const con = argsOf(css, 'conic-gradient')
  if (con !== null) return parseConic(con)
  const lin = argsOf(css, 'linear-gradient')
  if (lin !== null) return parseLinear(lin, box)
  const rad = argsOf(css, 'radial-gradient')
  if (rad !== null) return parseRadial(rad, box)
  return { ok: false, reason: 'not a linear-gradient, radial-gradient or conic-gradient' }
}

function parseLinear(inner: string, box: Box): CssGradientResult {
  const args = splitTop(inner, ',')
  let cssAngle = 180 // CSS default: to bottom
  let rest = args
  const first = (args[0] ?? '').toLowerCase()
  const asAngle = angleDeg(first)
  if (asAngle !== null) {
    cssAngle = asAngle
    rest = args.slice(1)
  } else if (first.startsWith('to ')) {
    const a = sideAngle(first.slice(3).split(/\s+/), box)
    if (a === null) return { ok: false, reason: `unreadable direction "${args[0]}"` }
    cssAngle = a
    rest = args.slice(1)
  }
  const engineAngle = ((cssAngle - 90) % 360 + 360) % 360
  const rad = (cssAngle * Math.PI) / 180
  const lineLength = Math.abs(box.width * Math.sin(rad)) + Math.abs(box.height * Math.cos(rad))
  const raw = parseStops(rest, lineLength)
  if (raw === null) return { ok: false, reason: 'unreadable colour stop' }
  const { stops, approximate } = clipStops(resolveStops(raw))
  return {
    ok: true,
    paint: { type: 'linear', angle: engineAngle, stops },
    approximations: approximate ? ['gradient-color'] : [],
  }
}

/** One axis of a gradient centre as a 0..1 fraction of the box: keyword or percentage. */
function posFraction(t: string | undefined, axis: 'x' | 'y'): number | null {
  if (t === undefined) return 0.5
  if (t === 'center') return 0.5
  if (t === (axis === 'x' ? 'left' : 'top')) return 0
  if (t === (axis === 'x' ? 'right' : 'bottom')) return 1
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(t)
  return m ? parseFloat(m[1]) / 100 : null
}

/**
 * `conic-gradient([from <angle>] [at <x> <y>], <stops>)`. The angle is kept as
 * written (CSS: 0 = up, clockwise); stops are fractions of the full turn.
 */
function parseConic(inner: string): CssGradientResult {
  const args = splitTop(inner, ',')
  let angle = 0
  let cx = 0.5
  let cy = 0.5
  let rest = args
  const first = (args[0] ?? '').trim().toLowerCase()
  if (first.startsWith('from ') || first.startsWith('at ')) {
    const m = /^(?:from\s+(\S+))?\s*(?:at\s+(.+))?$/.exec(first)
    if (!m) return { ok: false, reason: `unreadable conic prelude "${args[0]}"` }
    if (m[1] !== undefined) {
      const a = angleDeg(m[1])
      if (a === null) return { ok: false, reason: `unreadable angle "${m[1]}"` }
      angle = a
    }
    if (m[2] !== undefined) {
      const pts = m[2].trim().split(/\s+/)
      const x = posFraction(pts[0], 'x')
      const y = posFraction(pts[1], 'y')
      if (x === null || y === null || pts.length > 2) return { ok: false, reason: `unreadable position "${m[2]}"` }
      cx = x
      cy = y
    }
    rest = args.slice(1)
  }
  const raw = parseStops(rest, 0, true)
  if (raw === null) return { ok: false, reason: 'unreadable colour stop' }
  const { stops, approximate } = clipStops(resolveStops(raw))
  return {
    ok: true,
    paint: { type: 'conic', angle, cx, cy, stops },
    approximations: approximate ? ['gradient-color'] : [],
  }
}

function parseRadial(inner: string, box: Box): CssGradientResult {
  const args = splitTop(inner, ',')
  const approximations: string[] = []
  let cx = 0.5
  let cy = 0.5
  let rest = args
  const first = (args[0] ?? '').toLowerCase()
  if (parseCssColor(first.split(/\s+/)[0] ?? '') === null) {
    // A shape / size / position prelude: `circle farthest-corner at 30% 40%`.
    const atAt = first.indexOf(' at ')
    const atStart = first.startsWith('at ')
    const shapeSize = (atStart ? '' : atAt >= 0 ? first.slice(0, atAt) : first).trim()
    if (shapeSize !== '' && !/^(circle|ellipse)?\s*(farthest-corner)?$/.test(shapeSize)) approximations.push('radial-gradient-size')
    if (/ellipse/.test(shapeSize) || shapeSize === '') {
      if (box.width !== box.height) approximations.push('radial-gradient-elliptical')
    }
    const posText = atStart ? first.slice(3) : atAt >= 0 ? first.slice(atAt + 4) : ''
    if (posText !== '') {
      const pts = posText.trim().split(/\s+/)
      const px = posFraction(pts[0], 'x')
      const py = posFraction(pts[1], 'y')
      if (px === null || py === null) return { ok: false, reason: `unreadable position "${posText}"` }
      cx = px
      cy = py
    }
    rest = args.slice(1)
  }
  const raw = parseStops(rest, Math.hypot(box.width, box.height) / 2)
  if (raw === null) return { ok: false, reason: 'unreadable colour stop' }
  const { stops, approximate } = clipStops(resolveStops(raw))
  if (approximate) approximations.push('gradient-color')
  // The engine's radius is a fraction of half the box diagonal; farthest-corner from (cx, cy) is:
  const w = box.width
  const h = box.height
  const farthest = Math.hypot(Math.max(cx, 1 - cx) * w, Math.max(cy, 1 - cy) * h)
  const half = Math.hypot(w, h) / 2
  const r = half === 0 ? 1 : farthest / half
  return { ok: true, paint: { type: 'radial', cx, cy, r, stops }, approximations }
}
