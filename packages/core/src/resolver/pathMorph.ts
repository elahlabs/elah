/**
 * SVG path morphing (PV-P5c) — a self-contained parser into absolute cubics,
 * plus the linear interpolation and re-serialization a `shape.path` keyframe
 * channel needs.
 *
 * Deliberately its own parser rather than a consumer of `renderer/gpu/layers/
 * pathLength.ts`'s `walkPath`: that walker's visitor never reports which
 * subpath a segment belongs to or whether one closed with `Z`, both of which
 * this module needs to tell two paths' STRUCTURE apart before morphing them.
 * Same tokenizer regex, same command semantics; a length measured by one and
 * a shape measured by the other must still agree on the geometry, which is
 * why `S`/`T` here reflect exactly as `walkPath` documents. Arcs (AGN-P28) are
 * converted with PV-P6b's `arcToCubics`, so a circle written as an arc morphs.
 *
 * Pure, allocation-light, never throws: unparseable input returns `null`.
 */

import { arcToCubics } from '../vector/pathOps'

/** One subpath as absolute cubics: start point, then 6 numbers per segment (c1x c1y c2x c2y x y). */
export interface CubicSubpath {
  x: number
  y: number
  segs: number[]
  closed: boolean
}

const TOKEN_RE = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function isLetter(s: string): boolean {
  return /^[a-zA-Z]$/.test(s)
}

/**
 * Parse `d` into subpaths of absolute cubics. `null` for: no tokens, a number
 * before the first command, a drawing command before any `M`, an unknown
 * command letter, a command short of the numbers it needs, an `A`/`a` whose
 * large-arc or sweep flag is not exactly 0 or 1, or zero subpaths.
 */
export function parsePathToCubics(d: string): CubicSubpath[] | null {
  if (typeof d !== 'string') return null
  const tokens = d.match(TOKEN_RE)
  if (!tokens || tokens.length === 0) return null
  if (!isLetter(tokens[0]!)) return null

  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let everStarted = false
  // The previous segment's second control point and which command family
  // produced it, for `S`/`T` reflection (undefined ⇒ reflect as the current point).
  let lastCtrl: { x: number; y: number } | null = null
  let lastCtrlKind: 'cubic' | 'quad' | null = null

  const subpaths: CubicSubpath[] = []
  let cur: CubicSubpath | null = null

  const readNum = (): number | undefined => {
    if (i >= tokens.length || isLetter(tokens[i]!)) return undefined
    const n = Number(tokens[i]!)
    i++
    return Number.isFinite(n) ? n : undefined
  }

  const addCubic = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number): boolean => {
    if (!cur) return false
    cur.segs.push(c1x, c1y, c2x, c2y, ex, ey)
    x = ex
    y = ey
    return true
  }

  const addLineAsCubic = (ex: number, ey: number): boolean => {
    const c1x = x + (ex - x) / 3
    const c1y = y + (ey - y) / 3
    const c2x = x + (2 * (ex - x)) / 3
    const c2y = y + (2 * (ey - y)) / 3
    return addCubic(c1x, c1y, c2x, c2y, ex, ey)
  }

  while (i < tokens.length) {
    if (isLetter(tokens[i]!)) {
      cmd = tokens[i]!
      i++
    } else if (!cmd) {
      return null
    }

    const rel = cmd === cmd.toLowerCase()
    const upper = cmd.toUpperCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0

    if (upper === 'M') {
      const nx = readNum()
      const ny = readNum()
      if (nx === undefined || ny === undefined) return null
      x = ox + nx
      y = oy + ny
      sx = x
      sy = y
      everStarted = true
      cur = { x, y, segs: [], closed: false }
      subpaths.push(cur)
      lastCtrl = null
      lastCtrlKind = null
      cmd = rel ? 'l' : 'L' // extra pairs after M are L
      continue
    }

    if (!cur) {
      // A drawing command with no subpath open: legal only right after a `Z`
      // (no `M`), which starts a new subpath at the current point.
      if (!everStarted) return null
      cur = { x, y, segs: [], closed: false }
      subpaths.push(cur)
      sx = x
      sy = y
    }

    switch (upper) {
      case 'L': {
        const nx = readNum()
        const ny = readNum()
        if (nx === undefined || ny === undefined || !addLineAsCubic(ox + nx, oy + ny)) return null
        lastCtrl = null
        lastCtrlKind = null
        break
      }
      case 'H': {
        const nx = readNum()
        if (nx === undefined || !addLineAsCubic(ox + nx, y)) return null
        lastCtrl = null
        lastCtrlKind = null
        break
      }
      case 'V': {
        const ny = readNum()
        if (ny === undefined || !addLineAsCubic(x, oy + ny)) return null
        lastCtrl = null
        lastCtrlKind = null
        break
      }
      case 'C': {
        const c1x = readNum()
        const c1y = readNum()
        const c2x = readNum()
        const c2y = readNum()
        const ex = readNum()
        const ey = readNum()
        if ([c1x, c1y, c2x, c2y, ex, ey].some((n) => n === undefined)) return null
        if (!addCubic(ox + c1x!, oy + c1y!, ox + c2x!, oy + c2y!, ox + ex!, oy + ey!)) return null
        lastCtrl = { x: ox + c2x!, y: oy + c2y! }
        lastCtrlKind = 'cubic'
        break
      }
      case 'S': {
        const c2x = readNum()
        const c2y = readNum()
        const ex = readNum()
        const ey = readNum()
        if ([c2x, c2y, ex, ey].some((n) => n === undefined)) return null
        const c1 = lastCtrlKind === 'cubic' && lastCtrl ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y }
        const nc2x = ox + c2x!
        const nc2y = oy + c2y!
        if (!addCubic(c1.x, c1.y, nc2x, nc2y, ox + ex!, oy + ey!)) return null
        lastCtrl = { x: nc2x, y: nc2y }
        lastCtrlKind = 'cubic'
        break
      }
      case 'Q': {
        const qx = readNum()
        const qy = readNum()
        const ex = readNum()
        const ey = readNum()
        if ([qx, qy, ex, ey].some((n) => n === undefined)) return null
        const aqx = ox + qx!
        const aqy = oy + qy!
        const aex = ox + ex!
        const aey = oy + ey!
        const c1x = x + (2 / 3) * (aqx - x)
        const c1y = y + (2 / 3) * (aqy - y)
        const c2x = aex + (2 / 3) * (aqx - aex)
        const c2y = aey + (2 / 3) * (aqy - aey)
        if (!addCubic(c1x, c1y, c2x, c2y, aex, aey)) return null
        lastCtrl = { x: aqx, y: aqy }
        lastCtrlKind = 'quad'
        break
      }
      case 'T': {
        const ex = readNum()
        const ey = readNum()
        if (ex === undefined || ey === undefined) return null
        const reflected: { x: number; y: number } =
          lastCtrlKind === 'quad' && lastCtrl ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y }
        const aex = ox + ex
        const aey = oy + ey
        const c1x = x + (2 / 3) * (reflected.x - x)
        const c1y = y + (2 / 3) * (reflected.y - y)
        const c2x = aex + (2 / 3) * (reflected.x - aex)
        const c2y = aey + (2 / 3) * (reflected.y - aey)
        if (!addCubic(c1x, c1y, c2x, c2y, aex, aey)) return null
        lastCtrl = { x: reflected.x, y: reflected.y }
        lastCtrlKind = 'quad'
        break
      }
      case 'A': {
        const rx = readNum()
        const ry = readNum()
        const rot = readNum()
        const large = readNum()
        const sweep = readNum()
        const ex = readNum()
        const ey = readNum()
        if ([rx, ry, rot, large, sweep, ex, ey].some((n) => n === undefined)) return null
        // SVG allows the flags unseparated (`0 11 49.9` is flags 1, 1 then x 49.9), but this tokenizer
        // would read that as `11`. Refuse any flag that is not exactly 0 or 1 rather than guess at a form
        // we cannot split correctly.
        if ((large !== 0 && large !== 1) || (sweep !== 0 && sweep !== 1)) return null
        // Relative `a` offsets the END POINT only; radii and rotation are never offset.
        const aex = ox + ex!
        const aey = oy + ey!
        for (const seg of arcToCubics(x, y, rx!, ry!, rot!, large === 1, sweep === 1, aex, aey)) {
          if (seg.c === 'C') {
            if (!addCubic(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y)) return null
          } else if (seg.c === 'L') {
            if (!addLineAsCubic(seg.x, seg.y)) return null
          }
        }
        // An arc between coincident points is a no-op: nothing appended, the point stays put.
        lastCtrl = null
        lastCtrlKind = null
        break
      }
      case 'Z': {
        cur.closed = true
        x = sx
        y = sy
        lastCtrl = null
        lastCtrlKind = null
        cmd = ''
        cur = null
        break
      }
      default:
        return null
    }
  }

  return subpaths.length > 0 ? subpaths : null
}

/** True when `a` and `b` have the same subpath count and, per subpath, the same segment count and closedness. */
export function sameStructure(a: ReadonlyArray<CubicSubpath>, b: ReadonlyArray<CubicSubpath>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.segs.length !== b[i]!.segs.length) return false
    if (a[i]!.closed !== b[i]!.closed) return false
  }
  return true
}

/**
 * One cubic as 8 numbers: start x y, then c1x c1y c2x c2y, then end x y.
 * Used by `splitCubicAt`; the parsed form stores only the 6 trailing numbers.
 */
export type CubicPoints = [number, number, number, number, number, number, number, number]

/**
 * De Casteljau split of one cubic at `t`. EXACT: the two halves draw the very
 * same curve as the original (first half over `t' = u / t`, second over the rest).
 */
export function splitCubicAt(seg: ReadonlyArray<number>, t: number): [CubicPoints, CubicPoints] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = seg as CubicPoints
  const lerp = (a: number, b: number) => a + (b - a) * t
  const ax = lerp(x0, x1)
  const ay = lerp(y0, y1)
  const bx = lerp(x1, x2)
  const by = lerp(y1, y2)
  const cx = lerp(x2, x3)
  const cy = lerp(y2, y3)
  const dx = lerp(ax, bx)
  const dy = lerp(ay, by)
  const ex = lerp(bx, cx)
  const ey = lerp(by, cy)
  const fx = lerp(dx, ex)
  const fy = lerp(dy, ey)
  return [
    [x0, y0, ax, ay, dx, dy, fx, fy],
    [fx, fy, ex, ey, cx, cy, x3, y3],
  ]
}

export type Reconciled =
  | { ok: true; a: CubicSubpath[]; b: CubicSubpath[] }
  | { ok: false; reason: string }

/** Past this many segments summed across subpaths, a pair is refused rather than reconciled. */
const MAX_RECONCILED_SEGMENTS = 512
/** Rings longer than this skip the rotation/winding search (it is O(n²) per subpath; 64 is far past anything authored). */
const MAX_CORRESPONDENCE_SEGMENTS = 64

function cloneSub(p: CubicSubpath): CubicSubpath {
  return { x: p.x, y: p.y, segs: p.segs.slice(), closed: p.closed }
}

/** The end point of a subpath (its start when it has no segments). */
function endOf(p: CubicSubpath): [number, number] {
  const n = p.segs.length
  return n === 0 ? [p.x, p.y] : [p.segs[n - 2]!, p.segs[n - 1]!]
}

/** Append a straight cubic from the current end to (ex, ey). */
function appendLine(p: CubicSubpath, ex: number, ey: number): void {
  const [x, y] = endOf(p)
  p.segs.push(x + (ex - x) / 3, y + (ey - y) / 3, x + (2 * (ex - x)) / 3, y + (2 * (ey - y)) / 3, ex, ey)
}

function bboxDiagonal(p: CubicSubpath): number {
  let minX = p.x
  let maxX = p.x
  let minY = p.y
  let maxY = p.y
  for (let i = 0; i < p.segs.length; i += 2) {
    const x = p.segs[i]!
    const y = p.segs[i + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return Math.hypot(maxX - minX, maxY - minY)
}

/**
 * Centroid for a degenerate partner: the mean of the subpath's anchor points, i.e. its start plus
 * every segment's END anchor (control points are not anchors). On a closed ring whose last end
 * coincides with the start, that duplicated start is counted once.
 */
function centroid(p: CubicSubpath): [number, number] {
  let sx = p.x
  let sy = p.y
  let n = 1
  const segCount = p.segs.length / 6
  for (let i = 0; i < segCount; i++) {
    const ex = p.segs[i * 6 + 4]!
    const ey = p.segs[i * 6 + 5]!
    if (p.closed && i === segCount - 1 && Math.hypot(ex - p.x, ey - p.y) < 1e-6) continue
    sx += ex
    sy += ey
    n++
  }
  return [sx / n, sy / n]
}

/** A subpath with `segCount` segments, all of whose points sit at (x, y). */
function degenerate(x: number, y: number, segCount: number, closed: boolean): CubicSubpath {
  const segs: number[] = []
  for (let i = 0; i < segCount; i++) segs.push(x, y, x, y, x, y)
  return { x, y, segs, closed }
}

/** A closed ring needs its closing edge as a real segment so rotation and winding are well defined (`Z` draws it but adds none). */
function closeExplicitly(p: CubicSubpath): void {
  if (p.segs.length === 0) return
  const [x, y] = endOf(p)
  if (Math.hypot(x - p.x, y - p.y) >= 1e-6) appendLine(p, p.x, p.y)
}

/** Split the currently longest segment (chord between its anchors, lowest index on ties) until there are `target`. */
function raiseSegments(p: CubicSubpath, target: number): void {
  while (p.segs.length / 6 < target) {
    const n = p.segs.length / 6
    if (n === 0) {
      // A bare `M` has nothing to split: grow it into zero-length segments at its point.
      p.segs.push(p.x, p.y, p.x, p.y, p.x, p.y)
      continue
    }
    let best = 0
    let bestLen = -1
    let px = p.x
    let py = p.y
    for (let i = 0; i < n; i++) {
      const ex = p.segs[i * 6 + 4]!
      const ey = p.segs[i * 6 + 5]!
      const len = Math.hypot(ex - px, ey - py)
      if (len > bestLen) {
        bestLen = len
        best = i
      }
      px = ex
      py = ey
    }
    const sx = best === 0 ? p.x : p.segs[(best - 1) * 6 + 4]!
    const sy = best === 0 ? p.y : p.segs[(best - 1) * 6 + 5]!
    const s = p.segs.slice(best * 6, best * 6 + 6)
    const [h1, h2] = splitCubicAt([sx, sy, ...s], 0.5)
    p.segs.splice(best * 6, 6, ...h1.slice(2), ...h2.slice(2))
  }
}

/** Anchor i of a ring is the start of segment i. */
function ringAnchors(p: CubicSubpath): number[] {
  const n = p.segs.length / 6
  const out = [p.x, p.y]
  for (let i = 0; i < n - 1; i++) out.push(p.segs[i * 6 + 4]!, p.segs[i * 6 + 5]!)
  return out
}

function rotateRing(p: CubicSubpath, k: number): CubicSubpath {
  if (k === 0) return p
  const x = p.segs[(k - 1) * 6 + 4]!
  const y = p.segs[(k - 1) * 6 + 5]!
  return { x, y, segs: [...p.segs.slice(k * 6), ...p.segs.slice(0, k * 6)], closed: p.closed }
}

function reverseRing(p: CubicSubpath): CubicSubpath {
  const n = p.segs.length / 6
  const segs: number[] = []
  for (let j = n - 1; j >= 0; j--) {
    const sx = j === 0 ? p.x : p.segs[(j - 1) * 6 + 4]!
    const sy = j === 0 ? p.y : p.segs[(j - 1) * 6 + 5]!
    segs.push(p.segs[j * 6 + 2]!, p.segs[j * 6 + 3]!, p.segs[j * 6]!, p.segs[j * 6 + 1]!, sx, sy)
  }
  return { x: p.x, y: p.y, segs, closed: p.closed }
}

/**
 * Of every rotation of `b`'s ring in both windings, the one whose anchors land
 * nearest `a`'s (sum of squared distances). A candidate is adopted only when its
 * cost is STRICTLY lower than the best so far, and rotation 0 / forward is tried
 * first, so ties (and any pair already in its best correspondence, cost 0) keep it.
 */
function bestCorrespondence(a: CubicSubpath, b: CubicSubpath): CubicSubpath {
  const n = b.segs.length / 6
  // O(n²) per subpath: a ring past 64 segments is far beyond anything authored, so keep rotation 0, forward.
  if (n < 2 || n > MAX_CORRESPONDENCE_SEGMENTS) return b
  const aa = ringAnchors(a)
  let best = b
  let bestCost = Infinity
  for (const cand of [b, reverseRing(b)]) {
    const ca = ringAnchors(cand)
    for (let k = 0; k < n; k++) {
      let cost = 0
      for (let i = 0; i < n; i++) {
        const j = ((i + k) % n) * 2
        const dx = aa[i * 2]! - ca[j]!
        const dy = aa[i * 2 + 1]! - ca[j + 1]!
        cost += dx * dx + dy * dy
      }
      if (cost < bestCost - 1e-12) {
        bestCost = cost
        best = rotateRing(cand, k)
      }
    }
  }
  return best
}

/**
 * Make two parsed paths structurally compatible (same subpath count, same
 * segment count per subpath, same closedness) without changing the curve either
 * draws: surplus subpaths are paired with a point at their centroid, an open
 * path whose ends all but meet is closed, the shorter subpath is raised by exact
 * de Casteljau splits, and a closed ring is rotated/reversed to the correspondence
 * that moves its anchors least. Pure, deterministic, never throws; inputs are
 * never mutated.
 */
export function reconcileCubics(a: ReadonlyArray<CubicSubpath>, b: ReadonlyArray<CubicSubpath>): Reconciled {
  try {
    // Identity only when there is nothing to search: matching structure AND every subpath open
    // (an open path has fixed ends, so no rotation or winding is possible). A matching CLOSED pair still
    // goes through the pipeline: it needs no splits, just the closing edge and the correspondence search,
    // which keeps rotation 0 / forward unless another candidate is STRICTLY nearer (so a pair already in
    // its best correspondence renders as it always did).
    if (sameStructure(a, b) && a.every((p) => !p.closed)) return { ok: true, a: a.slice(), b: b.slice() }
    const m = Math.min(a.length, b.length)
    const outA: CubicSubpath[] = []
    const outB: CubicSubpath[] = []

    for (let i = 0; i < m; i++) {
      const pa = cloneSub(a[i]!)
      const pb = cloneSub(b[i]!)
      if (pa.closed !== pb.closed) {
        const open = pa.closed ? pb : pa
        const [ex, ey] = endOf(open)
        const gap = Math.hypot(ex - open.x, ey - open.y)
        const diag = bboxDiagonal(open)
        const tol = diag > 0 ? diag * 0.01 : 1e-6
        if (gap > tol) {
          return {
            ok: false,
            reason: `subpath ${i + 1} is ${pa.closed ? 'closed' : 'open'} in one key and ${pb.closed ? 'closed' : 'open'} in the other, and the open one's ends are ${gap.toFixed(2)} apart (more than 1% of its size), so it is a different shape: close the open one with Z or open the closed one`,
          }
        }
        open.closed = true
      }
      if (pa.closed) {
        closeExplicitly(pa)
        closeExplicitly(pb)
      }
      outA.push(pa)
      outB.push(pb)
    }
    for (let i = m; i < Math.max(a.length, b.length); i++) {
      const surplus = cloneSub((a.length > b.length ? a : b)[i]!)
      if (surplus.closed) closeExplicitly(surplus)
      const [cx, cy] = centroid(surplus)
      const partner = degenerate(cx, cy, surplus.segs.length / 6, surplus.closed)
      if (a.length > b.length) {
        outA.push(surplus)
        outB.push(partner)
      } else {
        outA.push(partner)
        outB.push(surplus)
      }
    }

    let total = 0
    for (let i = 0; i < outA.length; i++) total += Math.max(outA[i]!.segs.length, outB[i]!.segs.length) / 6
    if (total > MAX_RECONCILED_SEGMENTS) {
      return { ok: false, reason: `the two paths need ${total} segments between them once matched, more than the ${MAX_RECONCILED_SEGMENTS} a morph allows` }
    }

    for (let i = 0; i < outA.length; i++) {
      const target = Math.max(outA[i]!.segs.length, outB[i]!.segs.length) / 6
      raiseSegments(outA[i]!, target)
      raiseSegments(outB[i]!, target)
      if (outA[i]!.closed) outB[i] = bestCorrespondence(outA[i]!, outB[i]!)
    }
    return { ok: true, a: outA, b: outB }
  } catch {
    return { ok: false, reason: 'the two paths could not be matched for a morph' }
  }
}

/** Linear interpolation of every number in `a` and `b`, subpath by subpath. Assumes `sameStructure(a, b)`. */
export function morphCubics(
  a: ReadonlyArray<CubicSubpath>,
  b: ReadonlyArray<CubicSubpath>,
  t: number,
): CubicSubpath[] {
  return a.map((pa, idx) => {
    const pb = b[idx]!
    return {
      x: pa.x + (pb.x - pa.x) * t,
      y: pa.y + (pb.y - pa.y) * t,
      segs: pa.segs.map((v, i) => v + (pb.segs[i]! - v) * t),
      closed: pa.closed,
    }
  })
}

function fmtNum(n: number): string {
  let r = Math.round(n * 1000) / 1000
  if (r === 0) r = 0 // normalize -0
  return String(r)
}

/** Subpaths back to a `d` string: `M x y` then ` C …` per segment, ` Z` when closed, subpaths space-joined. */
export function serializeCubics(paths: ReadonlyArray<CubicSubpath>): string {
  return paths
    .map((p) => {
      let s = `M ${fmtNum(p.x)} ${fmtNum(p.y)}`
      for (let i = 0; i < p.segs.length; i += 6) {
        const c1x = p.segs[i]!
        const c1y = p.segs[i + 1]!
        const c2x = p.segs[i + 2]!
        const c2y = p.segs[i + 3]!
        const ex = p.segs[i + 4]!
        const ey = p.segs[i + 5]!
        s += ` C ${fmtNum(c1x)} ${fmtNum(c1y)} ${fmtNum(c2x)} ${fmtNum(c2y)} ${fmtNum(ex)} ${fmtNum(ey)}`
      }
      if (p.closed) s += ' Z'
      return s
    })
    .join(' ')
}
