/**
 * Lottie → compound clip (PV-P6c-2). `lottieToClip` returns one compound clip
 * whose child project reproduces the animation's first-frame pose: shape
 * layers become `path` shape clips, solids become rectangles, precomps
 * become nested compound clips, null layers act only as parents, layer
 * timing (`ip`/`op`/`st`) sets each clip's range, and every unsupported
 * feature is counted in `skipped`.
 *
 * Built entirely on PV-P6c-1's pure sampling/transform/shape modules and
 * PV-P6b-1/2/3's path/gradient/import-clip machinery — no DOM, no
 * dependency, no `lottie-web`.
 */
import type { BlendMode, Clip, ClipMask, ClipMatte, Project } from '../../types'
import type { Binding } from '../../composition/types'
import { MAX_COMPOUND_DEPTH } from '../../types'
import { createClip, type ShapeClipMetadata } from '../../elements/base'
import {
  IDENTITY,
  type Affine,
  type PathSeg,
  isConformal,
  isSimilarity,
  invert,
  multiply,
  pathBounds,
  pathToD,
  rectPath,
  transformPath,
  uniformScale,
} from '../pathOps'
import { type Box, transformForBox } from '../place'
import { type GradientResult, linearToPaint, radialToPaint } from '../gradient'
import { compoundClipFor, projectFromClips, VECTOR_TEXTURE_BUDGET_BYTES } from '../importClip'
import { hasExpression, isAnimated, sampleProp, samplePath } from './props'
import { animatedProps, hasSkew, transformMatrix, transformOpacity } from './transform'
import { layerDrawables, pathFromLottiePath, type LottieDrawable } from './shapes'
import { createSlotRegistry, slotBinding, slotNameOf, type SlotRegistry, type SlotUse } from './slots'
import type { LottieAsset, LottieJson, LottieLayer, LottieProp, LottieShapeItem, LottieSplitPosition, LottieTransform } from './types'
import { applyAnimationKeyframes, resetAnimationBudget } from './animation'

export interface LottieImportOptions {
  fps: number
  name?: string
  textureBudgetBytes?: number
  /** Named colour slots: `{ accent: '#ff3d7f' }` also binds every static fill or stroke of that colour (PQ-2a). */
  slots?: Record<string, string>
  /** Write every animated channel as the per-frame sampled series (the pre-PQ-2a behaviour; the differential tests' oracle). */
  sampledOnly?: boolean
}

export interface LottieSkip {
  feature: string
  count: number
}

/** What the import did beyond the skip list (PQ-2a). */
export interface LottieImportReport {
  /** Channels written as a few native keys. */
  native: number
  /** Channels that fell back to per-frame sampling, and why. */
  sampled: Array<{ layer: string; channel: string; reason: string }>
  /** Features mapped to the nearest thing the engine has. */
  approximations: string[]
  /** Colour slots bound, with how many fills/strokes each rebinds. */
  slots: Array<{ name: string; value: string; count: number }>
  /** Every drawn layer: the clip id (a path through compounds for nested ones) and the layer `nm`. */
  parts: Array<{ id: string; name: string }>
}

export interface LottieImportResult {
  clip: Clip
  skipped: LottieSkip[]
  shapeCount: number
  report: LottieImportReport
}

// ---------------------------------------------------------------------------
// The seam for PV-P6c-3
// ---------------------------------------------------------------------------

export interface ClipSpec {
  kind: 'shape' | 'compound'
  layer: LottieLayer
  byInd: Map<number, LottieLayer>
  /** Shapes: the drawable (its chain, styles and geometry items). */
  drawable?: LottieDrawable
  /** The local box placed by transformForBox: the viewBox (shapes) or 0 0 cw ch (precomps). */
  box: Box
  /** Shapes whose geometry was baked into comp space (non-similarity pose). */
  baked: boolean
  compStage: { width: number; height: number }
  fr: number
  fps: number
  startFrame: number
  durationFrames: number
  report: LottieImportReport
  sampledOnly?: boolean
}

const BLEND_MAP: Record<number, BlendMode> = {
  1: 'multiply',
  2: 'screen',
  3: 'overlay',
  4: 'darken',
  5: 'lighten',
  9: 'softLight',
  10: 'difference',
  16: 'add',
}

/** Modes the engine has no twin for; mapped to the nearest one and reported (PQ-2a). */
const BLEND_APPROX: Record<number, { mode: BlendMode; name: string }> = {
  6: { mode: 'add', name: 'color dodge' },
  7: { mode: 'multiply', name: 'color burn' },
  8: { mode: 'overlay', name: 'hard light' },
  11: { mode: 'difference', name: 'exclusion' },
}

/**
 * Real per-frame keyframes (PV-P6c-3): delegates to `animation.ts`, which
 * samples the supported case deterministically at every output frame and
 * mutates `clip.keyframes` in place (the clip is freshly built and not yet
 * shared, so this is safe before it is pushed/returned). Unsupported cases
 * report a specific feature once per clip instead of the old collapsed
 * `animation` skip.
 */
export function applyAnimation(clip: Clip, spec: ClipSpec, skip: (feature: string) => void): void {
  applyAnimationKeyframes(clip, spec, skip)
}

export function chainHasAnimation(chain: LottieTransform[]): boolean {
  return chain.some((tr) => animatedProps(tr).length > 0)
}

export function ancestorHasAnimation(layer: LottieLayer, byInd: Map<number, LottieLayer>): boolean {
  let cur = layer
  let steps = 0
  while (cur.parent !== undefined && steps < 16) {
    const parent = byInd.get(cur.parent)
    if (!parent) break
    if (animatedProps(parent.ks).length > 0) return true
    cur = parent
    steps++
  }
  return false
}

const ANIMATABLE_ITEM_KEYS = ['p', 's', 'r', 'c', 'o', 'w', 'e', 'ks'] as const

export function itemHasAnimatedProp(item: LottieShapeItem): boolean {
  for (const key of ANIMATABLE_ITEM_KEYS) {
    if (key in item && isAnimated(item[key])) return true
  }
  // A gradient's colour/opacity stops live at `g.k`, not `g` itself.
  const g = item.g as { k?: unknown } | undefined
  if (g && isAnimated(g.k)) return true
  return false
}

// ---------------------------------------------------------------------------
// Validation and entry point
// ---------------------------------------------------------------------------

function isLottieJson(json: unknown): json is LottieJson {
  if (!json || typeof json !== 'object') return false
  const j = json as Record<string, unknown>
  if (typeof j.fr !== 'number' || !(j.fr > 0)) return false
  if (typeof j.w !== 'number' || !(j.w > 0)) return false
  if (typeof j.h !== 'number' || !(j.h > 0)) return false
  if (typeof j.ip !== 'number' || typeof j.op !== 'number') return false
  if (!(j.op > j.ip)) return false
  if (!Array.isArray(j.layers)) return false
  return true
}

interface Comp {
  w: number
  h: number
  op: number
}

interface SlotHit {
  path: 'shapeFill' | 'shapeStroke'
  name: string
  color: string
}

interface CompResult {
  project: Project
  /** Bindings relative to `project` (clip paths through nested compounds). */
  bindings: Binding[]
  parts: Array<{ id: string; name: string }>
}

interface BudgetState {
  used: number
  budget: number
}

interface ConvertCtx {
  fps: number
  fr: number
  frameOf: (compTime: number) => number
  assets: Map<string, LottieAsset>
  skip: (feature: string) => void
  shapeCount: { count: number }
  budget: BudgetState
  report: LottieImportReport
  sampledOnly: boolean
  slots: SlotRegistry
  /** Slot hits per emitted clip id, committed only when the clip is kept. */
  clipSlots: Map<string, SlotHit[]>
  /** What each kept compound clip carried up from its own timeline. */
  nested: Map<string, CompResult>
}

export function lottieToClip(json: unknown, opts: LottieImportOptions): LottieImportResult {
  if (!isLottieJson(json)) throw new Error('Not a Lottie animation')
  resetAnimationBudget()

  const { fr, ip, op, w, h, layers, assets, nm } = json
  const fps = opts.fps
  const frameOf = (compTime: number): number => Math.round((compTime * fps) / fr)

  const assetMap = new Map<string, LottieAsset>()
  for (const a of assets ?? []) {
    if (a && typeof a.id === 'string') assetMap.set(a.id, a)
  }

  const skipCounts = new Map<string, number>()
  const skip = (feature: string): void => {
    skipCounts.set(feature, (skipCounts.get(feature) ?? 0) + 1)
  }

  const ctx: ConvertCtx = {
    fps,
    fr,
    frameOf,
    assets: assetMap,
    skip,
    shapeCount: { count: 0 },
    budget: { used: 0, budget: opts.textureBudgetBytes ?? VECTOR_TEXTURE_BUDGET_BYTES },
    report: { native: 0, sampled: [], approximations: [], slots: [], parts: [] },
    sampledOnly: opts.sampledOnly === true,
    slots: createSlotRegistry(opts.slots),
    clipSlots: new Map(),
    nested: new Map(),
  }

  const rootResult = compToProject(layers, { w, h, op }, 1, ctx)
  const root = rootResult.project
  const slotProps = ctx.slots.props()
  if (slotProps.length > 0) root.composition = { props: slotProps, bindings: rootResult.bindings }
  ctx.report.parts = rootResult.parts
  ctx.report.slots = ctx.slots.uses().map((s: SlotUse) => ({ ...s }))
  const durationFrames = Math.max(1, frameOf(op) - frameOf(ip))
  const clip = compoundClipFor(root, {
    name: opts.name ?? nm ?? 'Lottie',
    startFrame: 0,
    durationFrames,
    sourceStartFrame: Math.max(0, frameOf(ip)),
  })

  const skipped: LottieSkip[] = [...skipCounts.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => a.feature.localeCompare(b.feature))

  return { clip, skipped, shapeCount: ctx.shapeCount.count, report: ctx.report }
}

// ---------------------------------------------------------------------------
// Compositions
// ---------------------------------------------------------------------------

function stageOf(comp: Comp): { width: number; height: number } {
  return { width: Math.round(comp.w), height: Math.round(comp.h) }
}

const MATTE_KINDS: Record<number, { kind: ClipMatte['kind']; invert: boolean }> = {
  1: { kind: 'alpha', invert: false },
  2: { kind: 'alpha', invert: true },
  3: { kind: 'luma', invert: false },
  4: { kind: 'luma', invert: true },
}

function compToProject(layers: LottieLayer[], comp: Comp, depth: number, ctx: ConvertCtx): CompResult {
  const byInd = new Map<number, LottieLayer>()
  for (const l of layers) {
    if (l && typeof l.ind === 'number') byInd.set(l.ind, l)
  }

  // A matte source is converted on demand when its target is reached (the
  // target sits BELOW it, so the bottom-up loop meets the target first) and is
  // kept only if a target really attached to it.
  const converted = new Map<LottieLayer, { clips: Clip[]; attached: boolean }>()
  const clipsOf = (layer: LottieLayer): Clip[] => {
    let entry = converted.get(layer)
    if (!entry) {
      entry = { clips: convertLayer(layer, comp, depth, byInd, ctx), attached: false }
      converted.set(layer, entry)
    }
    return entry.clips
  }

  const bindings: Binding[] = []
  const parts: Array<{ id: string; name: string }> = []
  const keep = (clip: Clip): void => {
    parts.push({ id: clip.id, name: clip.name })
    for (const hit of ctx.clipSlots.get(clip.id) ?? []) {
      bindings.push(slotBinding(clip.id, hit.path, hit.name))
      ctx.slots.use(hit.name, hit.color)
    }
    const inner = ctx.nested.get(clip.id)
    if (inner) {
      for (const b of inner.bindings) bindings.push({ ...b, clipId: `${clip.id}/${b.clipId}` })
      for (const p of inner.parts) parts.push({ id: `${clip.id}/${p.id}`, name: p.name })
    }
  }

  const clips: Clip[] = []
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer) continue

    if (layer.td === 1) {
      const entry = converted.get(layer)
      if (!entry || !entry.attached) {
        ctx.skip('track-matte')
        continue
      }
      for (const c of entry.clips) {
        clips.push(c)
        keep(c)
      }
      continue
    }

    const own = clipsOf(layer)
    if (layer.tt !== undefined) {
      const spec = MATTE_KINDS[layer.tt]
      const sourceLayer = layer.tp !== undefined ? byInd.get(layer.tp) : layers[i - 1]
      const source = sourceLayer && sourceLayer.td === 1 ? sourceLayer : undefined
      const sourceClips = spec && source ? clipsOf(source) : []
      if (!spec || !source || sourceClips.length !== 1) {
        ctx.skip('track-matte')
      } else {
        converted.get(source)!.attached = true
        const matte: ClipMatte = { sourceClipId: sourceClips[0]!.id, kind: spec.kind, ...(spec.invert ? { invert: true } : {}) }
        for (const c of own) c.matte = matte
      }
    }
    for (const c of own) {
      clips.push(c)
      keep(c)
    }
  }

  return { project: projectFromClips(clips, { fps: ctx.fps, stage: stageOf(comp) }), bindings, parts }
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function ksHasExpression(tr: LottieTransform | undefined): boolean {
  if (!tr) return false
  if (hasExpression(tr.a) || hasExpression(tr.s) || hasExpression(tr.r) || hasExpression(tr.rz) || hasExpression(tr.o) || hasExpression(tr.sk)) {
    return true
  }
  const p = tr.p
  if (p && typeof p === 'object' && (p as { s?: unknown }).s === true) {
    const split = p as LottieSplitPosition
    return hasExpression(split.x) || hasExpression(split.y)
  }
  return hasExpression(p as LottieProp | undefined)
}

/**
 * World matrix at comp time T: transformMatrix(parent chain…) · transformMatrix(layer.ks, T − st),
 * walking `parent` through `byInd`, each ancestor sampled at T − ancestor.st, at most 16 levels;
 * a missing parent stops the walk and reports it once.
 */
export function worldMatrix(layer: LottieLayer, T: number, byInd: Map<number, LottieLayer>, skip: (feature: string) => void): Affine {
  let m = transformMatrix(layer.ks, T - (layer.st ?? 0))
  let cur = layer
  let steps = 0
  while (cur.parent !== undefined && steps < 16) {
    const parent = byInd.get(cur.parent)
    if (!parent) {
      skip('parent-missing')
      break
    }
    const parentT = T - (parent.st ?? 0)
    m = multiply(transformMatrix(parent.ks, parentT), m)
    cur = parent
    steps++
  }
  return m
}

export function chainMatrixAt(chain: LottieTransform[], t: number): Affine {
  let m: Affine = IDENTITY
  for (let k = chain.length - 1; k >= 0; k--) {
    m = multiply(transformMatrix(chain[k]!, t), m)
  }
  return m
}

function convertLayer(layer: LottieLayer, comp: Comp, depth: number, byInd: Map<number, LottieLayer>, ctx: ConvertCtx): Clip[] {
  const skip = ctx.skip

  if (layer.hd === true) return []
  const mask = readLayerMask(layer, ctx)
  if (Array.isArray(layer.ef) && layer.ef.length > 0) skip('effect')
  if (layer.sr !== undefined && layer.sr !== 1) skip('time-stretch')
  if (layer.ao === 1) skip('auto-orient')
  if (layer.ddd === 1) skip('3d-layer')
  if (hasSkew(layer.ks)) skip('skew')
  if (ksHasExpression(layer.ks)) skip('expression')

  let blend: BlendMode | undefined
  if (layer.bm !== undefined && layer.bm !== 0) {
    const mapped = BLEND_MAP[layer.bm]
    const approx = BLEND_APPROX[layer.bm]
    if (mapped) blend = mapped
    else if (approx) {
      blend = approx.mode
      ctx.report.approximations.push(`blend-mode:${layer.bm} (${approx.name}) approximated as ${approx.mode}`)
    } else skip(`blend-mode:${layer.bm}`)
  }

  const st = layer.st ?? 0
  const startFrame = Math.max(0, ctx.frameOf(layer.ip))
  const end = ctx.frameOf(Math.min(layer.op, comp.op))
  if (end <= startFrame) return []
  const durationFrames = end - startFrame
  const t0 = layer.ip - st

  const clips: Clip[] = []

  if (layer.ty === 3) {
    // null: acts only as a parent
  } else if (layer.ty === 1) {
    const w = layer.sw ?? comp.w
    const h = layer.sh ?? comp.h
    const d: LottieDrawable = {
      geom: rectPath(0, 0, w, h),
      chain: [],
      fill: { color: layer.sc ?? '#000000', rule: 'nonzero' },
      opacity: 1,
      styles: [],
      geometry: [],
    }
    const clip = emitShape(d, layer, comp, byInd, startFrame, durationFrames, t0, blend, mask, ctx)
    if (clip) clips.push(clip)
  } else if (layer.ty === 4) {
    const items = Array.isArray(layer.shapes) ? layer.shapes : []
    for (const d of layerDrawables(items, t0, skip, (m) => ctx.report.approximations.push(m))) {
      const clip = emitShape(d, layer, comp, byInd, startFrame, durationFrames, t0, blend, mask, ctx)
      if (clip) clips.push(clip)
    }
  } else if (layer.ty === 0) {
    const asset = layer.refId !== undefined ? ctx.assets.get(layer.refId) : undefined
    if (!asset || !Array.isArray(asset.layers)) {
      skip('precomp-missing')
      return clips
    }
    if (depth + 1 > MAX_COMPOUND_DEPTH) {
      skip('precomp-depth')
      return clips
    }
    const cw = layer.w ?? asset.w ?? comp.w
    const ch = layer.h ?? asset.h ?? comp.h
    const childResult = compToProject(asset.layers, { w: cw, h: ch, op: layer.op - st }, depth + 1, ctx)
    const child = childResult.project

    const M = worldMatrix(layer, layer.ip, byInd, skip)
    const box: Box = { x: 0, y: 0, width: cw, height: ch }
    const { transform, exact } = transformForBox(M, box, stageOf(comp), 'compound')
    if (!exact) skip('non-uniform-transform')

    let clip = compoundClipFor(child, {
      name: layer.nm ?? 'Precomp',
      startFrame,
      durationFrames,
      sourceStartFrame: Math.max(0, ctx.frameOf(layer.ip - st)),
      transform,
      opacity: transformOpacity(layer.ks, t0),
    })
    if (blend !== undefined) clip = { ...clip, blend }
    if (mask) clip = { ...clip, mask: placeMask(mask, box, IDENTITY) }
    ctx.nested.set(clip.id, childResult)

    applyAnimation(
      clip,
      {
        kind: 'compound',
        layer,
        byInd,
        box,
        baked: false,
        compStage: stageOf(comp),
        fr: ctx.fr,
        fps: ctx.fps,
        startFrame,
        durationFrames,
        report: ctx.report,
        sampledOnly: ctx.sampledOnly,
      },
      skip,
    )

    clips.push(clip)
  } else if (layer.ty === 2) {
    skip('image-layer')
  } else if (layer.ty === 5) {
    skip('text-layer')
  } else if (layer.ty === 6) {
    skip('audio-layer')
  } else if (layer.ty === 13) {
    skip('camera')
  } else {
    skip(`layer-type:${layer.ty}`)
  }

  return clips
}

// ---------------------------------------------------------------------------
// Masks and colour slots (PQ-2a)
// ---------------------------------------------------------------------------

interface ParsedMask {
  /** The outline in LAYER space (before `ks`). */
  path: PathSeg[]
  invert: boolean
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * The layer's first mask when it is a static add-mode outline at full opacity.
 * `Clip.mask` holds one mask, so more masks, subtract/intersect modes, a mask
 * opacity under 100 and an animated outline each stay skipped by name.
 */
function readLayerMask(layer: LottieLayer, ctx: ConvertCtx): ParsedMask | null {
  const list = Array.isArray(layer.masksProperties) ? layer.masksProperties : []
  if (list.length === 0) {
    if (layer.hasMask) ctx.skip('mask')
    return null
  }
  for (let i = 1; i < list.length; i++) ctx.skip('mask-extra')

  const first = list[0]
  if (!first || typeof first !== 'object' || (first as { pt?: unknown }).pt === undefined) {
    ctx.skip('mask')
    return null
  }
  const m = first as Record<string, unknown>
  let ok = true
  if ((typeof m.mode === 'string' ? m.mode : 'a') !== 'a') {
    ctx.skip('mask-mode')
    ok = false
  }
  if (isAnimated(m.o) || (sampleProp(m.o, 0, [100])[0] ?? 100) < 100) {
    ctx.skip('mask-opacity')
    ok = false
  }
  if (isAnimated(m.pt)) {
    ctx.skip('mask-path-animation')
    ok = false
  }
  if (!ok) return null

  const pv = samplePath(m.pt, 0)
  const path = pv ? pathFromLottiePath(pv) : []
  if (path.length === 0) {
    ctx.skip('mask')
    return null
  }
  if (pv && !pv.c) path.push({ c: 'Z' })
  if (isAnimated(m.x) || (sampleProp(m.x, 0, [0])[0] ?? 0) !== 0) {
    ctx.report.approximations.push('mask expansion dropped')
  }
  return { path, invert: m.inv === true }
}

/** The mask as a `ClipMask` over the clip's draw box `box`; `toBox` maps layer space into the box's space. */
function placeMask(mask: ParsedMask, box: Box, toBox: Affine): ClipMask {
  const path = toBox === IDENTITY ? mask.path : transformPath(mask.path, toBox)
  return {
    kind: 'path',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    path: pathToD(path),
    viewBox: { x: box.x, y: box.y, width: box.width, height: box.height },
    ...(mask.invert ? { invert: true } : {}),
  }
}

/** Which of the drawable's static solid fill / stroke are colour slots. */
function slotHitsFor(d: LottieDrawable, ctx: ConvertCtx): SlotHit[] {
  const hits: SlotHit[] = []
  const consider = (ty: 'fl' | 'st', path: SlotHit['path'], color: string | undefined): void => {
    if (color === undefined) return
    const item = d.styles.find((s) => s.ty === ty)
    if (item && isAnimated(item.c)) {
      if (slotNameOf(item.nm) !== undefined) ctx.report.approximations.push(`slot ${String(item.nm)}: the colour is keyed and cannot rebind`)
      return
    }
    const m = ctx.slots.match(item?.nm, color)
    if (!m) return
    if (m.reason) {
      ctx.report.approximations.push(m.reason)
      return
    }
    hits.push({ path, name: m.name, color })
  }
  consider('fl', 'shapeFill', d.fill && !('gradient' in d.fill) ? d.fill.color : undefined)
  consider('st', 'shapeStroke', d.stroke?.color)
  return hits
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function padBox(vb: Box, k: number): Box {
  const minSide = k > 0 ? 1 / k : 0
  let { x, y, width, height } = vb
  if (width < minSide) {
    const grow = minSide - width
    x -= grow / 2
    width = minSide
  }
  if (height < minSide) {
    const grow = minSide - height
    y -= grow / 2
    height = minSide
  }
  return { x, y, width, height }
}

function emitShape(
  d: LottieDrawable,
  layer: LottieLayer,
  comp: Comp,
  byInd: Map<number, LottieLayer>,
  startFrame: number,
  durationFrames: number,
  t0: number,
  blend: BlendMode | undefined,
  mask: ParsedMask | null,
  ctx: ConvertCtx,
): Clip | null {
  ctx.shapeCount.count++

  const compStage = stageOf(comp)
  const cost = compStage.width * compStage.height * 4
  if (ctx.budget.used + cost > ctx.budget.budget) {
    ctx.skip('element-limit')
    return null
  }
  ctx.budget.used += cost

  const worldM = worldMatrix(layer, layer.ip, byInd, ctx.skip)
  const chainM = chainMatrixAt(d.chain, t0)
  const M = multiply(worldM, chainM)

  const rawVb = pathBounds(d.geom) ?? { x: 0, y: 0, width: 0, height: 0 }
  let geom: PathSeg[]
  let gMatrix: Affine
  const baked = !isSimilarity(M)
  if (baked) {
    geom = transformPath(d.geom, M)
    gMatrix = M
    if (d.stroke && !isConformal(M)) ctx.skip('non-uniform-stroke')
  } else {
    geom = d.geom
    gMatrix = IDENTITY
  }

  let vb = baked ? pathBounds(geom) ?? rawVb : rawVb
  const k = uniformScale(M)
  vb = padBox(vb, k)

  const { transform } = transformForBox(baked ? IDENTITY : M, vb, compStage, 'shape')

  const shape: ShapeClipMetadata = {
    shapeKind: 'path',
    shapePath: pathToD(geom),
    shapeViewBox: vb,
    shapeFill: 'transparent',
    shapeStroke: 'transparent',
    shapeStrokeWidth: 0,
  }

  if (d.fill) {
    if ('gradient' in d.fill) {
      const g = d.fill.gradient
      let result: GradientResult
      if (g.type === 'radial') {
        if (g.highlight !== 0) ctx.skip('radial-gradient-focal')
        const r = Math.hypot(g.e[0] - g.s[0], g.e[1] - g.s[1])
        result = radialToPaint(g.s, r, undefined, g.stops, gMatrix, vb)
      } else {
        result = linearToPaint(g.s, g.e, g.stops, gMatrix, vb)
      }
      for (const a of result.approximations) ctx.skip(a)
      if (result.kind === 'paint') {
        shape.shapeFillPaint = result.paint
        shape.shapeFill = g.stops[0]?.color ?? 'transparent'
      } else {
        shape.shapeFill = result.color
      }
      if (g.rule === 'evenodd') shape.shapeFillRule = 'evenodd'
    } else {
      shape.shapeFill = d.fill.color
      if (d.fill.rule === 'evenodd') shape.shapeFillRule = 'evenodd'
    }
  }

  if (d.stroke) {
    shape.shapeStroke = d.stroke.color
    shape.shapeStrokeWidth = d.stroke.width * k
    if (d.stroke.cap !== undefined) shape.shapeStrokeCap = d.stroke.cap
    if (d.stroke.join !== undefined) shape.shapeStrokeJoin = d.stroke.join
    if (d.stroke.dash !== undefined) shape.shapeStrokeDash = d.stroke.dash.map((v) => v * k)
    if (d.stroke.dashOffset !== undefined) shape.shapeStrokeDashOffset = d.stroke.dashOffset * k
  }

  const built = createClip({
    type: 'shape',
    trackId: '',
    name: layer.nm ?? 'Shape',
    startFrame,
    durationFrames,
    opacity: transformOpacity(layer.ks, t0) * d.opacity,
    transform,
    shape,
  })
  let clip: Clip = blend !== undefined ? { ...built, blend } : built

  if (d.trim) {
    const s = clamp01((sampleProp(d.trim.s, t0, [0])[0] ?? 0) / 100)
    const e = clamp01((sampleProp(d.trim.e, t0, [100])[0] ?? 100) / 100)
    clip = { ...clip, shapeDraw: { start: Math.min(s, e), end: Math.max(s, e) } }
  }

  if (mask) {
    // The mask is in layer space and the clip's draw box is `vb` in geometry space.
    const toGeom = baked ? worldM : invert(chainM)
    if (toGeom) clip = { ...clip, mask: placeMask(mask, vb, toGeom) }
    else ctx.skip('mask')
  }

  const hits = slotHitsFor(d, ctx)
  if (hits.length > 0) ctx.clipSlots.set(clip.id, hits)

  applyAnimation(
    clip,
    {
      kind: 'shape',
      layer,
      byInd,
      drawable: d,
      box: vb,
      baked,
      compStage,
      fr: ctx.fr,
      fps: ctx.fps,
      startFrame,
      durationFrames,
      report: ctx.report,
      sampledOnly: ctx.sampledOnly,
    },
    ctx.skip,
  )

  return clip
}
