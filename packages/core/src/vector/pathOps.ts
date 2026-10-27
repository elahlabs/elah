/**
 * SVG path and 2D affine math — parsing, arc→cubic conversion, transforms,
 * exact bounds, serialisation and the rect/ellipse/poly primitives.
 *
 * DOM-free and dependency-free on purpose (PV-P6b-1): every vector importer
 * (SVG now, Lottie later) and the export worker need the same geometry, and
 * neither `Path2D` nor `DOMMatrix` exists in Node or in a worker without a
 * polyfill. This is a full implementation, unlike the approximate walker in
 * `renderer/gpu/layers/pathLength.ts` (chord arcs, no reflection) which stays
 * as it is — that one trades accuracy for being cheap on every paint frame;
 * this one runs once, when a vector asset is imported, so exactness is the
 * only thing that matters.
 */

/** SVG matrix(a b c d e f): x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

/** m ∘ n — apply n first, then m. */
export function multiply(m: Affine, n: Affine): Affine {
  const [ma, mb, mc, md, me, mf] = m
  const [na, nb, nc, nd, ne, nf] = n
  return [
    ma * na + mc * nb,
    mb * na + md * nb,
    ma * nc + mc * nd,
    mb * nc + md * nd,
    ma * ne + mc * nf + me,
    mb * ne + md * nf + mf,
  ]
}

export function applyToPoint(m: Affine, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m
  return [a * x + c * y + e, b * x + d * y + f]
}

/** null when |det| < 1e-12 */
export function invert(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return null
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** a·d − b·c */
export function determinant(m: Affine): number {
  const [a, b, c, d] = m
  return a * d - b * c
}

/** sqrt(|det|) */
export function uniformScale(m: Affine): number {
  return Math.sqrt(Math.abs(determinant(m)))
}

/** atan2(b, a), radians */
export function rotationOf(m: Affine): number {
  return Math.atan2(m[1], m[0])
}

/**
 * Columns orthogonal and of equal length (reflection allowed): circles stay
 * circles, strokes stay uniform.
 */
export function isConformal(m: Affine, eps = 1e-6): boolean {
  const [a, b, c, d] = m
  const s0 = Math.hypot(a, b)
  const s1 = Math.hypot(c, d)
  const lenOk = Math.abs(s0 - s1) <= eps * Math.max(s0, s1, 1)
  const dot = a * c + b * d
  const orthoOk = Math.abs(dot) <= eps * Math.max(s0 * s1, 1)
  return lenOk && orthoOk
}

/** Conformal with det > 0: expressible as translate · rotate · uniform scale. */
export function isSimilarity(m: Affine, eps = 1e-6): boolean {
  return isConformal(m, eps) && determinant(m) > 0
}

export function translation(tx: number, ty: number): Affine {
  return [1, 0, 0, 1, tx, ty]
}

export function scaling(sx: number, sy: number = sx): Affine {
  return [sx, 0, 0, sy, 0, 0]
}

export function rotation(deg: number, cx = 0, cy = 0): Affine {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rot: Affine = [cos, sin, -sin, cos, 0, 0]
  return multiply(multiply(translation(cx, cy), rot), translation(-cx, -cy))
}

function parseNumberList(s: string): number[] | null {
  const trimmed = s.trim()
  if (trimmed === '') return []
  const parts = trimmed.split(/[\s,]+/)
  const nums: number[] = []
  for (const p of parts) {
    if (p === '') continue
    const v = Number(p)
    if (!Number.isFinite(v)) return null
    nums.push(v)
  }
  return nums
}

function transformFnMatrix(name: string, args: number[]): Affine | null {
  switch (name) {
    case 'matrix':
      if (args.length !== 6) return null
      return [args[0], args[1], args[2], args[3], args[4], args[5]]
    case 'translate':
      if (args.length === 1) return translation(args[0], 0)
      if (args.length === 2) return translation(args[0], args[1])
      return null
    case 'scale':
      if (args.length === 1) return scaling(args[0])
      if (args.length === 2) return scaling(args[0], args[1])
      return null
    case 'rotate':
      if (args.length === 1) return rotation(args[0])
      if (args.length === 3) return rotation(args[0], args[1], args[2])
      return null
    case 'skewX':
      if (args.length !== 1) return null
      return [1, 0, Math.tan((args[0] * Math.PI) / 180), 1, 0, 0]
    case 'skewY':
      if (args.length !== 1) return null
      return [1, Math.tan((args[0] * Math.PI) / 180), 0, 1, 0, 0]
    default:
      return null
  }
}

/** SVG `transform` attribute → one matrix; null on any syntax error. */
export function parseTransformList(s: string): Affine | null {
  const str = s.trim()
  if (str === '') return IDENTITY

  const n = str.length
  let i = 0
  const mats: Affine[] = []

  while (i < n) {
    while (i < n && /[\s,]/.test(str[i])) i++
    if (i >= n) break

    const nameStart = i
    while (i < n && /[a-zA-Z]/.test(str[i])) i++
    if (i === nameStart) return null
    const name = str.slice(nameStart, i)

    while (i < n && /\s/.test(str[i])) i++
    if (str[i] !== '(') return null
    i++

    const argsStart = i
    while (i < n && str[i] !== ')') i++
    if (i >= n) return null
    const argsStr = str.slice(argsStart, i)
    i++

    const args = parseNumberList(argsStr)
    if (args === null) return null
    const m = transformFnMatrix(name, args)
    if (m === null) return null
    mats.push(m)
  }

  if (mats.length === 0) return null
  return mats.reduce<Affine>((acc, m) => multiply(acc, m), IDENTITY)
}

export type PathSeg =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'Z' }

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const isPathSep = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === ','

/**
 * Any SVG path string → absolute M/L/C/Z. Stops at the first error and keeps
 * what came before (SVG error rule).
 */
export function parsePathData(d: string): PathSeg[] {
  const s = d
  const n = s.length
  let i = 0

  const skipSep = () => {
    while (i < n && isPathSep(s[i])) i++
  }
  const readNumber = (): number | null => {
    skipSep()
    if (i >= n) return null
    const m = NUMBER_RE.exec(s.slice(i))
    if (!m || m[0] === '') return null
    i += m[0].length
    return Number(m[0])
  }
  const readFlag = (): number | null => {
    skipSep()
    if (i >= n) return null
    const ch = s[i]
    if (ch === '0' || ch === '1') {
      i++
      return ch === '0' ? 0 : 1
    }
    return null
  }

  const segs: PathSeg[] = []
  let curX = 0
  let curY = 0
  let startX = 0
  let startY = 0
  // Reflection state: the absolute control point that S/S or T/T mirror.
  // Meaning depends on prevType — a C/S control for S, a Q/T control for T.
  let prevType: 'M' | 'L' | 'H' | 'V' | 'C' | 'S' | 'Q' | 'T' | 'A' | 'Z' | '' = ''
  let prevCtrlX = 0
  let prevCtrlY = 0

  skipSep()
  if (i >= n) return []
  const first = s[i]
  if (first !== 'M' && first !== 'm') return []
  i++
  let currentCmd = first

  const pushM = (x: number, y: number) => {
    segs.push({ c: 'M', x, y })
    curX = x
    curY = y
    startX = x
    startY = y
    prevType = 'M'
  }
  const pushL = (x: number, y: number, type: 'L' | 'H' | 'V' = 'L') => {
    segs.push({ c: 'L', x, y })
    curX = x
    curY = y
    prevType = type
  }
  const pushC = (x1: number, y1: number, x2: number, y2: number, x: number, y: number, type: 'C' | 'S' | 'Q' | 'T', ctrlX: number, ctrlY: number) => {
    segs.push({ c: 'C', x1, y1, x2, y2, x, y })
    curX = x
    curY = y
    prevType = type
    prevCtrlX = ctrlX
    prevCtrlY = ctrlY
  }
  const pushZ = () => {
    segs.push({ c: 'Z' })
    curX = startX
    curY = startY
    prevType = 'Z'
  }

  const processCommand = (): boolean => {
    const isRelative = currentCmd === currentCmd.toLowerCase()
    const upper = currentCmd.toUpperCase()

    switch (upper) {
      case 'M': {
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        pushM(isRelative ? curX + x : x, isRelative ? curY + y : y)
        return true
      }
      case 'L': {
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        pushL(isRelative ? curX + x : x, isRelative ? curY + y : y, 'L')
        return true
      }
      case 'H': {
        const x = readNumber()
        if (x === null) return false
        pushL(isRelative ? curX + x : x, curY, 'H')
        return true
      }
      case 'V': {
        const y = readNumber()
        if (y === null) return false
        pushL(curX, isRelative ? curY + y : y, 'V')
        return true
      }
      case 'C': {
        const x1 = readNumber()
        if (x1 === null) return false
        const y1 = readNumber()
        if (y1 === null) return false
        const x2 = readNumber()
        if (x2 === null) return false
        const y2 = readNumber()
        if (y2 === null) return false
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        const ax1 = isRelative ? curX + x1 : x1
        const ay1 = isRelative ? curY + y1 : y1
        const ax2 = isRelative ? curX + x2 : x2
        const ay2 = isRelative ? curY + y2 : y2
        const ax = isRelative ? curX + x : x
        const ay = isRelative ? curY + y : y
        pushC(ax1, ay1, ax2, ay2, ax, ay, 'C', ax2, ay2)
        return true
      }
      case 'S': {
        const x2 = readNumber()
        if (x2 === null) return false
        const y2 = readNumber()
        if (y2 === null) return false
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        const ax2 = isRelative ? curX + x2 : x2
        const ay2 = isRelative ? curY + y2 : y2
        const ax = isRelative ? curX + x : x
        const ay = isRelative ? curY + y : y
        const c1x = prevType === 'C' || prevType === 'S' ? 2 * curX - prevCtrlX : curX
        const c1y = prevType === 'C' || prevType === 'S' ? 2 * curY - prevCtrlY : curY
        pushC(c1x, c1y, ax2, ay2, ax, ay, 'S', ax2, ay2)
        return true
      }
      case 'Q': {
        const qx = readNumber()
        if (qx === null) return false
        const qy = readNumber()
        if (qy === null) return false
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        const aqx = isRelative ? curX + qx : qx
        const aqy = isRelative ? curY + qy : qy
        const ax = isRelative ? curX + x : x
        const ay = isRelative ? curY + y : y
        const c1x = curX + (2 / 3) * (aqx - curX)
        const c1y = curY + (2 / 3) * (aqy - curY)
        const c2x = ax + (2 / 3) * (aqx - ax)
        const c2y = ay + (2 / 3) * (aqy - ay)
        pushC(c1x, c1y, c2x, c2y, ax, ay, 'Q', aqx, aqy)
        return true
      }
      case 'T': {
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        const ax = isRelative ? curX + x : x
        const ay = isRelative ? curY + y : y
        const aqx = prevType === 'Q' || prevType === 'T' ? 2 * curX - prevCtrlX : curX
        const aqy = prevType === 'Q' || prevType === 'T' ? 2 * curY - prevCtrlY : curY
        const c1x = curX + (2 / 3) * (aqx - curX)
        const c1y = curY + (2 / 3) * (aqy - curY)
        const c2x = ax + (2 / 3) * (aqx - ax)
        const c2y = ay + (2 / 3) * (aqy - ay)
        pushC(c1x, c1y, c2x, c2y, ax, ay, 'T', aqx, aqy)
        return true
      }
      case 'A': {
        const rx = readNumber()
        if (rx === null) return false
        const ry = readNumber()
        if (ry === null) return false
        const rot = readNumber()
        if (rot === null) return false
        const largeArc = readFlag()
        if (largeArc === null) return false
        const sweep = readFlag()
        if (sweep === null) return false
        const x = readNumber()
        if (x === null) return false
        const y = readNumber()
        if (y === null) return false
        const ax = isRelative ? curX + x : x
        const ay = isRelative ? curY + y : y
        const arcSegs = arcToCubics(curX, curY, rx, ry, rot, largeArc === 1, sweep === 1, ax, ay)
        for (const seg of arcSegs) segs.push(seg)
        curX = ax
        curY = ay
        prevType = 'A'
        return true
      }
      case 'Z':
        pushZ()
        return true
      default:
        return false
    }
  }

  for (;;) {
    if (!processCommand()) break
    skipSep()
    if (i >= n) break
    const ch = s[i]
    if (/[A-Za-z]/.test(ch)) {
      currentCmd = ch
      i++
      continue
    }
    // Implicit repeat: numbers with no command letter repeat the previous
    // command, except M/m repeats as L/l, and Z/z (no arguments) cannot repeat.
    const upper = currentCmd.toUpperCase()
    if (upper === 'Z') break
    if (upper === 'M') currentCmd = currentCmd === 'm' ? 'l' : 'L'
  }

  return segs
}

/**
 * One SVG elliptical arc from (x1, y1) → cubic segments (or one L when a
 * radius is 0; [] when the endpoints coincide). SVG 1.1 implementation notes
 * F.6.5 (endpoint → centre) and F.6.6 (centre → point).
 */
export function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): PathSeg[] {
  if (x1 === x2 && y1 === y2) return []
  let rX = Math.abs(rx)
  let rY = Math.abs(ry)
  if (rX === 0 || rY === 0) return [{ c: 'L', x: x2, y: y2 }]

  const phi = (phiDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  const lambda = (x1p * x1p) / (rX * rX) + (y1p * y1p) / (rY * rY)
  if (lambda > 1) {
    const k = Math.sqrt(lambda)
    rX *= k
    rY *= k
  }

  const rx2 = rX * rX
  const ry2 = rY * rY
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const sq = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den))
  const sign = largeArc === sweep ? -1 : 1
  const cxp = sign * sq * ((rX * y1p) / rY)
  const cyp = sign * sq * ((-rY * x1p) / rX)

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  const ux = (x1p - cxp) / rX
  const uy = (y1p - cyp) / rY
  const vx = (-x1p - cxp) / rX
  const vy = (-y1p - cyp) / rY

  const angleBetween = (aux: number, auy: number, avx: number, avy: number): number => {
    const dot = aux * avx + auy * avy
    const len = Math.hypot(aux, auy) * Math.hypot(avx, avy)
    const a = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)))
    const cross = aux * avy - auy * avx
    return (cross < 0 ? -1 : 1) * a
  }

  const theta1 = angleBetween(1, 0, ux, uy)
  let dTheta = angleBetween(ux, uy, vx, vy)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  const nSegs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9))
  const delta = dTheta / nSegs
  const t = (4 / 3) * Math.tan(delta / 4)

  const map = (ux2: number, uy2: number): [number, number] => [
    cx + rX * cosPhi * ux2 - rY * sinPhi * uy2,
    cy + rX * sinPhi * ux2 + rY * cosPhi * uy2,
  ]

  const segs: PathSeg[] = []
  for (let k = 0; k < nSegs; k++) {
    const a1 = theta1 + k * delta
    const a2 = a1 + delta
    const cosA1 = Math.cos(a1)
    const sinA1 = Math.sin(a1)
    const cosA2 = Math.cos(a2)
    const sinA2 = Math.sin(a2)

    const p1x = cosA1
    const p1y = sinA1
    const p2x = cosA2
    const p2y = sinA2
    const c1x = p1x - t * sinA1
    const c1y = p1y + t * cosA1
    const c2x = p2x + t * sinA2
    const c2y = p2y - t * cosA2

    const [mc1x, mc1y] = map(c1x, c1y)
    const [mc2x, mc2y] = map(c2x, c2y)
    const [mpx, mpy] = map(p2x, p2y)
    segs.push({ c: 'C', x1: mc1x, y1: mc1y, x2: mc2x, y2: mc2y, x: mpx, y: mpy })
  }

  const last = segs[segs.length - 1]
  if (last && last.c === 'C') {
    last.x = x2
    last.y = y2
  }

  return segs
}

export function transformPath(segs: PathSeg[], m: Affine): PathSeg[] {
  return segs.map((seg): PathSeg => {
    if (seg.c === 'Z') return { c: 'Z' }
    if (seg.c === 'M' || seg.c === 'L') {
      const [x, y] = applyToPoint(m, seg.x, seg.y)
      return { c: seg.c, x, y }
    }
    const [x1, y1] = applyToPoint(m, seg.x1, seg.y1)
    const [x2, y2] = applyToPoint(m, seg.x2, seg.y2)
    const [x, y] = applyToPoint(m, seg.x, seg.y)
    return { c: 'C', x1, y1, x2, y2, x, y }
  })
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** Interior roots (0, 1) of the derivative of a single cubic axis. */
function cubicExtremaTs(p0: number, p1: number, p2: number, p3: number): number[] {
  const A = 3 * (-p0 + 3 * p1 - 3 * p2 + p3)
  const B = 6 * (p0 - 2 * p1 + p2)
  const C0 = 3 * (p1 - p0)
  const ts: number[] = []
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) {
      const t = -C0 / B
      if (t > 0 && t < 1) ts.push(t)
    }
    return ts
  }
  const disc = B * B - 4 * A * C0
  if (disc < 0) return ts
  const sq = Math.sqrt(disc)
  const t1 = (-B + sq) / (2 * A)
  const t2 = (-B - sq) / (2 * A)
  if (t1 > 0 && t1 < 1) ts.push(t1)
  if (t2 > 0 && t2 < 1) ts.push(t2)
  return ts
}

/** Exact bounds (cubic extrema included); null when there is no point. */
export function pathBounds(segs: PathSeg[]): { x: number; y: number; width: number; height: number } | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let seen = false
  let curX = 0
  let curY = 0
  let startX = 0
  let startY = 0

  const include = (x: number, y: number) => {
    seen = true
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  for (const seg of segs) {
    if (seg.c === 'M') {
      include(seg.x, seg.y)
      curX = seg.x
      curY = seg.y
      startX = seg.x
      startY = seg.y
    } else if (seg.c === 'L') {
      include(seg.x, seg.y)
      curX = seg.x
      curY = seg.y
    } else if (seg.c === 'C') {
      const x0 = curX
      const y0 = curY
      include(seg.x, seg.y)
      for (const t of cubicExtremaTs(x0, seg.x1, seg.x2, seg.x)) {
        include(cubicAt(x0, seg.x1, seg.x2, seg.x, t), cubicAt(y0, seg.y1, seg.y2, seg.y, t))
      }
      for (const t of cubicExtremaTs(y0, seg.y1, seg.y2, seg.y)) {
        include(cubicAt(x0, seg.x1, seg.x2, seg.x, t), cubicAt(y0, seg.y1, seg.y2, seg.y, t))
      }
      curX = seg.x
      curY = seg.y
    } else {
      curX = startX
      curY = startY
    }
  }

  if (!seen) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 4/3·(√2 − 1): the cubic handle length of a quarter circle. */
export const KAPPA = 0.5522847498307936

function fmtNum(n: number, precision: number): string {
  const rounded = Number(n.toFixed(precision))
  const s = String(rounded)
  return s === '-0' ? '0' : s
}

/** Compact `d`: 'M10 20L30 40C…Z', numbers rounded to `precision` decimals, '-0' written as '0'. */
export function pathToD(segs: PathSeg[], precision = 3): string {
  let out = ''
  for (const seg of segs) {
    if (seg.c === 'Z') {
      out += 'Z'
    } else if (seg.c === 'M' || seg.c === 'L') {
      out += `${seg.c}${fmtNum(seg.x, precision)} ${fmtNum(seg.y, precision)}`
    } else {
      out += `C${fmtNum(seg.x1, precision)} ${fmtNum(seg.y1, precision)} ${fmtNum(seg.x2, precision)} ${fmtNum(seg.y2, precision)} ${fmtNum(seg.x, precision)} ${fmtNum(seg.y, precision)}`
    }
  }
  return out
}

/** Clockwise on screen, like SVG. `w <= 0 || h <= 0` → `[]`. */
export function rectPath(x: number, y: number, w: number, h: number, rx = 0, ry = 0): PathSeg[] {
  if (w <= 0 || h <= 0) return []
  const rX = Math.min(Math.max(rx, 0), w / 2)
  const rY = Math.min(Math.max(ry, 0), h / 2)

  if (rX === 0 || rY === 0) {
    return [
      { c: 'M', x, y },
      { c: 'L', x: x + w, y },
      { c: 'L', x: x + w, y: y + h },
      { c: 'L', x, y: y + h },
      { c: 'Z' },
    ]
  }

  const K = KAPPA
  return [
    { c: 'M', x: x + rX, y },
    { c: 'L', x: x + w - rX, y },
    { c: 'C', x1: x + w - rX + K * rX, y1: y, x2: x + w, y2: y + rY - K * rY, x: x + w, y: y + rY },
    { c: 'L', x: x + w, y: y + h - rY },
    { c: 'C', x1: x + w, y1: y + h - rY + K * rY, x2: x + w - rX + K * rX, y2: y + h, x: x + w - rX, y: y + h },
    { c: 'L', x: x + rX, y: y + h },
    { c: 'C', x1: x + rX - K * rX, y1: y + h, x2: x, y2: y + h - rY + K * rY, x, y: y + h - rY },
    { c: 'L', x, y: y + rY },
    { c: 'C', x1: x, y1: y + rY - K * rY, x2: x + rX - K * rX, y2: y, x: x + rX, y },
    { c: 'Z' },
  ]
}

/** `rx <= 0 || ry <= 0` → `[]`. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathSeg[] {
  if (rx <= 0 || ry <= 0) return []
  const K = KAPPA
  return [
    { c: 'M', x: cx + rx, y: cy },
    { c: 'C', x1: cx + rx, y1: cy + K * ry, x2: cx + K * rx, y2: cy + ry, x: cx, y: cy + ry },
    { c: 'C', x1: cx - K * rx, y1: cy + ry, x2: cx - rx, y2: cy + K * ry, x: cx - rx, y: cy },
    { c: 'C', x1: cx - rx, y1: cy - K * ry, x2: cx - K * rx, y2: cy - ry, x: cx, y: cy - ry },
    { c: 'C', x1: cx + K * rx, y1: cy - ry, x2: cx + rx, y2: cy - K * ry, x: cx + rx, y: cy },
    { c: 'Z' },
  ]
}

/** Fewer than two points → `[]`; `M` then `L`s, `Z` when `close`. */
export function polyPath(points: number[], close: boolean): PathSeg[] {
  if (points.length < 4) return []
  const segs: PathSeg[] = [{ c: 'M', x: points[0], y: points[1] }]
  for (let i = 2; i + 1 < points.length; i += 2) {
    segs.push({ c: 'L', x: points[i], y: points[i + 1] })
  }
  if (close) segs.push({ c: 'Z' })
  return segs
}

/** SVG `points` attribute → flat [x0, y0, x1, y1, …] (odd trailing value dropped). */
export function parsePoints(s: string): number[] {
  const matches = s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []
  const nums = matches.map(Number)
  if (nums.length % 2 !== 0) nums.pop()
  return nums
}
