/**
 * Turn a shape layer's item list into back-to-front drawables (geometry +
 * one fill and/or stroke each), applying Lottie/After Effects' rule that a
 * fill or stroke paints every geometry item listed before it in its group
 * (including geometry inside an earlier sub-group) — index 0 of an item list
 * is the FRONT.
 */
import { IDENTITY, type Affine, type PathSeg, ellipsePath, multiply, rectPath, transformPath } from '../pathOps'
import { formatCssColor } from '../color'
import type { GradientStopIn } from '../gradient'
import { isAnimated, sampleProp, samplePath } from './props'
import { transformMatrix, transformOpacity } from './transform'
import type { LottiePathValue, LottieShapeItem, LottieTransform } from './types'

export interface LottieGradientFill {
  type: 'linear' | 'radial'
  s: [number, number]
  e: [number, number]
  stops: GradientStopIn[]
  highlight: number
  rule: 'nonzero' | 'evenodd'
}

export interface LottieDrawable {
  /** Geometry in the space of the group holding the style item(s). */
  geom: PathSeg[]
  /** Group transforms from the layer root down to that group, outermost first (the layer's own ks is NOT included). */
  chain: LottieTransform[]
  fill?: { color: string; rule: 'nonzero' | 'evenodd' } | { gradient: LottieGradientFill }
  stroke?: { color: string; width: number; cap?: 'round' | 'square'; join?: 'round' | 'bevel'; dash?: number[]; dashOffset?: number }
  /** Product of the chain's group opacities at t. */
  opacity: number
  /** For PV-P6c-3: the style items and each geometry item with the groups between it and the style's group. */
  styles: LottieShapeItem[]
  geometry: Array<{ item: LottieShapeItem; inner: LottieTransform[] }>
  /** A usable `tm` (trim path) that sits between the geometry and this stroke (PQ-2a). */
  trim?: LottieShapeItem
}

/**
 * Lottie colour [r, g, b, a?] (0..1; if any of r, g, b > 1 the array is 0..255)
 * with extra alpha multiplier → CSS.
 */
export function lottieColor(c: number[], alphaMul: number): string {
  const rgb = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]
  const scale = rgb.every((v) => v <= 1) ? 255 : 1
  const r = rgb[0]! * scale
  const g = rgb[1]! * scale
  const b = rgb[2]! * scale
  const a = (c[3] ?? 1) * alphaMul
  return formatCssColor({ r: Math.round(r), g: Math.round(g), b: Math.round(b), a })
}

function numField(item: LottieShapeItem, key: string): number | undefined {
  const v = item[key]
  return typeof v === 'number' ? v : undefined
}

export function pathFromLottiePath(pv: LottiePathValue): PathSeg[] {
  const { v, i, o, c } = pv
  const n = v.length
  if (n === 0) return []
  const segs: PathSeg[] = [{ c: 'M', x: v[0]![0]!, y: v[0]![1]! }]
  const isZero = (pt: number[] | undefined): boolean => !pt || (pt[0] === 0 && pt[1] === 0)
  const edgeCount = c ? n : n - 1
  for (let k = 0; k < edgeCount; k++) {
    const k1 = (k + 1) % n
    const ok = o[k]
    const ik1 = i[k1]
    const vk = v[k]!
    const vk1 = v[k1]!
    if (isZero(ok) && isZero(ik1)) {
      segs.push({ c: 'L', x: vk1[0]!, y: vk1[1]! })
    } else {
      const c1x = vk[0]! + (ok?.[0] ?? 0)
      const c1y = vk[1]! + (ok?.[1] ?? 0)
      const c2x = vk1[0]! + (ik1?.[0] ?? 0)
      const c2y = vk1[1]! + (ik1?.[1] ?? 0)
      segs.push({ c: 'C', x1: c1x, y1: c1y, x2: c2x, y2: c2y, x: vk1[0]!, y: vk1[1]! })
    }
  }
  if (c) segs.push({ c: 'Z' })
  return segs
}

function pathFor(item: LottieShapeItem, t: number): PathSeg[] {
  if (item.ty === 'rc') {
    const p = sampleProp(item.p, t, [0, 0])
    const s = sampleProp(item.s, t, [0, 0])
    const r = sampleProp(item.r, t, [0])[0] ?? 0
    const w = s[0] ?? 0
    const h = s[1] ?? 0
    return rectPath((p[0] ?? 0) - w / 2, (p[1] ?? 0) - h / 2, w, h, r, r)
  }
  if (item.ty === 'el') {
    const p = sampleProp(item.p, t, [0, 0])
    const s = sampleProp(item.s, t, [0, 0])
    return ellipsePath(p[0] ?? 0, p[1] ?? 0, (s[0] ?? 0) / 2, (s[1] ?? 0) / 2)
  }
  if (item.ty === 'sh') {
    const pv = samplePath(item.ks, t)
    return pv ? pathFromLottiePath(pv) : []
  }
  return []
}

/** M = chain[0] ∘ chain[1] ∘ … ∘ chain[last] (chain[last] applied first). */
function chainMatrix(chain: LottieTransform[], t: number): Affine {
  let m: Affine = IDENTITY
  for (let k = chain.length - 1; k >= 0; k--) {
    m = multiply(transformMatrix(chain[k], t), m)
  }
  return m
}

function interpAt<T extends { offset: number }>(stops: T[], t: number, mix: (a: T, b: T, u: number) => T): T {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (t <= first.offset) return first
  if (t >= last.offset) return last
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (t >= a.offset && t <= b.offset) {
      const u = a.offset === b.offset ? 1 : (t - a.offset) / (b.offset - a.offset)
      return mix(a, b, u)
    }
  }
  return last
}

interface ColorStop {
  offset: number
  r: number
  g: number
  b: number
}
interface OpacityStop {
  offset: number
  alpha: number
}

function colorAtStops(stops: ColorStop[], t: number): { r: number; g: number; b: number } {
  if (stops.length === 0) return { r: 0, g: 0, b: 0 }
  return interpAt(stops, t, (a, b, u) => ({ offset: t, r: a.r + (b.r - a.r) * u, g: a.g + (b.g - a.g) * u, b: a.b + (b.b - a.b) * u }))
}

function alphaAtStops(stops: OpacityStop[], t: number): number {
  if (stops.length === 0) return 1
  return interpAt(stops, t, (a, b, u) => ({ offset: t, alpha: a.alpha + (b.alpha - a.alpha) * u })).alpha
}

function makeDrawable(
  style: LottieShapeItem,
  geoms: Array<{ item: LottieShapeItem; inner: LottieTransform[] }>,
  chain: LottieTransform[],
  t: number,
  skip: (feature: string) => void,
  trim?: LottieShapeItem,
  note?: (message: string) => void,
): LottieDrawable | undefined {
  const geometry = geoms.map((g) => ({ item: g.item, inner: g.inner }))
  let geom: PathSeg[] = []
  for (const g of geoms) {
    const local = pathFor(g.item, t)
    const moved = g.inner.length ? transformPath(local, chainMatrix(g.inner, t)) : local
    geom = geom.concat(moved)
  }
  if (geom.length === 0) return undefined

  const opacity = chain.reduce((acc, tr) => acc * transformOpacity(tr, t), 1)
  const base: LottieDrawable = { geom, chain: [...chain], opacity, styles: [style], geometry }
  if (trim && style.ty !== 'st') {
    skip('trim-paths')
    note?.('trim-paths: only a stroked path can be trimmed; this fill is drawn whole')
  }

  if (style.ty === 'fl') {
    const color = lottieColor(sampleProp(style.c, t, [0, 0, 0]), (sampleProp(style.o, t, [100])[0] ?? 100) / 100)
    const rule: 'nonzero' | 'evenodd' = numField(style, 'r') === 2 ? 'evenodd' : 'nonzero'
    return { ...base, fill: { color, rule } }
  }

  if (style.ty === 'st') {
    const color = lottieColor(sampleProp(style.c, t, [0, 0, 0]), (sampleProp(style.o, t, [100])[0] ?? 100) / 100)
    const width = sampleProp(style.w, t, [1])[0] ?? 1
    const lc = numField(style, 'lc')
    const cap: 'round' | 'square' | undefined = lc === 2 ? 'round' : lc === 3 ? 'square' : undefined
    const lj = numField(style, 'lj')
    const join: 'round' | 'bevel' | undefined = lj === 2 ? 'round' : lj === 3 ? 'bevel' : undefined
    const ml = numField(style, 'ml')
    if (lj === 1 && ml !== undefined && ml !== 10) skip('stroke-miterlimit')

    let dash: number[] | undefined
    let dashOffset: number | undefined
    const dRaw = style.d
    if (Array.isArray(dRaw)) {
      const vals: number[] = []
      let off: number | undefined
      for (const entry of dRaw) {
        if (!entry || typeof entry !== 'object') continue
        const n = (entry as { n?: unknown }).n
        const v = sampleProp((entry as { v?: unknown }).v, t, [0])[0] ?? 0
        if (n === 'o') off = v
        else vals.push(v)
      }
      const allZero = vals.every((v) => v === 0)
      const anyNeg = vals.some((v) => v < 0)
      if (vals.length > 0 && !allZero && !anyNeg) dash = vals
      if (off !== undefined && off !== 0) dashOffset = off
    }

    return { ...base, ...(trim ? { trim } : {}), stroke: { color, width, cap, join, dash, dashOffset } }
  }

  if (style.ty === 'gf') {
    const type: 'linear' | 'radial' = numField(style, 't') === 2 ? 'radial' : 'linear'
    const s = sampleProp(style.s, t, [0, 0])
    const e = sampleProp(style.e, t, [0, 0])
    const g = style.g as { p?: unknown; k?: unknown } | undefined
    const p = typeof g?.p === 'number' ? g.p : 0
    const arr = sampleProp(g?.k, t, [])

    const colorStops: ColorStop[] = []
    for (let j = 0; j < p; j++) {
      const base4 = j * 4
      colorStops.push({ offset: arr[base4] ?? 0, r: arr[base4 + 1] ?? 0, g: arr[base4 + 2] ?? 0, b: arr[base4 + 3] ?? 0 })
    }
    const opacityStops: OpacityStop[] = []
    for (let k = p * 4; k + 1 < arr.length; k += 2) {
      opacityStops.push({ offset: arr[k]!, alpha: arr[k + 1]! })
    }

    const offsets = [...new Set([...colorStops.map((c) => c.offset), ...opacityStops.map((o) => o.offset)])].sort((a, b) => a - b)
    const opacityMul = (sampleProp(style.o, t, [100])[0] ?? 100) / 100
    const stops: GradientStopIn[] = offsets.map((off) => {
      const rgb = colorAtStops(colorStops, off)
      const alpha = alphaAtStops(opacityStops, off)
      return { offset: off, color: lottieColor([rgb.r, rgb.g, rgb.b, alpha], opacityMul) }
    })

    const highlight = sampleProp(style.h, t, [0])[0] ?? 0
    const rule: 'nonzero' | 'evenodd' = numField(style, 'r') === 2 ? 'evenodd' : 'nonzero'
    const gradient: LottieGradientFill = { type, s: [s[0] ?? 0, s[1] ?? 0], e: [e[0] ?? 0, e[1] ?? 0], stops, highlight, rule }
    return { ...base, fill: { gradient } }
  }

  return undefined
}

function walk(
  items: LottieShapeItem[],
  chain: LottieTransform[],
  t: number,
  skip: (feature: string) => void,
  note?: (message: string) => void,
): { geoms: Array<{ item: LottieShapeItem; inner: LottieTransform[] }>; drawables: LottieDrawable[] } {
  const geoms: Array<{ item: LottieShapeItem; inner: LottieTransform[] }> = []
  const out: LottieDrawable[] = []
  // A `tm` trims every path of its group, wherever it sits in the list (After
  // Effects exports it after the stroke it trims). Read it before the walk.
  let trim: LottieShapeItem | undefined
  for (const item of items) {
    if (item.ty !== 'tm' || item.hd === true) continue
    const problem = trimProblem(item, trim !== undefined)
    if (problem) {
      skip('trim-paths')
      note?.(`trim-paths: ${problem}`)
    } else {
      trim = item
    }
  }

  for (const item of items) {
    if (item.hd === true) continue
    const ty = item.ty
    if (ty === 'tr') continue

    if (ty === 'rc' || ty === 'el' || ty === 'sh') {
      geoms.push({ item, inner: [] })
    } else if (ty === 'gr') {
      const children = Array.isArray(item.it) ? (item.it as LottieShapeItem[]) : []
      const trItem = children.find((c) => c.ty === 'tr')
      const tr = trItem as unknown as LottieTransform | undefined
      const subChain = tr ? [...chain, tr] : chain
      const sub = walk(children, subChain, t, skip, note)
      out.push(...sub.drawables)
      for (const g of sub.geoms) {
        geoms.push({ item: g.item, inner: tr ? [tr, ...g.inner] : g.inner })
      }
    } else if (ty === 'fl' || ty === 'st' || ty === 'gf') {
      const d = makeDrawable(item, [...geoms], chain, t, skip, trim, note)
      if (d) out.push(d)
    } else if (ty === 'gs') {
      skip('gradient-stroke')
    } else if (ty === 'tm') {
      // read above
    } else if (ty === 'rd') {
      skip('round-corners')
    } else if (ty === 'mm') {
      skip('merge-paths')
    } else if (ty === 'rp') {
      skip('repeater')
    } else if (ty === 'sr') {
      skip('polystar')
    } else if (ty === 'op') {
      skip('offset-path')
    } else if (ty === 'pb') {
      skip('pucker-bloat')
    } else if (ty === 'tw') {
      skip('twist')
    } else if (ty === 'zz') {
      skip('zig-zag')
    } else {
      skip(`shape:${ty}`)
    }
  }

  return { geoms, drawables: out }
}

/**
 * Why a `tm` cannot become a draw window, or null when it can: individual-shapes
 * mode, a second trim in the group, or a nonzero/animated offset.
 */
function trimProblem(item: LottieShapeItem, haveOne: boolean): string | null {
  if (haveOne) return 'only one trim per group is read'
  if (numField(item, 'm') === 2) return 'individual-shapes mode is not supported'
  const o = item.o
  if (isAnimated(o)) return 'an animated offset is not supported'
  if ((sampleProp(o, 0, [0])[0] ?? 0) !== 0) return 'a nonzero offset is not supported'
  return null
}

function sameChain(a: LottieTransform[], b: LottieTransform[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameGeometry(a: LottieDrawable['geometry'], b: LottieDrawable['geometry']): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i]!.item !== b[i]!.item) return false
  return true
}

/**
 * Merge pass on the back-to-front list: when drawable k has only a fill,
 * k+1 has only a stroke, and both share the same chain, the same geometry
 * items (same objects, same order) and equal opacity, replace them with one
 * drawable carrying both. Nothing else merges.
 */
function mergeAdjacent(list: LottieDrawable[]): LottieDrawable[] {
  const result: LottieDrawable[] = []
  for (let i = 0; i < list.length; i++) {
    const cur = list[i]!
    const next = list[i + 1]
    if (
      next &&
      cur.fill &&
      !cur.stroke &&
      next.stroke &&
      !next.fill &&
      sameChain(cur.chain, next.chain) &&
      sameGeometry(cur.geometry, next.geometry) &&
      cur.trim === next.trim &&
      cur.opacity === next.opacity
    ) {
      result.push({ ...cur, stroke: next.stroke, styles: [...cur.styles, ...next.styles] })
      i++
      continue
    }
    result.push(cur)
  }
  return result
}

/** Back-to-front drawables of a shape layer at property time t. */
export function layerDrawables(
  items: LottieShapeItem[],
  t: number,
  skip: (feature: string) => void,
  note?: (message: string) => void,
): LottieDrawable[] {
  const { drawables } = walk(items, [], t, skip, note)
  const reversed = [...drawables].reverse()
  return mergeAdjacent(reversed)
}

