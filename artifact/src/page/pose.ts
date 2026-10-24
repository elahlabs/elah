/**
 * 2D transform maths for the page -> native conversion (HF-3).
 *
 * The browser is the oracle: for any element and any moment the composite of `translate`, `rotate`, `scale` and
 * `transform` (CSS Transforms 2 order, all about the transform origin) is read from computed style as one 2D
 * affine and decomposed into the five numbers the engine's transform channels hold (translation, rotation,
 * scale x / y). Nothing here parses `@keyframes`; it only reads what the browser already resolved, so mismatched
 * function lists, matrix interpolation and `rotate: 720deg` spins need no special case.
 */

/** [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Aff = [number, number, number, number, number, number]

export const IDENTITY: Aff = [1, 0, 0, 1, 0, 0]

/** `m ∘ n`: apply `n` first, then `m`. */
export function mul(m: Aff, n: Aff): Aff {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export const translateM = (x: number, y: number): Aff => [1, 0, 0, 1, x, y]
export const rotateM = (rad: number): Aff => [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]
export const scaleM = (sx: number, sy: number): Aff => [sx, 0, 0, sy, 0, 0]

/** `T(o) · c · T(-o)`: the linear-plus-translation `c` expressed about the origin `o` in absolute coordinates. */
export function aboutOrigin(c: Aff, ox: number, oy: number): Aff {
  return mul(translateM(ox, oy), mul(c, translateM(-ox, -oy)))
}

/** Inverse of `aboutOrigin`: the composite about `o` that produces the absolute matrix `abs`. */
export function relativeTo(abs: Aff, ox: number, oy: number): Aff {
  return mul(translateM(-ox, -oy), mul(abs, translateM(ox, oy)))
}

export const isIdentity = (m: Aff, eps = 1e-9): boolean =>
  Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps

export interface Pose {
  tx: number
  ty: number
  /** Radians; undefined when the matrix is degenerate (scale 0) and carries no angle. */
  rot: number | undefined
  sx: number
  sy: number
  /** Shear as a fraction of the y scale (0 for a pure rotate + scale). */
  shear: number
}

/** Translation, rotation, scale and shear of a 2D affine (QR style, rotation first). */
export function decompose(m: Aff): Pose {
  const [a, b, c, d, e, f] = m
  let sx = Math.hypot(a, b)
  let rot: number | undefined
  let shear = 0
  let sy: number
  if (sx > 1e-9) {
    rot = Math.atan2(b, a)
    const ua = a / sx
    const ub = b / sx
    const sh = ua * c + ub * d
    const c2 = c - ua * sh
    const d2 = d - ub * sh
    sy = Math.hypot(c2, d2)
    if (a * d - b * c < 0) sy = -sy
    shear = sy !== 0 ? sh / Math.abs(sy) : 0
  } else {
    sy = Math.hypot(c, d)
    if (sy > 1e-9) rot = Math.atan2(-c, d)
    sx = 0
  }
  return { tx: e, ty: f, rot, sx, sy, shear }
}

const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?'

function lengthPx(token: string | undefined, ref: number): number {
  if (token === undefined) return 0
  const m = new RegExp(`^(${NUM})(px|%)?$`).exec(token.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  return m[2] === '%' ? (n / 100) * ref : n
}

function angleRad(token: string): number | null {
  const m = new RegExp(`^(${NUM})(deg|rad|turn|grad)?$`).exec(token.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  switch (m[2]) {
    case 'rad':
      return n
    case 'turn':
      return n * 2 * Math.PI
    case 'grad':
      return (n * Math.PI) / 200
    default:
      return (n * Math.PI) / 180
  }
}

export interface CompositeRead {
  c: Aff
  /** The transform used a 3D feature that a 2D clip cannot hold (rotateX / Y, perspective, z translate). */
  threeD: boolean
  /** Anything in the value the reader could not parse. */
  unreadable: boolean
}

/** Parse a computed `transform` value (`none`, `matrix(...)`, `matrix3d(...)`). */
export function parseTransformValue(value: string): CompositeRead {
  const v = value.trim()
  if (v === '' || v === 'none') return { c: IDENTITY, threeD: false, unreadable: false }
  const m2 = /^matrix\(([^)]*)\)$/.exec(v)
  if (m2) {
    const n = m2[1].split(',').map((s) => parseFloat(s))
    if (n.length === 6 && n.every(Number.isFinite)) return { c: [n[0], n[1], n[2], n[3], n[4], n[5]], threeD: false, unreadable: false }
  }
  const m3 = /^matrix3d\(([^)]*)\)$/.exec(v)
  if (m3) {
    const n = m3[1].split(',').map((s) => parseFloat(s))
    if (n.length === 16 && n.every(Number.isFinite)) {
      const flat = [2, 6, 8, 9, 3, 7, 11].some((i) => Math.abs(n[i]) > 1e-9) || Math.abs(n[10] - 1) > 1e-9 || Math.abs(n[14]) > 1e-9
      return { c: [n[0], n[1], n[4], n[5], n[12], n[13]], threeD: flat, unreadable: false }
    }
  }
  return { c: IDENTITY, threeD: false, unreadable: true }
}

/**
 * The element's composite transform from computed style: `translate · rotate · scale · transform`, about the
 * transform origin (the origin itself is NOT folded in; callers use `aboutOrigin`).
 */
export function readComposite(el: Element, cs: CSSStyleDeclaration): CompositeRead {
  let threeD = false
  let unreadable = false
  const w = el instanceof HTMLElement ? el.offsetWidth : 0
  const h = el instanceof HTMLElement ? el.offsetHeight : 0

  let c: Aff = IDENTITY
  const tr = cs.translate
  if (tr && tr !== 'none') {
    const p = tr.trim().split(/\s+/)
    if (p.length > 2 && lengthPx(p[2], 0) !== 0) threeD = true
    c = mul(c, translateM(lengthPx(p[0], w), lengthPx(p[1], h)))
  }
  const ro = cs.rotate
  if (ro && ro !== 'none') {
    const p = ro.trim().split(/\s+/)
    if (p.length === 1) {
      const a = angleRad(p[0])
      if (a === null) unreadable = true
      else c = mul(c, rotateM(a))
    } else if (p.length === 4) {
      const [x, y, z] = p.slice(0, 3).map(parseFloat)
      const a = angleRad(p[3])
      if (a !== null && x === 0 && y === 0 && z > 0) c = mul(c, rotateM(a))
      else threeD = true
    } else unreadable = true
  }
  const sc = cs.scale
  if (sc && sc !== 'none') {
    const p = sc.trim().split(/\s+/).map(parseFloat)
    if (!p.every(Number.isFinite)) unreadable = true
    else {
      if (p.length > 2 && Math.abs(p[2] - 1) > 1e-9) threeD = true
      c = mul(c, scaleM(p[0], p[1] ?? p[0]))
    }
  }
  const t = parseTransformValue(cs.transform)
  if (t.threeD) threeD = true
  if (t.unreadable) unreadable = true
  c = mul(c, t.c)
  return { c, threeD, unreadable }
}

/** Parse a computed `transform-origin` ("960px 540px", possibly with a z part) to px. */
export function readOrigin(cs: CSSStyleDeclaration, w: number, h: number): { x: number; y: number } {
  const p = (cs.transformOrigin || '').trim().split(/\s+/)
  return { x: lengthPx(p[0], w) || (p[0] === '0px' || p[0] === '0' ? 0 : w / 2), y: lengthPx(p[1], h) || (p[1] === '0px' || p[1] === '0' ? 0 : h / 2) }
}

/** Unwrap a series of angles so consecutive samples differ by less than pi; `start` picks the branch of the first. */
export function unwrapAngles(raw: Array<number | undefined>, start: number): number[] {
  const out: number[] = []
  let prev = start
  for (const r of raw) {
    let v = r === undefined ? prev : r
    if (r !== undefined) {
      // Move v by whole turns so it lands within pi of the previous value.
      v += Math.round((prev - v) / (2 * Math.PI)) * 2 * Math.PI
    }
    out.push(v)
    prev = v
  }
  return out
}