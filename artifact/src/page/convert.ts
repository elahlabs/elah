/**
 * Edit = convert the whole page to a native project (HF-3; PLAN-HTML-FIRST decision H3, PLAN-MOTION-CODE 4.4).
 *
 *   mounted page ──► rest layout (measure with animations removed, transforms folded) ──► emitScene ──► clips
 *        │                                                                                    │
 *        └─ seek + computed style at every frame = the oracle ──► native keys (or sampled) ◄──┘
 *
 * Static look comes from the existing HTML-subset path (`measureScene` + `sceneToClip`), so it converts exactly as
 * that path does and anything it cannot draw lands in its `SceneReport`. Motion is read from the browser: every
 * frame the page is seeked and the computed opacity, composite transform, blur, SVG dash offset and letter
 * spacing of each animated element are recorded; `animationsToKeys.ts` turns the series into native keys with the
 * CSS easing and checks them against the series with the engine's own sampler.
 *
 * The emitter nests compounds only two containers deep. Layout-only wrappers are hoisted away first, and a
 * deeper wrapper is dissolved here (its look becomes a leaf, its opacity and transform are pushed down into its
 * descendants as per-frame series) instead of being dropped by the emitter.
 */

import { createEffect, type AnyKeyframeChannel, type Clip, type Keyframe, type Project } from '@elah/core'
import { sceneToClip, type MeasuredNode, type MeasuredScene, type MeasuredStyle, type SceneReport } from '@elah/core/html'
import { loadAllFonts, type Converted } from '../input'
import { measureScene } from '../measure'
import { buildGroup, fitBezier, type ChannelInput, type ChannelResult, type TimingInfo } from './animationsToKeys'
import {
  IDENTITY,
  aboutOrigin,
  decompose,
  isIdentity,
  mul,
  readComposite,
  readOrigin,
  relativeTo,
  unwrapAngles,
  type Aff,
  type Pose,
} from './pose'
import { seekAnimations } from './seek'
import { verifyConversion } from './verify'
import type { PageActionContext, PagePlayerHandle, PageSource } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReportEntry {
  where: string
  message: string
}

export interface ChannelEntry {
  where: string
  channel: string
  keys: number
  /** Why a sampled channel is sampled; the worst error of a native one as a percentage of its range. */
  detail: string
}

export interface ConversionReport {
  /** Animated elements that became native clips with keys. */
  elements: number
  /** CSS animations with at least one converted property. */
  animations: number
  /** Native clips in the project (every level). */
  clips: number
  /** Native clip count per kind of conversion. */
  channels: { native: number; sampled: number; pinned: number }
  nativeList: ChannelEntry[]
  sampledList: ChannelEntry[]
  /** Animations or properties that could not convert, with the exact CSS. */
  unconverted: ReportEntry[]
  /** Static look the emitter or this converter could not carry. */
  notes: ReportEntry[]
  ms: number
}

export interface PageConversion {
  converted: Converted
  report: ConversionReport
  /** Plain text of the report, for the copy button. */
  text: string
}

// ---------------------------------------------------------------------------
// Module hand-off (App reads the result after `onEditPage` resolves)
// ---------------------------------------------------------------------------

const results = new WeakMap<PageSource, PageConversion>()

/** The conversion `editPage` produced for `page`, once. */
export function takePageConversion(page: PageSource): PageConversion | undefined {
  const r = results.get(page)
  results.delete(page)
  return r
}

/** `pageHooks.onEditPage`: convert the page and leave the result for the shell to take. */
export async function editPage(ctx: PageActionContext): Promise<void> {
  const player = ctx.player
  if (!player) throw new Error('The page is not mounted yet.')
  ctx.setStatus({ text: 'Converting the page to native clips and keyframes...', progress: 0 })
  const conv = await convertPage(ctx.page, ctx.title, player, (p, text) => ctx.setStatus({ text, progress: p }))
  results.set(ctx.page, conv)
  const r = conv.report
  ctx.setStatus({
    text: `Converted to keyframes: ${r.elements} elements, ${r.animations} animations -> native; ${r.channels.sampled} channels sampled; ${r.unconverted.length} could not convert.`,
  })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const MAX_NESTED_CONTAINERS = 2 // mirrors packages/core/src/vector/html/emit.ts
const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'])
const POSE_PROPS = ['transform', 'translate', 'rotate', 'scale']
const HANDLED = new Set([...POSE_PROPS, 'opacity', 'filter', 'strokeDashoffset', 'letterSpacing'])
const META = new Set(['offset', 'computedOffset', 'easing', 'composite'])

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

function describe(el: Element): string {
  const cls = Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join('')
  return `${el.localName}${el.id ? `#${el.id}` : ''}${cls}`
}

function transparent(c: string | undefined): boolean {
  return !c || c === 'transparent' || /^rgba?\([^)]*,\s*0(?:\.0+)?\)$/.test(c) || /\/\s*0(?:\.0+)?\s*\)$/.test(c)
}

const isGradient = (s: string | undefined): boolean => !!s && /gradient\(/i.test(s)

function hasBackground(st: MeasuredStyle): boolean {
  return !transparent(st.backgroundColor) || isGradient(st.backgroundImage) || ((st.borderWidth ?? 0) > 0 && !transparent(st.borderColor))
}

function originOf(box: { x: number; y: number; width: number; height: number }, st: MeasuredStyle): { x: number; y: number } {
  const p = (st.transformOrigin ?? '').trim().split(/\s+/)
  const axis = (t: string | undefined, size: number, lo: string, hi: string): number => {
    if (t === undefined || t === 'center') return size / 2
    if (t === lo) return 0
    if (t === hi) return size
    const m = /^([+-]?[\d.]+)(px|%)?$/.exec(t)
    if (!m) return size / 2
    return m[2] === '%' ? (parseFloat(m[1]) / 100) * size : parseFloat(m[1])
  }
  return { x: box.x + axis(p[0], box.width, 'left', 'right'), y: box.y + axis(p[1], box.height, 'top', 'bottom') }
}

// ---------------------------------------------------------------------------
// Animations on the page
// ---------------------------------------------------------------------------

interface AnimInfo {
  anim: Animation
  el: Element
  pseudo: string | null
  name: string
  /** Every animated CSS property (camelCase, as `getKeyframes` names them). */
  props: Set<string>
  kfs: Array<{ offset: number; easing: string; props: Set<string> }>
  startMs: number
  durationMs: number
  iterations: number
  direction: TimingInfo['direction']
  activeMs: number
  effectEasingLinear: boolean
}

function inspectAnimations(anims: readonly Animation[]): AnimInfo[] {
  const out: AnimInfo[] = []
  for (const anim of anims) {
    const effect = anim.effect as KeyframeEffect | null
    const el = effect?.target
    if (!effect || !el) continue
    const timing = effect.getComputedTiming()
    const opts = effect.getTiming()
    const props = new Set<string>()
    const kfs: AnimInfo['kfs'] = []
    for (const k of effect.getKeyframes()) {
      const ks = new Set<string>()
      for (const key of Object.keys(k)) if (!META.has(key)) ks.add(key)
      for (const p of ks) props.add(p)
      kfs.push({ offset: typeof k.computedOffset === 'number' ? k.computedOffset : Number(k.offset ?? 0), easing: String(k.easing ?? 'linear'), props: ks })
    }
    const dur = Number(timing.duration ?? 0)
    const iter = Number(timing.iterations ?? 1)
    const active = Number(timing.activeDuration ?? dur * iter)
    out.push({
      anim,
      el,
      pseudo: effect.pseudoElement ?? null,
      name: (anim as Animation & { animationName?: string }).animationName ?? 'animation',
      props,
      kfs,
      startMs: Number(timing.delay ?? 0),
      durationMs: dur,
      iterations: iter,
      direction: (timing.direction ?? 'normal') as TimingInfo['direction'],
      activeMs: Number.isFinite(active) ? active : Infinity,
      effectEasingLinear: (opts.easing ?? 'linear') === 'linear',
    })
  }
  return out
}

/** The animations of `infos` that touch one of `props`, as the timing records `buildGroup` wants. */
function timingsFor(infos: readonly AnimInfo[], props: readonly string[]): TimingInfo[] {
  const set = new Set(props)
  const out: TimingInfo[] = []
  for (const a of infos) {
    if (![...a.props].some((p) => set.has(p))) continue
    out.push({
      name: a.name,
      startMs: a.startMs,
      durationMs: a.durationMs,
      iterations: a.iterations,
      direction: a.direction,
      activeMs: a.activeMs,
      effectEasingLinear: a.effectEasingLinear,
      keyframes: a.kfs.filter((k) => [...k.props].some((p) => set.has(p))).map((k) => ({ offset: k.offset, easing: k.easing })).sort((x, y) => x.offset - y.offset),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rest layout
// ---------------------------------------------------------------------------

interface SvgChild {
  host: Element
  tag: string
  /** The clip name the importer will give this shape. */
  name: string
  vbWidth: number
  baseIdentity: boolean
  originCentre: boolean
  /** Draw-on dash pattern: pathLength units; `base` = the draw fraction at rest-less (animation off) state. */
  draw?: { total: number; dash: number; gap: number; base: number }
}

interface HostData {
  baseC: Map<Element, Aff>
  base3d: Set<Element>
  baseBlur: Map<Element, number>
  hostToMounted: Map<Element, Element>
  hostIndex: Map<Element, number>
  svg: Map<Element, SvgChild>
  /** Absolute transform-origin point of every element (document-order index), for the verifier. */
  origins: Map<number, { x: number; y: number }>
  notes: ReportEntry[]
}

const SVG_SKIP = new Set(['defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'marker', 'symbol', 'style', 'title', 'desc', 'metadata', 'filter'])

function parseNums(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .map((t) => parseFloat(t))
    .filter((n) => Number.isFinite(n))
}

function blurOf(filter: string): { blur: number; other: string[] } {
  if (!filter || filter === 'none') return { blur: 0, other: [] }
  const other: string[] = []
  let blur = 0
  const re = /([a-z-]+)\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(filter))) {
    if (m[1] === 'blur') blur += parseFloat(m[2]) || 0
    else other.push(m[1]!)
  }
  return { blur, other }
}

/** Everything read from the hidden measure host before the measure reads its own styles (animations are off there). */
function prepareHost(rootEl: HTMLElement, host: HTMLElement, mountedEls: Element[], animated: Set<Element>, data: HostData): void {
  const hostEls = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]
  if (hostEls.length !== mountedEls.length) throw new Error(`The measured copy of the page has ${hostEls.length} elements, the live page ${mountedEls.length}.`)
  // The live stage supplies these through `.elah-stage`; the measure host has to match it.
  host.style.color = '#fff'
  host.style.fontFamily = '"elah-inter", sans-serif'
  hostEls.forEach((el, i) => {
    data.hostToMounted.set(el, mountedEls[i]!)
    data.hostIndex.set(el, i)
  })

  const hostRect = host.getBoundingClientRect()
  hostEls.forEach((el, i) => {
    let x = 0
    let y = 0
    let w = 0
    let h = 0
    if (el instanceof HTMLElement) {
      for (let cur: HTMLElement | null = el; cur && cur !== host; cur = cur.offsetParent instanceof HTMLElement ? cur.offsetParent : null) {
        x += cur.offsetLeft
        y += cur.offsetTop
      }
      w = el.offsetWidth
      h = el.offsetHeight
    } else {
      const r = el.getBoundingClientRect()
      x = r.left - hostRect.left
      y = r.top - hostRect.top
      w = r.width
      h = r.height
    }
    const o = readOrigin(getComputedStyle(el), w, h)
    data.origins.set(i, { x: x + o.x, y: y + o.y })
  })

  const noted = new Set<string>()
  const note = (where: string, message: string) => {
    const k = `${where}|${message}`
    if (noted.has(k)) return
    noted.add(k)
    data.notes.push({ where, message })
  }

  for (const el of hostEls) {
    const inSvg = el.closest('svg') !== null && el.closest('svg') !== el
    if (inSvg) continue
    const cs = getComputedStyle(el)
    const read = readComposite(el, cs)
    if (!isIdentity(read.c)) data.baseC.set(el, read.c)
    if (read.threeD) {
      data.base3d.add(el)
      note(describe(mountedEls[hostEls.indexOf(el)]!), '3D transform (perspective / rotateX / rotateY) flattened to 2D')
    }
    const f = blurOf(cs.filter)
    if (f.blur > 0) data.baseBlur.set(el, f.blur)
    if (f.other.length) note(describe(el), `filter: ${f.other.join(', ')} is not converted (only blur() is)`)
    if (cs.backdropFilter && cs.backdropFilter !== 'none') note(describe(el), 'backdrop-filter has no native equivalent (use an adjustment clip under it)')
    const mask = cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image')
    if (mask && mask !== 'none') note(describe(el), 'mask-image is not converted')
    for (const pseudo of ['::before', '::after'] as const) {
      const c = getComputedStyle(el, pseudo).content
      if (c && c !== 'none' && c !== 'normal') note(describe(el) + pseudo, 'pseudo-element content is not converted')
    }
  }

  // Outermost SVGs: inline what the page CSS gives each shape (the importer reads attributes and its own <style> only).
  for (const svg of hostEls.filter((e) => e.localName === 'svg' && e.closest('svg') === e) as SVGSVGElement[]) {
    prepareSvg(svg, animated, data)
  }
}

function prepareSvg(svg: SVGSVGElement, animated: Set<Element>, data: HostData): void {
  const vb = svg.viewBox?.baseVal
  const vbWidth = vb && vb.width > 0 ? vb.width : parseFloat(svg.getAttribute('width') ?? '') || 300
  const vbX = vb?.x ?? 0
  const vbY = vb?.y ?? 0
  for (const d of Array.from(svg.querySelectorAll('*'))) {
    const tag = d.localName
    if (SVG_SKIP.has(tag.toLowerCase())) continue
    const cs = getComputedStyle(d)
    const isShape = SHAPE_TAGS.has(tag)
    const mounted = data.hostToMounted.get(d)!
    const idx = data.hostIndex.get(d)!
    const decl: string[] = []
    const put = (name: string, v: string | undefined) => {
      if (v !== undefined && v !== '') decl.push(`${name}:${v}`)
    }
    put('fill', cs.fill)
    put('fill-opacity', cs.fillOpacity)
    put('fill-rule', cs.fillRule)
    put('stroke', cs.stroke)
    put('stroke-opacity', cs.strokeOpacity)
    put('stroke-width', cs.strokeWidth)
    put('stroke-linecap', cs.strokeLinecap)
    put('stroke-linejoin', cs.strokeLinejoin)
    put('color', cs.color)
    put('visibility', cs.visibility)
    put('opacity', cs.opacity)
    put('display', cs.display)

    let child: SvgChild | undefined
    if (isShape) {
      const g = d as unknown as SVGGeometryElement
      // Dash pattern: a `pathLength` + dasharray + dashoffset triple is a draw-on, not a dashed line.
      let draw: SvgChild['draw']
      const nums = parseNums(cs.strokeDasharray === 'none' ? '' : cs.strokeDasharray)
      if (nums.length >= 1 && nums.length <= 2 && nums[0]! > 0) {
        const total = d.hasAttribute('pathLength') ? parseFloat(d.getAttribute('pathLength') as string) : g.getTotalLength?.() ?? 0
        const dash = nums[0]!
        const gap = nums[1] ?? nums[0]!
        const off = parseFloat(cs.strokeDashoffset) || 0
        if (total > 0 && dash + gap - Math.max(0, off) >= total - 1e-6) {
          draw = { total, dash, gap, base: Math.min(1, Math.max(0, (dash - off) / total)) }
        }
      }
      if (draw) {
        decl.push('stroke-dasharray:none', 'stroke-dashoffset:0')
      } else {
        put('stroke-dasharray', cs.strokeDasharray)
        put('stroke-dashoffset', cs.strokeDashoffset)
      }
      // Base transform baked into the `transform` attribute about the transform origin, as the importer reads it.
      const read = readComposite(d, cs)
      const baseIdentity = isIdentity(read.c)
      let originCentre = true
      if (typeof (d as unknown as SVGGraphicsElement).getBBox === 'function') {
        const bb = (d as unknown as SVGGraphicsElement).getBBox()
        const op = cs.transformOrigin.trim().split(/\s+/).map((t) => parseFloat(t))
        const box = cs.getPropertyValue('transform-box')
        const ox = Number.isFinite(op[0]) ? op[0]! : 0
        const oy = Number.isFinite(op[1]) ? op[1]! : 0
        originCentre = box === 'fill-box' && Math.abs(ox - bb.width / 2) < 0.5 && Math.abs(oy - bb.height / 2) < 0.5
        if (!baseIdentity) {
          const o = box === 'view-box' ? { x: vbX + ox, y: vbY + oy } : { x: bb.x + ox, y: bb.y + oy }
          const m = aboutOrigin(read.c, o.x, o.y)
          d.setAttribute('transform', `matrix(${m.join(' ')})`)
        }
      }
      if (animated.has(mounted) || (draw && draw.base < 1)) {
        if (!d.id) d.setAttribute('id', `hfs${idx}`)
      }
      child = { host: d, tag, name: d.id || `hfs${idx}`, vbWidth, baseIdentity, originCentre, draw }
      data.svg.set(d, child)
    }
    d.setAttribute('style', decl.join(';'))
  }
}

// ---------------------------------------------------------------------------
// Tree work
// ---------------------------------------------------------------------------

interface NodeInfo {
  key: string
  host: Element
  mounted: Element
  node: MeasuredNode
  /** Dissolved ancestors between this node and its surviving parent, outer to inner. */
  chain: NodeInfo[]
  origin: { x: number; y: number }
  baseC: Aff
  baseOpacity: number
  baseBlur: number
  dissolved: boolean
  pose0?: Pose
}

type NodeX = MeasuredNode & { el?: Element }

function walk(node: MeasuredNode, fn: (n: MeasuredNode) => void): void {
  fn(node)
  for (const c of node.children) walk(c, fn)
}

// ---------------------------------------------------------------------------
// Series and keys
// ---------------------------------------------------------------------------

interface Samples {
  op: Float64Array
  /** a b c d e f per frame. */
  c: Float64Array
  threeD: boolean
  blur: Float64Array
  ls: Float64Array
  dash: Float64Array
}

interface Stage {
  width: number
  height: number
}

const eps = { x: 1e-5, y: 1e-5, rotation: 1e-4, scale: 1e-4, scaleX: 1e-4, scaleY: 1e-4, opacity: 1e-4, draw: 1e-4, px: 1e-3 }

function setChannel(clip: Clip, channel: string, keys: Keyframe[]): Clip {
  if (keys.length === 0) return clip
  const existing = clip.keyframes?.channels ?? {}
  return {
    ...clip,
    keyframes: { ...clip.keyframes, channels: { ...existing, [channel as AnyKeyframeChannel]: { source: { kind: 'keyframes' as const }, keys } } },
  }
}

function mapProject(p: Project, fn: (clip: Clip, stage: Stage) => Clip): Project {
  const clips: Project['clips'] = {}
  for (const [tid, list] of Object.entries(p.clips)) {
    clips[tid] = list.map((c) => {
      let out = fn(c, p.stage)
      const nested = out.compound?.project
      if (out.type === 'compound' && out.compound && nested) {
        out = { ...out, compound: { ...out.compound, project: mapProject(nested, fn) } }
      }
      return out
    })
  }
  return { ...p, clips }
}

function countClips(p: Project): number {
  let n = 0
  for (const list of Object.values(p.clips)) {
    for (const c of list) {
      n++
      if (c.compound?.project) n += countClips(c.compound.project)
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

export async function convertPage(
  page: PageSource,
  title: string,
  player: PagePlayerHandle,
  progress: (fraction: number, text: string) => void = () => undefined,
): Promise<PageConversion> {
  const started = performance.now()
  player.pause()
  const resumeAt = player.time()
  const stage = page.stage
  const fps = page.fps
  const frames = Math.max(1, Math.round(page.durationSeconds * fps))
  await loadAllFonts()

  const notes: ReportEntry[] = []
  const unconverted: ReportEntry[] = []
  const addUnconverted = (where: string, message: string) => {
    if (!unconverted.some((u) => u.where === where && u.message === message)) unconverted.push({ where, message })
  }

  // --- 1. what the page animates -----------------------------------------------------------------------------
  const anims = player.animations()
  const animInfos = inspectAnimations(anims)
  const byEl = new Map<Element, AnimInfo[]>()
  for (const a of animInfos) {
    if (a.pseudo) {
      addUnconverted(`${describe(a.el)}${a.pseudo} @keyframes ${a.name}`, 'animation on a pseudo-element has no native clip')
      continue
    }
    const list = byEl.get(a.el) ?? []
    list.push(a)
    byEl.set(a.el, list)
  }
  const animatedEls = new Set(byEl.keys())

  const mainEl = player.stageEl.firstElementChild as HTMLElement | null
  if (!mainEl) throw new Error('The page has no root element.')
  if (player.stageEl.children.length > 1) notes.push({ where: 'page', message: 'Only the first top-level element is converted; the others are ignored.' })
  const mountedEls = [mainEl, ...Array.from(mainEl.querySelectorAll('*'))]

  // --- 2. rest layout -----------------------------------------------------------------------------------------
  progress(0.02, 'Measuring the rest layout...')
  const data: HostData = {
    baseC: new Map(),
    base3d: new Set(),
    baseBlur: new Map(),
    hostToMounted: new Map(),
    hostIndex: new Map(),
    svg: new Map(),
    origins: new Map(),
    notes,
  }
  const css = `${page.css}\n*, *::before, *::after { animation: none !important; transition: none !important; box-sizing: border-box; }`
  const measured = await measureScene(
    { html: page.html, css },
    {
      stage,
      fontsReady: loadAllFonts,
      keepElements: true,
      plainDocument: true,
      onMounted: (rootEl, host) => prepareHost(rootEl, host, mountedEls, animatedEls, data),
    },
  )
  measured.duration = page.durationSeconds

  // --- 3. node infos --------------------------------------------------------------------------------------------
  const infos = new Map<string, NodeInfo>()
  const dissolved: NodeInfo[] = []
  walk(measured.root, (n) => {
    const host = (n as NodeX).el
    if (!host) return
    const key = `hf${data.hostIndex.get(host)}`
    n.id = key
    infos.set(key, {
      key,
      host,
      mounted: data.hostToMounted.get(host)!,
      node: n,
      chain: [],
      origin: originOf(n.box, n.style),
      baseC: data.baseC.get(host) ?? IDENTITY,
      baseOpacity: n.style.opacity ?? 1,
      baseBlur: data.baseBlur.get(host) ?? 0,
      dissolved: false,
    })
  })
  const infoOf = (n: MeasuredNode): NodeInfo => infos.get(n.id as string) as NodeInfo
  const isAnimated = (info: NodeInfo): boolean => animatedEls.has(info.mounted)
  const rootInfo = infoOf(measured.root)
  if (isAnimated(rootInfo) || !isIdentity(rootInfo.baseC)) notes.push({ where: describe(rootInfo.mounted), message: 'Animation or transform on the page root is not converted.' })

  // --- 4. hoist layout-only wrappers, dissolve what the emitter would drop --------------------------------------
  const inert = (n: MeasuredNode): boolean => {
    if (n.children.length === 0 || n.svg || n.img) return false
    const info = infoOf(n)
    const st = n.style
    return (
      !isAnimated(info) &&
      isIdentity(info.baseC) &&
      info.baseBlur === 0 &&
      !hasBackground(st) &&
      !(n.text && n.text.lines.length > 0) &&
      !st.overflowHidden &&
      !(st.clipPath && st.clipPath !== 'none') &&
      (st.opacity === undefined || st.opacity === 1) &&
      (!st.mixBlendMode || st.mixBlendMode === 'normal') &&
      st.zIndex === undefined
    )
  }
  const hoist = (n: MeasuredNode): void => {
    const out: MeasuredNode[] = []
    for (const c of n.children) {
      hoist(c)
      if (inert(c)) out.push(...c.children)
      else out.push(c)
    }
    n.children = out
  }
  hoist(measured.root)

  let masksLost = 0
  // A leaf that is text on a box the text clip cannot carry itself (gradient, per-corner radii, uneven padding) is
  // emitted by a nested compound, which the engine's depth limit forbids below depth 2: split it into a rect and a text.
  const needsSplit = (n: MeasuredNode): boolean => {
    const st = n.style
    if (!(n.text && n.text.lines.length > 0) || !hasBackground(st) || st.backgroundClipText) return false
    const r = st.borderRadii
    const p = st.paddings
    return isGradient(st.backgroundImage) || (!!r && r.length === 4 && !r.every((v) => v === r[0])) || (!!p && p.length === 4 && !p.every((v) => Math.abs(v - p[0]!) <= 1))
  }
  const leafNodes = (n: MeasuredNode, info: NodeInfo): MeasuredNode[] => {
    if (!needsSplit(n)) return [n]
    const st = n.style
    const border = (st.borderWidth ?? 0) > 0 && !transparent(st.borderColor) ? (st.borderWidth ?? 0) : 0
    const [pt, pr, pb, pl] = st.paddings ?? [st.padding ?? 0, st.padding ?? 0, st.padding ?? 0, st.padding ?? 0]
    const box = { x: n.box.x + border + pl, y: n.box.y + border + pt, width: Math.max(1, n.box.width - 2 * border - pl - pr), height: Math.max(1, n.box.height - 2 * border - pt - pb) }
    const rect: MeasuredNode = { ...n, text: undefined, children: [] }
    const textKey = `${n.id}t`
    const textStyle: MeasuredStyle = { ...st, backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: undefined, borderWidth: 0, borderRadius: 0, borderRadii: undefined, boxShadow: undefined, padding: 0, paddings: [0, 0, 0, 0], overflowHidden: undefined, clipPath: undefined }
    const text: MeasuredNode = { ...n, id: textKey, box, style: textStyle, children: [] }
    infos.set(textKey, { ...info, key: textKey, node: text, origin: originOf(box, textStyle) })
    return [rect, text]
  }
  const lower = (children: MeasuredNode[], depth: number, chain: NodeInfo[]): MeasuredNode[] => {
    const out: MeasuredNode[] = []
    for (const c of children) {
      const info = infoOf(c)
      if (c.children.length > 0 && !c.svg && !c.img && depth > MAX_NESTED_CONTAINERS) {
        info.dissolved = true
        dissolved.push(info)
        if (hasBackground(c.style) || (c.text && c.text.lines.length > 0)) {
          info.chain = chain
          const leaf: MeasuredNode = { ...c, children: [] }
          for (const l of leafNodes(leaf, info)) out.push(l)
          // The twin of a split leaf shares the chain.
          const twin = infos.get(`${c.id}t`)
          if (twin) twin.chain = chain
        }
        if (c.style.overflowHidden || (c.style.clipPath && c.style.clipPath !== 'none')) masksLost++
        out.push(...lower(c.children, depth, [...chain, info]))
      } else {
        info.chain = chain
        if (c.children.length > 0) c.children = lower(c.children, depth + 1, [])
        if (c.children.length === 0 && !c.svg && !c.img && depth > MAX_NESTED_CONTAINERS) {
          for (const l of leafNodes(c, info)) out.push(l)
          const twin = infos.get(`${c.id}t`)
          if (twin) twin.chain = chain
        } else out.push(c)
      }
    }
    return out
  }
  measured.root.children = lower(measured.root.children, 1, [])
  if (dissolved.length > 0) {
    notes.push({
      where: 'nesting depth',
      message: `${dissolved.length} wrapper(s) sat deeper than the engine's compound nesting allows; each became a plain layer and pushed its opacity and transform down into its contents.${masksLost ? ` ${masksLost} of them clipped their contents (overflow / clip-path); that clip is lost.` : ''}`,
    })
  }

  // --- 5. fold the base pose into the style the emitter reads --------------------------------------------------
  const poseOf = (own: NodeInfo, cOf: (i: NodeInfo) => Aff): Aff => {
    let abs = IDENTITY
    for (const i of [...own.chain, own]) abs = mul(abs, aboutOrigin(cOf(i), i.origin.x, i.origin.y))
    return relativeTo(abs, own.origin.x, own.origin.y)
  }
  let skewNoted = false
  const finalNodes: MeasuredNode[] = []
  walk(measured.root, (n) => {
    if (n !== measured.root) finalNodes.push(n)
  })
  for (const n of finalNodes) {
    const info = infoOf(n)
    const pose = decompose(poseOf(info, (i) => i.baseC))
    info.pose0 = pose
    let opacity = info.baseOpacity
    for (const c of info.chain) opacity *= c.baseOpacity
    const st = n.style
    st.opacity = opacity
    const moved = Math.abs(pose.tx) > 1e-6 || Math.abs(pose.ty) > 1e-6
    const rot = pose.rot ?? 0
    const scaled = Math.abs(pose.sx - 1) > 1e-6 || Math.abs(pose.sy - 1) > 1e-6
    st.translate = moved ? `${pose.tx}px ${pose.ty}px` : undefined
    st.rotate = Math.abs(rot) > 1e-9 ? `${rot}rad` : undefined
    st.scale = scaled ? `${pose.sx} ${pose.sy}` : undefined
    if (Math.abs(pose.shear) > 0.02 && !skewNoted) {
      skewNoted = true
      notes.push({ where: describe(info.mounted), message: 'A skew in the static transform is dropped (the engine clip has rotation and scale only).' })
    }
    // A wrapper that is animated must stay its own compound; a no-look single child would be merged into it.
    if (n.children.length === 1 && (isAnimated(info) || info.chain.some(isAnimated)) && st.translate === undefined) st.translate = '0px 0px'
  }

  // --- 6. emit ----------------------------------------------------------------------------------------------------
  progress(0.1, 'Building native clips...')
  const scene: MeasuredScene = { name: measured.name, at: 0, duration: page.durationSeconds, stage, root: measured.root }
  const emitted = sceneToClip(scene, { fps })
  const sceneReport: SceneReport = emitted.report
  const nested = emitted.clip.compound?.project
  if (!nested) throw new Error('The converter produced no clips.')
  let project: Project = { ...nested, id: 'page-scene', fps, stage, version: 5 }

  for (const s of sceneReport.skipped) {
    if (s.feature === 'nesting-depth') notes.push({ where: 'nesting depth', message: `The emitter still flattened ${s.count} wrapper(s) beyond its depth limit.` })
    else notes.push({ where: s.feature, message: `Not converted (${s.count}): ${s.feature}` })
  }
  for (const s of sceneReport.substitutions) notes.push({ where: s.feature, message: `Substituted: ${s.feature} -> ${s.used}` })
  for (const v of sceneReport.violations ?? []) notes.push({ where: v.element, message: v.message })

  // --- 7. sample the page, frame by frame ---------------------------------------------------------------------------
  // Elements to read: every animated element, every dissolved ancestor of a tracked node, animated SVG shapes.
  const tracked: NodeInfo[] = []
  for (const n of finalNodes) {
    const info = infoOf(n)
    if (isAnimated(info) || info.chain.some(isAnimated)) tracked.push(info)
  }
  const svgTracked: SvgChild[] = []
  for (const sc of data.svg.values()) {
    const mounted = data.hostToMounted.get(sc.host)!
    if (animatedEls.has(mounted) || (sc.draw && sc.draw.base < 1)) svgTracked.push(sc)
  }
  const sampled = new Map<Element, Samples>()
  const want = new Set<Element>()
  for (const t of tracked) {
    want.add(t.mounted)
    for (const c of t.chain) want.add(c.mounted)
  }
  for (const sc of svgTracked) want.add(data.hostToMounted.get(sc.host)!)
  for (const el of want) {
    sampled.set(el, {
      op: new Float64Array(frames),
      c: new Float64Array(frames * 6),
      threeD: false,
      blur: new Float64Array(frames),
      ls: new Float64Array(frames),
      dash: new Float64Array(frames),
    })
  }
  const styles = new Map<Element, CSSStyleDeclaration>()
  for (const el of want) styles.set(el, getComputedStyle(el))
  try {
    for (let f = 0; f < frames; f++) {
      seekAnimations(anims, f / fps)
      for (const [el, s] of sampled) {
        const cs = styles.get(el)!
        s.op[f] = parseFloat(cs.opacity)
        const read = readComposite(el, cs)
        if (read.threeD) s.threeD = true
        s.c.set(read.c, f * 6)
        s.blur[f] = blurOf(cs.filter).blur
        s.ls[f] = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0
        s.dash[f] = parseFloat(cs.strokeDashoffset) || 0
      }
      if (f % 30 === 0) {
        progress(0.1 + 0.6 * (f / frames), `Sampling the page: frame ${f} of ${frames}`)
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  } finally {
    seekAnimations(anims, resumeAt)
  }

  // --- 8. channels -----------------------------------------------------------------------------------------------------
  progress(0.75, 'Converting animation to keyframes...')
  interface ClipRef {
    clip: Clip
    stage: Stage
  }
  const refs = new Map<string, ClipRef>()
  const indexClips = (p: Project): void => {
    for (const list of Object.values(p.clips)) {
      for (const c of list) {
        refs.set(c.name, { clip: c, stage: p.stage })
        if (c.compound?.project) indexClips(c.compound.project)
      }
    }
  }
  indexClips(project)

  interface ClipPatch {
    channels: Map<string, Keyframe[]>
    effect?: { id: string; radius: number }
    draw?: number
  }
  const patches = new Map<string, ClipPatch>()
  const patchFor = (name: string): ClipPatch => {
    let p = patches.get(name)
    if (!p) {
      p = { channels: new Map() }
      patches.set(name, p)
    }
    return p
  }

  const nativeList: ChannelEntry[] = []
  const sampledList: ChannelEntry[] = []
  let pinned = 0
  const convertedAnims = new Set<AnimInfo>()
  const convertedKeys = new Set<string>()
  const coveredEls = new Set<Element>()
  const threeDNoted = new Set<Element>()
  let blurPushNoted = false

  const take =(name: string, where: string, results: ChannelResult[], used: AnimInfo[]): void => {
    for (const r of results) {
      if (r.mode === 'unchanged') continue
      patchFor(name).channels.set(r.channel, r.keys)
      convertedKeys.add(name)
      if (r.mode === 'native') nativeList.push({ where, channel: r.channel, keys: r.keys.length, detail: `max error ${(100 * r.maxErr).toFixed(2)}% of range` })
      else if (r.mode === 'sampled') sampledList.push({ where, channel: r.channel, keys: r.keys.length, detail: r.reason ?? 'sampled' })
      else pinned++
      for (const a of used) convertedAnims.add(a)
    }
  }
  const unhandled = (aList: readonly AnimInfo[]): void => {
    for (const a of aList) {
      if (a.props.size === 0) addUnconverted(`${describe(a.el)} @keyframes ${a.name}`, 'the animation exposes no readable property (a custom-property counter registered with @property is not animatable inside the page shadow root)')
      for (const p of a.props) {
        if (HANDLED.has(p)) continue
        addUnconverted(`${describe(a.el)} { ${kebab(p)} } @keyframes ${a.name}`, p.startsWith('--') ? 'custom-property animation (an @property counter, say) has no native channel' : `no native channel for ${kebab(p)}`)
      }
    }
  }

  const poseChannels = (
    ref: ClipRef,
    raw: Pose[],
    p0: Pose,
    unit: number,
    where: string,
  ): ChannelInput[] | null => {
    const t0 = ref.clip.transform
    if (!t0) return null
    const pw = ref.stage.width
    const ph = ref.stage.height
    const rot0 = p0.rot ?? 0
    const unwrapped = unwrapAngles(raw.map((p) => p.rot), rot0)
    const out: ChannelInput[] = [
      { channel: 'x', series: raw.map((p) => t0.x + ((p.tx - p0.tx) * unit) / pw), baseline: t0.x, eps: eps.x },
      { channel: 'y', series: raw.map((p) => t0.y + ((p.ty - p0.ty) * unit) / ph), baseline: t0.y, eps: eps.y },
      { channel: 'rotation', series: unwrapped.map((r) => t0.rotation + (r - rot0)), baseline: t0.rotation, eps: eps.rotation },
    ]
    if (Math.abs(p0.sx) < 1e-6 || Math.abs(p0.sy) < 1e-6) {
      if (raw.some((p) => Math.abs(p.sx - p0.sx) > 1e-4 || Math.abs(p.sy - p0.sy) > 1e-4)) addUnconverted(where, 'scale animated from a base scale of 0 cannot be expressed relative to it')
      return out
    }
    const rx = raw.map((p) => p.sx / p0.sx)
    const ry = raw.map((p) => p.sy / p0.sy)
    let spread = 0
    let top = 1
    for (let i = 0; i < rx.length; i++) {
      spread = Math.max(spread, Math.abs(rx[i]! - ry[i]!))
      top = Math.max(top, Math.abs(rx[i]!))
    }
    if (spread <= 1e-4 * top) {
      out.push({ channel: 'scale', series: rx.map((r) => t0.scale * r), baseline: t0.scale, eps: eps.scale })
    } else {
      const bx = t0.scaleX ?? 1
      const by = t0.scaleY ?? 1
      out.push({ channel: 'scaleX', series: rx.map((r) => bx * r), baseline: bx, eps: eps.scaleX })
      out.push({ channel: 'scaleY', series: ry.map((r) => by * r), baseline: by, eps: eps.scaleY })
    }
    return out
  }

  for (const n of finalNodes) {
    const info = infoOf(n)
    const key = info.key
    // A static blur is an effect on the clip, keyed or not. A dissolved wrapper's blur is applied to each of its
    // contents, in quadrature with their own (blur of a blur is the root of the summed squares).
    const blurChain = [...info.chain, info]
    const baseBlur = Math.sqrt(blurChain.reduce((s, c) => s + c.baseBlur * c.baseBlur, 0))
    if (baseBlur > 0 && refs.has(key)) {
      const e = createEffect('gaussianBlur')
      patchFor(key).effect = { id: e.id, radius: Math.min(100, baseBlur) }
      if (baseBlur > 100) notes.push({ where: describe(info.mounted), message: `blur(${Math.round(baseBlur)}px) exceeds the engine's 100 px maximum and was clamped` })
      if (info.chain.some((c) => c.baseBlur > 0) && !blurPushNoted) {
        blurPushNoted = true
        notes.push({ where: describe(info.chain.find((c) => c.baseBlur > 0)!.mounted), message: 'Blur on a dissolved wrapper is applied to each of its contents (an approximation of blurring the group).' })
      }
    }
    const aList = [...info.chain, info].flatMap((i) => byEl.get(i.mounted) ?? [])
    if (aList.length === 0) continue
    for (const i of [...info.chain, info]) coveredEls.add(i.mounted)
    const ref = refs.get(key)
    const where = describe(info.mounted)
    unhandled(aList)
    if (!ref) {
      // A wrapper's animation is only worth reporting when the element itself was animated (its children may be empty boxes).
      if (byEl.has(info.mounted)) addUnconverted(where, 'no native clip was made for this element (empty box or nothing to draw)')
      continue
    }
    const own = sampled.get(info.mounted)!
    const chain = [...info.chain, info]

    // opacity
    const opAnims = aList.filter((a) => a.props.has('opacity'))
    if (opAnims.length > 0) {
      const series: number[] = []
      for (let f = 0; f < frames; f++) {
        let v = 1
        for (const c of chain) v *= sampled.get(c.mounted)!.op[f]!
        series.push(Math.min(1, Math.max(0, v)))
      }
      take(key, where, buildGroup(fps, frames, timingsFor(aList, ['opacity']), [{ channel: 'opacity', series, baseline: ref.clip.opacity ?? 1, eps: eps.opacity, clamp: [0, 1] }]), opAnims)
    }

    // pose
    const poseAnims = aList.filter((a) => POSE_PROPS.some((p) => a.props.has(p)))
    if (poseAnims.length > 0 && info.pose0) {
      const raw: Pose[] = []
      for (let f = 0; f < frames; f++) {
        let abs: Aff = IDENTITY
        for (const c of chain) {
          const s = sampled.get(c.mounted)!
          abs = mul(abs, aboutOrigin(Array.from(s.c.subarray(f * 6, f * 6 + 6)) as Aff, c.origin.x, c.origin.y))
        }
        raw.push(decompose(relativeTo(abs, info.origin.x, info.origin.y)))
      }
      if (chain.some((c) => sampled.get(c.mounted)!.threeD) && !threeDNoted.has(info.mounted)) {
        threeDNoted.add(info.mounted)
        notes.push({ where, message: '3D transform in an animation (rotateX / rotateY / perspective) was flattened to its 2D part' })
      }
      if (raw.some((p) => Math.abs(p.shear) > 0.02)) addUnconverted(where, 'skew in an animated transform: the converted clip rotates and scales without the skew')
      const channels = poseChannels(ref, raw, info.pose0, 1, where)
      if (channels) take(key, where, buildGroup(fps, frames, timingsFor(aList, POSE_PROPS), channels), poseAnims)
    }

    // blur (own element, plus the dissolved wrappers above it)
    const blurAnims = aList.filter((a) => a.props.has('filter'))
    if (blurAnims.length > 0) {
      const patch = patchFor(key)
      if (!patch.effect) patch.effect = { id: createEffect('gaussianBlur').id, radius: Math.min(100, baseBlur) }
      const series: number[] = []
      for (let f = 0; f < frames; f++) {
        let sq = 0
        for (const c of blurChain) sq += sampled.get(c.mounted)!.blur[f]! ** 2
        series.push(Math.min(100, Math.sqrt(sq)))
      }
      take(key, where, buildGroup(fps, frames, timingsFor(blurAnims, ['filter']), [{ channel: `fx.${patch.effect.id}.radius`, series, baseline: patch.effect.radius, eps: eps.px, clamp: [0, 100] }]), blurAnims)
    }

    // letter spacing (text clips)
    const lsAnims = (byEl.get(info.mounted) ?? []).filter((a) => a.props.has('letterSpacing'))
    if (lsAnims.length > 0) {
      if (ref.clip.type === 'text') {
        take(key, where, buildGroup(fps, frames, timingsFor(lsAnims, ['letterSpacing']), [{ channel: 'text.letterSpacing', series: Array.from(own.ls), baseline: ref.clip.textBox?.letterSpacing ?? 0, eps: eps.px }]), lsAnims)
      } else addUnconverted(where, 'letter-spacing on a container: its text children inherit it; not converted')
    }
    // stroke-dashoffset on an HTML element is not a draw-on.
    if (aList.some((a) => a.props.has('strokeDashoffset') && !(a.el instanceof SVGElement))) addUnconverted(where, 'stroke-dashoffset on a non-SVG element')
  }

  // SVG shapes (importer names them by id).
  for (const sc of data.svg.values()) {
    const mounted = data.hostToMounted.get(sc.host)!
    const aList = byEl.get(mounted) ?? []
    // An SVG with a single shape is imported as that one shape clip, named after the <svg> itself.
    let target = sc.name
    let sole = false
    let ref = refs.get(target)
    if (!ref) {
      const rootHost = sc.host.closest('svg')
      const rootKey = rootHost ? `hf${data.hostIndex.get(rootHost)}` : ''
      const rootRef = refs.get(rootKey)
      if (rootRef && rootRef.clip.type === 'shape') {
        target = rootKey
        ref = rootRef
        sole = true
      }
    }
    const where = describe(mounted)
    if (sc.draw && sc.draw.base < 1 && ref && ref.clip.type === 'shape') patchFor(target).draw = sc.draw.base
    if (aList.length === 0) continue
    coveredEls.add(mounted)
    unhandled(aList)
    if (!ref || ref.clip.type !== 'shape') {
      addUnconverted(where, 'SVG shape has no native clip')
      continue
    }
    const s = sampled.get(mounted)!
    const opAnims = aList.filter((a) => a.props.has('opacity'))
    const poseAnims = aList.filter((a) => POSE_PROPS.some((p) => a.props.has(p)))
    if (sole && (opAnims.length > 0 || poseAnims.length > 0)) {
      addUnconverted(where, 'opacity / transform animation on the only shape of an SVG: the clip is shared with the <svg> element, only draw-on is converted')
    } else {
      if (opAnims.length > 0) {
        take(target, where, buildGroup(fps, frames, timingsFor(aList, ['opacity']), [{ channel: 'opacity', series: Array.from(s.op, (v) => Math.min(1, Math.max(0, v))), baseline: ref.clip.opacity ?? 1, eps: eps.opacity, clamp: [0, 1] }]), opAnims)
      }
      if (poseAnims.length > 0) {
        if (!sc.baseIdentity || !sc.originCentre) addUnconverted(where, 'SVG transform animation needs transform-box: fill-box with the origin at the centre and no static transform')
        else {
          const raw: Pose[] = []
          for (let f = 0; f < frames; f++) raw.push(decompose(Array.from(s.c.subarray(f * 6, f * 6 + 6)) as Aff))
          const unit = ref.stage.width / sc.vbWidth
          const channels = poseChannels(ref, raw, decompose(IDENTITY), unit, where)
          if (channels) take(target, where, buildGroup(fps, frames, timingsFor(aList, POSE_PROPS), channels), poseAnims)
        }
      }
    }
    const dashAnims = aList.filter((a) => a.props.has('strokeDashoffset'))
    if (dashAnims.length > 0) {
      if (!sc.draw) addUnconverted(where, 'stroke-dashoffset without a draw-on dash pattern (pathLength + one dash + a gap longer than the path)')
      else {
        const { dash, total } = sc.draw
        const series = Array.from(s.dash, (off) => Math.min(1, Math.max(0, (dash - off) / total)))
        take(target, where, buildGroup(fps, frames, timingsFor(dashAnims, ['strokeDashoffset']), [{ channel: 'draw', series, baseline: sc.draw.base, eps: eps.draw, clamp: [0, 1] }]), dashAnims)
      }
    }
  }

  // Animated elements nobody covered (no clip, an SVG group, text in an SVG ...).
  for (const [el, list] of byEl) {
    if (coveredEls.has(el)) continue
    const tag = el.localName
    for (const a of list) {
      addUnconverted(`${describe(el)} @keyframes ${a.name}`, el instanceof SVGElement && !SHAPE_TAGS.has(tag) ? `an SVG <${tag}> is not converted (shapes only)` : 'the element has no native clip (empty box, display: none or inside an unsupported container)')
    }
  }

  // --- 9. write the patches into the clips and name them ------------------------------------------------------------
  const used = new Map<string, number>()
  const friendly = (info: NodeInfo): string => {
    const authored = info.host.id && !/^hfs?\d+$/.test(info.host.id) ? info.host.id : ''
    const cls = Array.from(info.host.classList)[0]?.replace(/[^\w-]/g, '')
    const scene = info.host.getAttribute('data-scene')?.trim().replace(/\s+/g, '-')
    const base = authored || scene || cls || info.host.localName
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
  const names = new Map<string, string>()
  const byIndex = (a: NodeInfo, b: NodeInfo) => parseInt(a.key.slice(2), 10) - parseInt(b.key.slice(2), 10)
  for (const info of [...infos.values()].filter((i) => !i.key.endsWith('t')).sort(byIndex)) {
    if (!info.dissolved || refs.has(info.key)) names.set(info.key, friendly(info))
  }
  for (const info of infos.values()) {
    if (info.key.endsWith('t') && names.has(info.key.slice(0, -1))) names.set(info.key, `${names.get(info.key.slice(0, -1))}-text`)
  }
  for (const sc of data.svg.values()) if (/^hfs\d+$/.test(sc.name)) names.set(sc.name, `${sc.tag}-${sc.name.slice(3)}`)

  project = mapProject(project, (clip) => {
    let out = clip
    const patch = patches.get(clip.name)
    if (patch) {
      for (const [ch, keys] of patch.channels) out = setChannel(out, ch, keys)
      if (patch.effect) out = { ...out, effects: [...(out.effects ?? []), { id: patch.effect.id, kind: 'gaussianBlur', params: { radius: patch.effect.radius } }] }
      if (patch.draw !== undefined) out = { ...out, shapeDraw: { start: 0, end: patch.draw } }
    }
    const m = /^(hfs?\d+t?)(-bg|-text)?$/.exec(out.name)
    const friendlyName = m ? names.get(m[1]!) : undefined
    return friendlyName ? { ...out, name: `${friendlyName}${m![2] ?? ''}` } : out
  })

  const elementsConverted = new Set<string>(convertedKeys)
  const report: ConversionReport = {
    elements: elementsConverted.size,
    animations: convertedAnims.size,
    clips: countClips(project),
    channels: { native: nativeList.length, sampled: sampledList.length, pinned },
    nativeList,
    sampledList,
    unconverted,
    notes,
    ms: Math.round(performance.now() - started),
  }
  const converted: Converted = { title, kind: 'page', project, fps, stage, issues: [] }
  const conv: PageConversion = { converted, report, text: reportText(title, report) }
  const verifyNodes = finalNodes.flatMap((n) => {
    const info = infoOf(n)
    const name = names.get(info.key)
    const index = data.hostIndex.get(info.host)
    return name !== undefined && index !== undefined ? [{ key: info.key, name, index, origin: info.origin, svg: !!n.svg }] : []
  })
  const verify = (times: readonly number[]) => verifyConversion({ page, project, nodes: verifyNodes, origins: Object.fromEntries(data.origins) }, times)
  // Handle for browser checks (the numeric HTML-vs-native comparison reads it).
  ;(window as unknown as { __elahConvert?: unknown }).__elahConvert = { conversion: conv, names: Object.fromEntries(names), buildGroup, fitBezier, verify }
  progress(1, 'Done')
  return conv
}

export function reportText(title: string, r: ConversionReport): string {
  const lines = [
    `${title}: converted ${r.elements} elements, ${r.animations} animations -> native (${r.clips} clips).`,
    `Channels: ${r.channels.native} native, ${r.channels.sampled} sampled, ${r.channels.pinned} pinned.`,
  ]
  if (r.sampledList.length) {
    lines.push('', 'Sampled channels:')
    for (const s of r.sampledList) lines.push(`  ${s.where} ${s.channel} (${s.keys} keys): ${s.detail}`)
  }
  if (r.unconverted.length) {
    lines.push('', 'Could not convert:')
    for (const u of r.unconverted) lines.push(`  ${u.where}: ${u.message}`)
  }
  if (r.notes.length) {
    lines.push('', 'Notes:')
    for (const u of r.notes) lines.push(`  ${u.where}: ${u.message}`)
  }
  return lines.join('\n')
}
