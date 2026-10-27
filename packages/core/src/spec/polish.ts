/**
 * polishSpec and lintSpec — the craft rules that hold for every element (AV-9).
 *
 * Components (./components) carry the motion design of a PART. This pass
 * carries the motion design of the WHOLE PIECE, and it applies equally to what
 * a component made and to what the model wrote by hand:
 *
 *   - nothing appears or vanishes without motion
 *   - siblings stagger instead of arriving together
 *   - beats overlap and hand off instead of cutting to an empty frame
 *   - the frame breathes: a slow camera push, an ambient layer that never stops
 *
 * Both are spec → spec and pure. `polishSpec` only FILLS GAPS — it never
 * overrides a choice the author made explicitly — and applying it twice must
 * equal applying it once.
 *
 * ---------------------------------------------------------------------------
 * Why this file does not import `./components` or `./components/motion`'s
 * registry-backed helpers (`ENERGY_TIME_SCALE`, `seededRandom`)
 * ---------------------------------------------------------------------------
 * `./components/library/**` is being built in parallel (AV-8a/8b) and this
 * file must not take on a dependency that could shift under it mid-ticket.
 * `./components/motion` itself is finished (AV-8's shared toolkit) and safe to
 * use directly — every arrival/exit/idle curve below goes through it, exactly
 * as the craft brief asks, so a polish-added motion and a component-added
 * motion read as one designer. The tiny energy-scale table and the seeded PRNG
 * are mirrored locally (same numbers as `components/index.ts`) rather than
 * imported from the index, which would pull in the in-flight library.
 *
 * ---------------------------------------------------------------------------
 * The passes, in order
 * ---------------------------------------------------------------------------
 *   1. stagger      — siblings tied at the same `at`, at every nesting level
 *   2. arrivals/exits — per element, at every nesting level
 *   3. idle life     — per element, at every nesting level
 *   4. camera push   — top-level `group`s only ("a beat")
 *   5. hand-offs     — between ADJACENT top-level elements whose timing
 *                      touches exactly, per `style.transition`
 *   6. ambient layer — appended once, spanning the (possibly hand-off
 *                      extended) piece duration
 *
 * Anything this pass itself generates is namespaced `polish-...` and is never
 * re-processed by an earlier step on a second pass — see `isPolishGenerated`
 * — which is what makes the whole pipeline idempotent without a special case
 * for "already polished".
 */

import type { SpecElement, SpecExpression, SpecIssue, SpecKey, VideoSpec } from './types'
import type { AmbientKind, ComponentContext, MotionEnergy, MotionStyle } from './components/types'
import { cameraPush, exitOut, floatY, popIn, readingSeconds, riseIn, STAGGER_SEC } from './components/motion'

export interface PolishOptions {
  seed?: number
}

export interface PolishResult {
  spec: VideoSpec
  /** `info` notes on what the pass added, so the plan card can say so. */
  issues: SpecIssue[]
}

const EPS = 1e-6
const ARRIVAL_CHANNELS = ['opacity', 'scale', 'x', 'y'] as const
const EXIT_CHANNELS = ['opacity', 'scale'] as const
const IDLE_CHANNELS = ['x', 'y', 'scale'] as const
const IDLE_MIN_HOLD = 1.2
const HANDOFF_OVERLAP_SEC = 0.25
const WIPE_SEC = 0.8
const WIPE_LAYER = 50

// ---------------------------------------------------------------------------
// Local mirrors of the tiny bits `components/index.ts` also defines — see the
// file doc comment for why these are not imported from there.
// ---------------------------------------------------------------------------

/** Mirrors `components/index.ts`'s `ENERGY_TIME_SCALE`: calm breathes, bold snaps. */
const ENERGY_SCALE: Readonly<Record<MotionEnergy, number>> = { calm: 1.3, standard: 1, bold: 0.75 }

/** Mirrors `components/index.ts`'s `seededRandom` — a small, fast, seeded PRNG (mulberry32). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mirrors `components/index.ts`'s `hashString` (FNV-1a). */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Design tokens, read straight from `spec.design` — polish runs after
// expansion and has no `ComponentContext` of its own to hand it a resolver.
// ---------------------------------------------------------------------------

type ColorRole = 'bg' | 'ink' | 'muted' | 'accent' | 'accentSoft' | 'surface'

const DEFAULT_COLORS: Readonly<Record<ColorRole, string>> = {
  bg: '#f7f7f5',
  ink: '#111111',
  muted: '#8a8a8a',
  accent: '#22c55e',
  accentSoft: '#bbf7d0',
  surface: '#ffffff',
}

/** `$role` when the design defines that name, else a literal default. For fields the compiler token-resolves (fill/stroke/color). */
function colorToken(design: VideoSpec['design'], role: ColorRole): string {
  const has = (design?.colors ?? []).some((c) => c.name === role)
  return has ? `$${role}` : DEFAULT_COLORS[role]
}

/** The literal hex a role resolves to. For fields the compiler does NOT token-resolve (generator/effect params, gradient stops). */
function colorLiteral(design: VideoSpec['design'], role: ColorRole): string {
  const entry = (design?.colors ?? []).find((c) => c.name === role)
  return entry?.value ?? DEFAULT_COLORS[role]
}

/** A `ComponentContext` built from spec-level state, for `./components/motion`'s helpers. `path` seeds its own randomness so two elements never draw the same sequence. */
function makeCtx(spec: VideoSpec, style: MotionStyle, seed: number, path: string): ComponentContext {
  return {
    format: spec.format,
    style,
    color: (role) => colorToken(spec.design, role),
    font: () => 'inter', // unused by every motion.ts helper this file calls
    random: seededRandom(hashString(`${seed}:${path}`)),
    t: (seconds) => seconds * ENERGY_SCALE[style.energy],
    path,
    issues: [],
  }
}

// ---------------------------------------------------------------------------
// Small pure predicates, each named so a mutation on it fails a named test.
// ---------------------------------------------------------------------------

/** Anything this pass itself added (ambient layer, hand-off wipes) — never re-processed on a later pass. */
function isPolishGenerated(el: SpecElement): boolean {
  return el.id.startsWith('polish-')
}

function hasKeyOrExprOn(el: SpecElement, channels: ReadonlyArray<string>): boolean {
  return (el.keys ?? []).some((k) => channels.includes(k.channel)) || (el.expressions ?? []).some((e) => channels.includes(e.channel))
}

/** An element with no `enter`, no arrival keys/expression and no `reveal` needs one. */
function arrivalGapFor(el: SpecElement): boolean {
  if (el.kind === 'audio') return false
  if (el.enter || el.reveal) return false
  return !hasKeyOrExprOn(el, ARRIVAL_CHANNELS)
}

/**
 * An element with no `exit` and no authored key/expression in the BACK HALF of
 * its own duration on opacity/scale needs one. The back-half test (rather than
 * "any key at all") is what lets an element that only has arrival keys still
 * get an exit — which is exactly the gap the craft brief measured: entrances
 * everywhere, exits almost nowhere.
 */
function exitGapFor(el: SpecElement): boolean {
  if (el.kind === 'audio') return false
  if (el.exit) return false
  const half = el.duration / 2
  const lateKey = (el.keys ?? []).some((k) => EXIT_CHANNELS.includes(k.channel as (typeof EXIT_CHANNELS)[number]) && k.at >= half)
  const anyExpr = (el.expressions ?? []).some((e) => EXIT_CHANNELS.includes(e.channel as (typeof EXIT_CHANNELS)[number]))
  return !lateKey && !anyExpr
}

/** Holds still (no key/expression on x/y/scale) for longer than it takes to notice. */
function idleGapFor(el: SpecElement): boolean {
  if (el.duration <= IDLE_MIN_HOLD) return false
  return !hasKeyOrExprOn(el, IDLE_CHANNELS)
}

/** `el.scale`/`el.opacity` are the element's real target; a helper's keys assume 1 — rescale them onto the author's actual value. */
function rescaleKeys(keys: SpecKey[], el: SpecElement): SpecKey[] {
  const s = el.scale ?? 1
  const o = el.opacity ?? 1
  if (s === 1 && o === 1) return keys
  return keys.map((k) => (k.channel === 'scale' ? { ...k, value: k.value * s } : k.channel === 'opacity' ? { ...k, value: k.value * o } : k))
}

// ---------------------------------------------------------------------------
// Counts, for the self-explaining `info` issues
// ---------------------------------------------------------------------------

interface Counts {
  arrivals: number
  exits: number
  staggerGroups: number
  staggered: number
  idle: number
  camera: number
  handoffs: number
  ambientKind?: AmbientKind
}

function plural(n: number): string {
  return n === 1 ? '' : 's'
}

function buildInfoIssues(counts: Counts, style: MotionStyle): SpecIssue[] {
  const out: SpecIssue[] = []
  const add = (message: string) => out.push({ severity: 'info', path: 'elements', code: 'polished', message })
  if (counts.arrivals > 0) add(`added arrivals to ${counts.arrivals} element${plural(counts.arrivals)}`)
  if (counts.exits > 0) add(`added exits to ${counts.exits} element${plural(counts.exits)}`)
  if (counts.staggerGroups > 0) {
    add(`staggered ${counts.staggered} sibling${plural(counts.staggered)} across ${counts.staggerGroups} group${plural(counts.staggerGroups)}`)
  }
  if (counts.idle > 0) add(`added idle float to ${counts.idle} element${plural(counts.idle)}`)
  if (counts.camera > 0) add(`camera push on ${counts.camera} beat${plural(counts.camera)}`)
  if (counts.handoffs > 0) add(`${style.transition} hand-off at ${counts.handoffs} ${counts.handoffs === 1 ? 'boundary' : 'boundaries'}`)
  if (counts.ambientKind) add(`ambient ${counts.ambientKind} layer`)
  return out
}

// ---------------------------------------------------------------------------
// 1. Stagger — siblings tied at the exact same `at`, spread in reading order
// ---------------------------------------------------------------------------

function staggerLevel(elements: ReadonlyArray<SpecElement>, style: MotionStyle, counts: Counts): SpecElement[] {
  const ties = new Map<number, number[]>()
  elements.forEach((el, i) => {
    if (isPolishGenerated(el)) return
    const key = Math.round(el.at * 1e6)
    const list = ties.get(key)
    if (list) list.push(i)
    else ties.set(key, [i])
  })
  const groups = [...ties.values()].filter((idxs) => idxs.length > 1)
  if (groups.length === 0) return [...elements]

  const out = [...elements]
  const step = STAGGER_SEC * ENERGY_SCALE[style.energy]
  for (const idxs of groups) {
    const ordered = [...idxs].sort((a, b) => {
      const ea = elements[a]!
      const eb = elements[b]!
      const ya = ea.y ?? 0.5
      const yb = eb.y ?? 0.5
      if (Math.abs(ya - yb) > EPS) return ya - yb
      return (ea.x ?? 0.5) - (eb.x ?? 0.5)
    })
    ordered.forEach((idx, rank) => {
      if (rank === 0) return
      const el = out[idx]!
      out[idx] = { ...el, at: +(el.at + step * rank).toFixed(6) }
      counts.staggered++
    })
    counts.staggerGroups++
  }
  return out
}

// ---------------------------------------------------------------------------
// 2 & 3. Arrivals/exits and idle life, per element
// ---------------------------------------------------------------------------

function applyArrivalExit(el: SpecElement, spec: VideoSpec, style: MotionStyle, seed: number, path: string, counts: Counts): SpecElement {
  if (isPolishGenerated(el)) return el
  const spansWhole = el.duration >= spec.duration - EPS
  if (spansWhole) return el

  const needsArrival = arrivalGapFor(el)
  const needsExit = exitGapFor(el)
  if (!needsArrival && !needsExit) return el

  const ctx = makeCtx(spec, style, seed, path)
  let keys = el.keys ? [...el.keys] : []
  if (needsArrival) {
    const raw = el.kind === 'text' ? riseIn(ctx, el.y ?? 0.5) : popIn(ctx)
    keys = [...keys, ...rescaleKeys(raw, el)]
    counts.arrivals++
  }
  if (needsExit) {
    const raw = exitOut(ctx, el.duration)
    keys = [...keys, ...rescaleKeys(raw, el)]
    counts.exits++
  }
  return { ...el, keys }
}

function applyIdleLife(el: SpecElement, spec: VideoSpec, style: MotionStyle, seed: number, index: number, path: string, counts: Counts): SpecElement {
  if (isPolishGenerated(el)) return el
  if (!idleGapFor(el)) return el
  const ctx = makeCtx(spec, style, seed, path)
  const phase = +(index * 0.6).toFixed(3)
  const expr: SpecExpression = floatY(ctx, 6, 3.2, phase)
  counts.idle++
  return { ...el, expressions: [...(el.expressions ?? []), expr] }
}

/** Stagger, then per-element arrival/exit/idle-life, recursing into `group` children first. */
function polishLevel(elements: ReadonlyArray<SpecElement>, spec: VideoSpec, style: MotionStyle, seed: number, pathPrefix: string, counts: Counts): SpecElement[] {
  const staggered = staggerLevel(elements, style, counts)
  return staggered.map((el, i) => {
    const path = `${pathPrefix}[${i}]`
    if (isPolishGenerated(el)) return el
    let working = el
    if (working.kind === 'group') {
      working = { ...working, children: polishLevel(working.children ?? [], spec, style, seed, `${path}.children`, counts) }
    }
    working = applyArrivalExit(working, spec, style, seed, path, counts)
    working = applyIdleLife(working, spec, style, seed, i, path, counts)
    return working
  })
}

// ---------------------------------------------------------------------------
// 4. Camera push — top-level `group`s ("a beat") only
// ---------------------------------------------------------------------------

function applyCamera(topLevel: ReadonlyArray<SpecElement>, style: MotionStyle, counts: Counts): SpecElement[] {
  if (!style.camera) return [...topLevel]
  return topLevel.map((el) => {
    if (isPolishGenerated(el)) return el
    if (el.kind !== 'group') return el
    if (hasKeyOrExprOn(el, ['scale'])) return el
    counts.camera++
    return { ...el, keys: [...(el.keys ?? []), ...cameraPush(el.duration)] }
  })
}

// ---------------------------------------------------------------------------
// 5. Hand-offs — adjacent top-level elements whose timing touches exactly
// ---------------------------------------------------------------------------

interface HandoffPair {
  endIdx: number
  startIdx: number
}

/** Pairs of ARRAY-ADJACENT top-level elements where the first ends exactly where the second starts. Computed once, from the pre-polish array, so later passes cannot manufacture or hide a boundary. */
function findHandoffBoundaries(top: ReadonlyArray<SpecElement>): HandoffPair[] {
  const out: HandoffPair[] = []
  for (let i = 0; i < top.length - 1; i++) {
    const a = top[i]!
    const b = top[i + 1]!
    if (isPolishGenerated(a) || isPolishGenerated(b)) continue
    if (Math.abs(a.at + a.duration - b.at) < EPS) out.push({ endIdx: i, startIdx: i + 1 })
  }
  return out
}

function extendDuration(el: SpecElement, overlap: number): SpecElement {
  return { ...el, duration: el.duration + overlap }
}

function stripTailKeys(el: SpecElement, channels: ReadonlyArray<string>, fromAt: number): SpecElement {
  const keys = (el.keys ?? []).filter((k) => !(channels.includes(k.channel) && k.at >= fromAt - EPS))
  return { ...el, keys }
}

/** `crossfade` and the fallback for `wipe`/`mask`: extend, then fade out across the overlap. */
function crossfadeTail(el: SpecElement, overlap: number, ctx: ComponentContext): SpecElement {
  const originalDuration = el.duration
  const extended = extendDuration(el, overlap)
  const stripped = stripTailKeys(extended, EXIT_CHANNELS, originalDuration * 0.5)
  const fresh = rescaleKeys(exitOut(ctx, extended.duration, { duration: overlap }), el)
  return { ...stripped, keys: [...(stripped.keys ?? []), ...fresh] }
}

/** `zoom`: the exiting beat scales up while it fades. */
function zoomTail(el: SpecElement, overlap: number): SpecElement {
  const originalDuration = el.duration
  const extended = extendDuration(el, overlap)
  const stripped = stripTailKeys(extended, EXIT_CHANNELS, originalDuration * 0.5)
  const s = el.scale ?? 1
  const o = el.opacity ?? 1
  const tailAt = extended.duration - overlap
  const keys: SpecKey[] = [
    { channel: 'scale', at: tailAt, value: s },
    { channel: 'scale', at: extended.duration, value: s * 1.08, curve: 'smooth' },
    { channel: 'opacity', at: tailAt, value: o },
    { channel: 'opacity', at: extended.duration, value: 0, curve: 'quad-in' },
  ]
  return { ...stripped, keys: [...(stripped.keys ?? []), ...keys] }
}

/** `zoom`: the entering beat scales down from 1.1, unless its own arrival already keys scale. */
function zoomHead(el: SpecElement, overlap: number): SpecElement {
  if (hasKeyOrExprOn(el, ['scale'])) return el
  const s = el.scale ?? 1
  const keys: SpecKey[] = [
    { channel: 'scale', at: 0, value: s * 1.1 },
    { channel: 'scale', at: overlap, value: s, curve: 'smooth' },
  ]
  return { ...el, keys: [...(el.keys ?? []), ...keys] }
}

const SLIDE_TRAVEL = 0.12

/** `slide`: beats push along x — the exiting beat slides out while it fades. */
function slideTail(el: SpecElement, overlap: number): SpecElement {
  const originalDuration = el.duration
  const extended = extendDuration(el, overlap)
  const stripped = stripTailKeys(extended, ['opacity', 'x'], originalDuration * 0.5)
  const baseX = el.x ?? 0.5
  const o = el.opacity ?? 1
  const tailAt = extended.duration - overlap
  const keys: SpecKey[] = [
    { channel: 'x', at: tailAt, value: baseX },
    { channel: 'x', at: extended.duration, value: baseX - SLIDE_TRAVEL, curve: 'ease-in' },
    { channel: 'opacity', at: tailAt, value: o },
    { channel: 'opacity', at: extended.duration, value: 0, curve: 'quad-in' },
  ]
  return { ...stripped, keys: [...(stripped.keys ?? []), ...keys] }
}

/** `slide`: the entering beat slides in, unless its own arrival already keys x. */
function slideHead(el: SpecElement, overlap: number): SpecElement {
  if (hasKeyOrExprOn(el, ['x'])) return el
  const baseX = el.x ?? 0.5
  const keys: SpecKey[] = [
    { channel: 'x', at: 0, value: baseX + SLIDE_TRAVEL },
    { channel: 'x', at: overlap, value: baseX, curve: 'smooth' },
  ]
  return { ...el, keys: [...(el.keys ?? []), ...keys] }
}

/** `wipe`: a full-frame accent rect sweeping across the boundary, on top of everything. */
function makeWipeElement(id: string, boundaryTime: number, spec: VideoSpec, style: MotionStyle): SpecElement {
  const dur = +(WIPE_SEC * ENERGY_SCALE[style.energy]).toFixed(4)
  const at = Math.max(0, +(boundaryTime - dur / 2).toFixed(4))
  const keys: SpecKey[] = [
    { channel: 'x', at: 0, value: -0.6 },
    { channel: 'x', at: dur * 0.5, value: 0.5, curve: 'cubic-out' },
    { channel: 'x', at: dur, value: 1.6, curve: 'ease-in' },
  ]
  return {
    id,
    kind: 'shape',
    name: 'Section wipe',
    at,
    duration: dur,
    layer: WIPE_LAYER,
    shape: 'rect',
    w: spec.format.width,
    h: spec.format.height,
    x: 0.5,
    y: 0.5,
    fill: colorToken(spec.design, 'accent'),
    opacity: 1,
    keys,
  }
}

function applyHandoffs(
  topLevel: ReadonlyArray<SpecElement>,
  pairs: ReadonlyArray<HandoffPair>,
  spec: VideoSpec,
  style: MotionStyle,
  seed: number,
  baseDuration: number,
  counts: Counts,
): { elements: SpecElement[]; duration: number } {
  if (style.transition === 'cut' || pairs.length === 0) return { elements: [...topLevel], duration: baseDuration }

  const working = [...topLevel]
  const extra: SpecElement[] = []
  const overlap = +(HANDOFF_OVERLAP_SEC * ENERGY_SCALE[style.energy]).toFixed(4)

  for (const { endIdx, startIdx } of pairs) {
    const endEl = working[endIdx]!
    const startEl = working[startIdx]!
    const wipeId = `polish-wipe-${endEl.id}-${startEl.id}`
    if (working.some((e) => e.id === wipeId) || extra.some((e) => e.id === wipeId)) continue

    const boundaryTime = endEl.at + endEl.duration
    const ctxEnd = makeCtx(spec, style, seed, `elements[${endIdx}]`)

    switch (style.transition) {
      case 'zoom':
        working[endIdx] = zoomTail(endEl, overlap)
        working[startIdx] = zoomHead(startEl, overlap)
        break
      case 'slide':
        working[endIdx] = slideTail(endEl, overlap)
        working[startIdx] = slideHead(startEl, overlap)
        break
      case 'wipe':
        working[endIdx] = crossfadeTail(endEl, overlap, ctxEnd)
        extra.push(makeWipeElement(wipeId, boundaryTime, spec, style))
        break
      case 'crossfade':
      case 'mask':
      default:
        working[endIdx] = crossfadeTail(endEl, overlap, ctxEnd)
        break
    }
    counts.handoffs++
  }

  const all = [...working, ...extra]
  const trueMax = all.reduce((m, e) => Math.max(m, e.at + e.duration), 0)
  return { elements: all, duration: Math.max(baseDuration, trueMax) }
}

// ---------------------------------------------------------------------------
// 6. Ambient layer
// ---------------------------------------------------------------------------

function ambientOrbs(spec: VideoSpec, seed: number, duration: number): SpecElement[] {
  const rnd = seededRandom(hashString(`${seed}:ambient-orbs`))
  const count = 3 + Math.floor(rnd() * 3) // 3..5
  const out: SpecElement[] = []
  for (let i = 0; i < count; i++) {
    const size = +(500 + rnd() * 400).toFixed(1)
    const x0 = +(0.15 + rnd() * 0.7).toFixed(4)
    const y0 = +(0.15 + rnd() * 0.7).toFixed(4)
    const period = +(8 + rnd() * 6).toFixed(2)
    const period2 = +(period * 1.3).toFixed(2)
    const phase = +(rnd() * 6).toFixed(3)
    const ampX = +(0.03 + rnd() * 0.04).toFixed(4)
    const ampY = +(0.03 + rnd() * 0.04).toFixed(4)
    out.push({
      id: `polish-ambient-orb-${i}`,
      kind: 'shape',
      name: 'Ambient orb',
      at: 0,
      duration,
      layer: -1,
      shape: 'circle',
      w: size,
      h: size,
      x: x0,
      y: y0,
      fill: colorToken(spec.design, 'accentSoft'),
      opacity: 0.1,
      effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 60 }] }],
      expressions: [
        { channel: 'x', source: `value + sin((t + ${phase}) * 2 * PI / ${period}) * ${ampX}` },
        { channel: 'y', source: `value + cos((t + ${phase}) * 2 * PI / ${period2}) * ${ampY}` },
      ],
    })
  }
  return out
}

function ambientDots(spec: VideoSpec, duration: number): SpecElement[] {
  return [
    {
      id: 'polish-ambient-dots-0',
      kind: 'generator',
      name: 'Ambient dust',
      at: 0,
      duration,
      layer: -1,
      generator: 'particles',
      w: spec.format.width,
      h: spec.format.height,
      x: 0.5,
      y: 0.5,
      opacity: 0.12,
      params: [
        { name: 'style', value: 'dust' },
        { name: 'count', value: 60 },
        { name: 'size', value: 6 },
        { name: 'speed', value: 0.4 },
        { name: 'color', value: colorLiteral(spec.design, 'muted') },
      ],
    },
  ]
}

function ambientGrid(spec: VideoSpec, duration: number): SpecElement[] {
  const out: SpecElement[] = []
  const positions = [0.2, 0.4, 0.6, 0.8]
  positions.forEach((p, i) => {
    out.push({
      id: `polish-ambient-grid-v${i}`,
      kind: 'shape',
      shape: 'rect',
      name: 'Ambient grid line',
      at: 0,
      duration,
      layer: -1,
      w: 2,
      h: spec.format.height,
      x: p,
      y: 0.5,
      fill: colorToken(spec.design, 'muted'),
      opacity: 0.08,
      expressions: [{ channel: 'opacity', source: `value + sin((t + ${(i * 0.7).toFixed(2)}) * 2 * PI / 6) * 0.02` }],
    })
    out.push({
      id: `polish-ambient-grid-h${i}`,
      kind: 'shape',
      shape: 'rect',
      name: 'Ambient grid line',
      at: 0,
      duration,
      layer: -1,
      w: spec.format.width,
      h: 2,
      x: 0.5,
      y: p,
      fill: colorToken(spec.design, 'muted'),
      opacity: 0.08,
      expressions: [{ channel: 'opacity', source: `value + sin((t + ${(i * 0.9 + 0.3).toFixed(2)}) * 2 * PI / 7) * 0.02` }],
    })
  })
  return out
}

function ambientGrain(spec: VideoSpec, duration: number): SpecElement[] {
  return [
    {
      id: 'polish-ambient-grain-0',
      kind: 'shape',
      shape: 'rect',
      name: 'Ambient grain',
      at: 0,
      duration,
      layer: WIPE_LAYER,
      w: spec.format.width,
      h: spec.format.height,
      x: 0.5,
      y: 0.5,
      fill: colorToken(spec.design, 'ink'),
      opacity: 0.05,
      effects: [
        {
          kind: 'grain',
          params: [
            { name: 'amount', value: 0.2 },
            { name: 'size', value: 1.5 },
          ],
        },
      ],
    },
  ]
}

function ambientGradient(spec: VideoSpec, duration: number): SpecElement[] {
  return [0, 1].map((i) => ({
    id: `polish-ambient-gradient-${i}`,
    kind: 'shape' as const,
    shape: 'rect' as const,
    name: 'Ambient wash',
    at: 0,
    duration,
    layer: -1,
    w: +(spec.format.width * 1.4).toFixed(1),
    h: +(spec.format.height * 1.4).toFixed(1),
    x: i === 0 ? 0.2 : 0.8,
    y: i === 0 ? 0.15 : 0.85,
    fill: colorToken(spec.design, i === 0 ? 'accentSoft' : 'bg'),
    opacity: 0.08,
    effects: [{ kind: 'gaussianBlur', params: [{ name: 'radius', value: 120 }] }],
    expressions: [{ channel: 'opacity', source: `value + sin((t + ${(i * 3).toFixed(2)}) * 2 * PI / 10) * 0.03` }],
  }))
}

function buildAmbient(kind: AmbientKind, spec: VideoSpec, seed: number, duration: number): SpecElement[] {
  switch (kind) {
    case 'orbs':
      return ambientOrbs(spec, seed, duration)
    case 'dots':
      return ambientDots(spec, duration)
    case 'grid':
      return ambientGrid(spec, duration)
    case 'grain':
      return ambientGrain(spec, duration)
    case 'gradient':
      return ambientGradient(spec, duration)
    case 'none':
    default:
      return []
  }
}

function addAmbientLayer(topLevel: ReadonlyArray<SpecElement>, spec: VideoSpec, style: MotionStyle, seed: number, duration: number, counts: Counts): SpecElement[] {
  if (style.ambient === 'none') return [...topLevel]
  if (topLevel.some((e) => e.id.startsWith('polish-ambient-'))) return [...topLevel] // idempotency guard
  const made = buildAmbient(style.ambient, spec, seed, duration)
  if (made.length === 0) return [...topLevel]
  counts.ambientKind = style.ambient
  return [...topLevel, ...made]
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export function polishSpec(spec: VideoSpec, style: MotionStyle, opts: PolishOptions = {}): PolishResult {
  const seed = opts.seed ?? 1
  const counts: Counts = { arrivals: 0, exits: 0, staggerGroups: 0, staggered: 0, idle: 0, camera: 0, handoffs: 0 }

  const originalTop = spec.elements ?? []
  const boundaryPairs = findHandoffBoundaries(originalTop)

  const afterCore = polishLevel(originalTop, spec, style, seed, 'elements', counts)
  const afterCamera = applyCamera(afterCore, style, counts)

  const { elements: afterHandoffs, duration } = applyHandoffs(afterCamera, boundaryPairs, spec, style, seed, spec.duration, counts)

  const finalElements = addAmbientLayer(afterHandoffs, spec, style, seed, duration, counts)

  const finalSpec: VideoSpec = { ...spec, duration, elements: finalElements }
  return { spec: finalSpec, issues: buildInfoIssues(counts, style) }
}

// ---------------------------------------------------------------------------
// Quality lints
// ---------------------------------------------------------------------------

interface Leaf {
  el: SpecElement
  path: string
  absAt: number
  absEnd: number
}

function flattenLeaves(elements: ReadonlyArray<SpecElement>, pathPrefix: string, offset: number, out: Leaf[]): void {
  elements.forEach((el, i) => {
    const path = `${pathPrefix}[${i}]`
    const absAt = offset + el.at
    const absEnd = absAt + el.duration
    if (el.kind === 'group') {
      flattenLeaves(el.children ?? [], `${path}.children`, absAt, out)
    } else {
      out.push({ el, path, absAt, absEnd })
    }
  })
}

function isAuxiliary(el: SpecElement): boolean {
  return el.id.startsWith('polish-ambient-') || el.id.startsWith('polish-wipe-')
}

function warnIssue(path: string, code: string, message: string): SpecIssue {
  return { severity: 'warn', path, code, message }
}

/** fewer than 3 elements visible for > 1s outside a deliberate single-word hit */
function lintSparseBeat(spec: VideoSpec, leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  const content = leaves.filter((l) => !isAuxiliary(l.el))
  ;(spec.elements ?? []).forEach((beat, i) => {
    if (isAuxiliary(beat)) return
    if (beat.kind === 'text' && (beat.size ?? 0) >= 120) return // a word-hit is meant to be alone
    const start = beat.at
    const end = beat.at + beat.duration
    const step = 0.1
    let sparseStart: number | null = null
    let worst = 0
    for (let t = start; t <= end + EPS; t += step) {
      const count = content.filter((l) => l.absAt <= t + EPS && l.absEnd > t + EPS).length
      if (count < 3) {
        if (sparseStart === null) sparseStart = t
        worst = Math.max(worst, t - sparseStart)
      } else {
        sparseStart = null
      }
    }
    if (worst > 1) {
      issues.push(warnIssue(`elements[${i}]`, 'sparse-beat', `fewer than 3 elements visible for ${worst.toFixed(1)}s in "${beat.name ?? beat.id}"`))
    }
  })
}

/** an empty frame between beats */
function lintHardCut(spec: VideoSpec, leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  const content = leaves.filter((l) => !isAuxiliary(l.el))
  const intervals = content.map((l) => [l.absAt, l.absEnd] as const).sort((a, b) => a[0] - b[0])
  let cursor = 0
  for (const [s, e] of intervals) {
    if (s > cursor + 0.05) {
      issues.push(warnIssue('elements', 'hard-cut', `empty frame for ${(s - cursor).toFixed(2)}s at ${cursor.toFixed(2)}s`))
    }
    cursor = Math.max(cursor, e)
  }
  if (spec.duration > cursor + 0.05) {
    issues.push(warnIssue('elements', 'hard-cut', `empty frame for ${(spec.duration - cursor).toFixed(2)}s at ${cursor.toFixed(2)}s (end of piece)`))
  }
}

/** nothing moving anywhere for > 1.5s */
function lintStaticHold(spec: VideoSpec, leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  const moving = leaves.filter((l) => !isAuxiliary(l.el) && !!(l.el.enter || l.el.exit || l.el.reveal || l.el.draw || l.el.keys?.length || l.el.expressions?.length))
  const intervals = moving.map((l) => [l.absAt, l.absEnd] as const).sort((a, b) => a[0] - b[0])
  let cursor = 0
  for (const [s, e] of intervals) {
    if (s > cursor + 1.5) {
      issues.push(warnIssue('elements', 'static-hold', `nothing moving for ${(s - cursor).toFixed(2)}s at ${cursor.toFixed(2)}s`))
    }
    cursor = Math.max(cursor, e)
  }
  if (spec.duration - cursor > 1.5) {
    issues.push(warnIssue('elements', 'static-hold', `nothing moving for ${(spec.duration - cursor).toFixed(2)}s at ${cursor.toFixed(2)}s (end of piece)`))
  }
}

const MOVEMENT_CHANNELS: ReadonlySet<string> = new Set(['x', 'y', 'scale', 'rotation'])

/** an explicit `linear` curve on a movement channel */
function lintLinearMovement(leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  for (const l of leaves) {
    ;(l.el.keys ?? []).forEach((k, ki) => {
      if (MOVEMENT_CHANNELS.has(k.channel) && k.curve === 'linear') {
        issues.push(warnIssue(`${l.path}.keys[${ki}]`, 'linear-movement', `linear curve on a movement channel "${k.channel}"`))
      }
    })
  }
}

/** headline 96–140, support 48–64, caption 30–38 (at 1080 wide); anything else is off-scale */
const SIZE_BANDS: ReadonlyArray<readonly [number, number]> = [
  [30, 38],
  [48, 64],
  [96, 140],
]
const SIZE_BAND_TOLERANCE = 2

function lintOffScaleType(spec: VideoSpec, leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  const toRef = 1080 / spec.format.width
  for (const l of leaves) {
    if (l.el.kind !== 'text' || l.el.size === undefined) continue
    const normalized = l.el.size * toRef
    const inBand = SIZE_BANDS.some(([lo, hi]) => normalized >= lo - SIZE_BAND_TOLERANCE && normalized <= hi + SIZE_BAND_TOLERANCE)
    if (!inBand) {
      issues.push(warnIssue(`${l.path}.size`, 'off-scale-type', `text size ${l.el.size}px (≈${normalized.toFixed(0)}px at 1080 wide) is outside the hierarchy bands`))
    }
  }
}

const ACCENT_OVERUSE_RATIO = 0.35

/** > 35% of text elements set in accent colour */
function lintAccentOveruse(spec: VideoSpec, leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  const texts = leaves.filter((l) => l.el.kind === 'text' && !isAuxiliary(l.el))
  if (texts.length === 0) return
  const accentLiteral = colorLiteral(spec.design, 'accent').toLowerCase()
  const accentCount = texts.filter((l) => {
    const c = l.el.color
    if (!c) return false
    return c === '$accent' || c.toLowerCase() === accentLiteral
  }).length
  const ratio = accentCount / texts.length
  if (ratio > ACCENT_OVERUSE_RATIO) {
    issues.push(warnIssue('elements', 'accent-overuse', `${accentCount}/${texts.length} text elements (${Math.round(ratio * 100)}%) are in accent colour`))
  }
}

/** on screen for less than it takes to read */
function lintUnreadableHold(leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  for (const l of leaves) {
    if (l.el.kind !== 'text' || !l.el.text) continue
    const need = readingSeconds(l.el.text)
    if (l.el.duration < need - EPS) {
      issues.push(warnIssue(`${l.path}.duration`, 'unreadable-hold', `on screen ${l.el.duration.toFixed(2)}s, needs ~${need.toFixed(2)}s to read "${l.el.text}"`))
    }
  }
}

/** A rough text-box width estimate for `off-margin`, used only when the author gave no `maxWidth`. */
function estimateTextWidth(text: string, size: number): number {
  return text.length * size * 0.56
}

const MARGIN_FRACTION = 0.06

/** a text box crossing the 0.06/0.94 side margin */
function lintOffMargin(spec: VideoSpec, leaves: ReadonlyArray<Leaf>, issues: SpecIssue[]): void {
  for (const l of leaves) {
    if (l.el.kind !== 'text') continue
    const widthPx = l.el.maxWidth ?? estimateTextWidth(l.el.text ?? '', l.el.size ?? 40)
    const halfFrac = widthPx / 2 / spec.format.width
    const cx = l.el.x ?? 0.5
    const left = cx - halfFrac
    const right = cx + halfFrac
    if (left < MARGIN_FRACTION - EPS || right > 1 - MARGIN_FRACTION + EPS) {
      issues.push(warnIssue(`${l.path}.x`, 'off-margin', `text box [${left.toFixed(3)}, ${right.toFixed(3)}] crosses the ${MARGIN_FRACTION}/${1 - MARGIN_FRACTION} margin`))
    }
  }
}

/**
 * Quality lints — `warn` issues a director can act on in a repair pass:
 * a sparse beat, a long static hold, a hard cut to an empty frame, linear
 * easing on a movement, type sizes off the scale, accent overuse, a hold too
 * short to read, a text box crossing the side margin.
 */
export function lintSpec(spec: VideoSpec): SpecIssue[] {
  const issues: SpecIssue[] = []
  const leaves: Leaf[] = []
  flattenLeaves(spec.elements ?? [], 'elements', 0, leaves)

  lintSparseBeat(spec, leaves, issues)
  lintHardCut(spec, leaves, issues)
  lintStaticHold(spec, leaves, issues)
  lintLinearMovement(leaves, issues)
  lintOffScaleType(spec, leaves, issues)
  lintAccentOveruse(spec, leaves, issues)
  lintUnreadableHold(leaves, issues)
  lintOffMargin(spec, leaves, issues)

  return issues
}
