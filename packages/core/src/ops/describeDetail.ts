/**
 * The detail views an agent needs and `describeProject` leaves out (AGT-4a).
 *
 * `describeProject` is a map: ids, where things sit, which channels are keyed.
 * It deliberately omits every value. This module is the zoom lens: ask for the
 * clips you are about to change and get their numbers back, plus every
 * transition on the timeline (which `describeProject` does not show at all).
 *
 *   describeClipDetail(project, refs)  transform, keys, expressions, source
 *                                      range, crop/mask/matte, effects, full
 *                                      text and shape style, caption words,
 *                                      the transitions touching the clip
 *   describeTransitions(project)       every transition, with clip names
 *
 * Read-only and pure: nothing here writes a project, and the same project
 * always describes the same (clips in the order asked, channels builtins-first,
 * transitions by time). Seconds are rounded to 3 decimals and other numbers to
 * 4 significant digits, so the output is stable for snapshot tests.
 *
 * Bounded on purpose, because the result goes into a model's context window:
 * {@link MAX_DETAIL_CLIPS} clips, {@link MAX_DETAIL_KEYS_PER_CHANNEL} keys per
 * channel, {@link MAX_DETAIL_CAPTION_WORDS} caption words and
 * {@link MAX_DETAIL_BYTES} of JSON in total. Whatever is cut is said so
 * (`truncated`, `keysThinned`, `wordCount` vs `words`, `trimmed`), never
 * silently dropped.
 */

import type { Clip, Keyframe, Paint, Project, Transition } from '../types'
import { COLOR_CHANNELS, normalizeKeys, presentKeyframeChannels, typeDefaultTransform } from '../resolver/keyframes'
import { parseClipPath } from '../composition/paths'
import { toRgba, vecToHex } from '../utils/color'

/** Most clips described by one call; the rest of the refs come back in `truncated`. */
export const MAX_DETAIL_CLIPS = 12
/** Most keys listed per channel. Past it the first and last are kept and the middle is thinned evenly. */
export const MAX_DETAIL_KEYS_PER_CHANNEL = 60
/** Most caption words listed per clip; `wordCount` always carries the true total. */
export const MAX_DETAIL_CAPTION_WORDS = 200
/** The whole result, as UTF-8 JSON. Past it the largest sections are dropped (caption words, then keys). */
export const MAX_DETAIL_BYTES = 40_000
/** Most child clips listed under a compound. */
export const MAX_DETAIL_CHILDREN = 60
/** Longest text content returned in full. */
const MAX_DETAIL_CONTENT_CHARS = 2000

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface DetailRef {
  id: string
  name: string
}

export interface DescribedTransition {
  id: string
  kind: Transition['kind']
  direction?: Transition['direction']
  easing?: Transition['easing']
  track: DetailRef
  from: DetailRef
  to: DetailRef
  atSec: number
  durationSec: number
}

export interface DescribedTransitions {
  transitions: DescribedTransition[]
  /** Transitions left out because a clip they join no longer exists. */
  dropped: number
}

export interface DetailKey {
  /** Seconds from the START OF THE CLIP (keys are clip-local), not from the timeline start. */
  atSec: number
  /** A scalar channel's value. */
  value?: number
  /** A colour channel's key: the colour as `#rrggbb`, with `alpha` when it is not 1. */
  hex?: string
  alpha?: number
  /** A `shape.path` key: the length of its path data (the `d` itself is left out). */
  pathLength?: number
  /** A `shape.path` key: the user space the clip's path is authored in. */
  viewBox?: string
  /** The named curve of the segment leading INTO this key. */
  easing: string
  /** `[x1, y1, x2, y2]` when the key carries a raw cubic-bezier (it wins over `easing`). */
  bezier?: number[]
  /** A spring into this key (it wins over `bezier` and `easing`). */
  spring?: { stiffness: number; damping: number; mass?: number; velocity?: number }
  /** A step: this key's value holds until the next key. */
  hold?: true
}

export type DetailPaint =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: Array<{ offset: number; color: string }> }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: Array<{ offset: number; color: string }> }

export interface DetailEffect {
  id: string
  kind: string
  enabled: boolean
  preset?: string
  params: Record<string, number | string | boolean>
}

export interface DetailText {
  /** The full text, up to {@link MAX_DETAIL_CONTENT_CHARS} characters. */
  content?: string
  fontId?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  fontStyle?: string
  textAlign?: string
  /** The glyph colour (`color`). */
  color?: string
  /** A gradient or solid fill, which replaces `color` for the glyphs. */
  fill?: DetailPaint
  outline?: { color: string; width: number }
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number }
  /** The box painted behind the glyphs. */
  background?: { color: string; opacity?: number; padding?: number; borderRadius?: number; borderWidth?: number; borderColor?: string }
  box?: Record<string, number | string>
  /** How many styled runs the text holds (their offsets are left out). */
  spans?: number
  textAnimator?: { unit: string; preset: string; staggerFrames: number; durationFrames: number }
  textAnimation?: DetailAnimation
}

export interface DetailAnimation {
  in?: string
  out?: string
  durationSec: number
  inMotion?: Record<string, number | string>
  outMotion?: Record<string, number | string>
}

export interface DetailShape {
  variant?: string
  fill?: string
  stroke?: string
  fillPaint?: DetailPaint
  strokePaint?: DetailPaint
  strokeWidth?: number
  cornerRadius?: number
  sides?: number
  innerRatio?: number
  arrowHead?: string
  dash?: number[]
  dashOffset?: number
  cap?: string
  join?: string
  align?: string
  fillRule?: string
  /** `path` shapes: the length of the path data and the space it is authored in (the `d` is in `describeProject`). */
  pathLength?: number
  viewBox?: string
  draw?: { start: number; end: number }
  animation?: DetailAnimation
}

export interface ClipDetail {
  /** What `describeProject` calls it: the clip id, or `'compoundId/childId'` for a part. */
  id: string
  /** The ref this was asked for by, when it differs from `id` (a name, say). */
  ref?: string
  name: string
  type: Clip['type']
  trackId: string
  startSec: number
  durationSec: number
  transform: {
    x: number
    y: number
    scale: number
    scaleX: number
    scaleY: number
    rotation: number
    anchorX: number
    anchorY: number
  }
  /** True when the clip stores no transform of its own and these are its type's defaults. */
  transformIsDefault?: true
  opacity: number
  volume: number
  blend: string
  cornerRadius?: number
  /** Where in the source media the clip starts and how much of it is used, at 1x. */
  sourceStartSec: number
  sourceDurationSec: number
  speed: number
  crop?: { x: number; y: number; width: number; height: number }
  focus?: { x: number; y: number; width?: number; height?: number }
  mask?: {
    kind: string
    x: number
    y: number
    width: number
    height: number
    rotation?: number
    feather?: number
    invert?: boolean
    angle?: number
    pathLength?: number
    viewBox?: string
  }
  matte?: { sourceClipId: string; kind: 'alpha' | 'luma'; invert?: boolean }
  effects?: DetailEffect[]
  /** Keys per channel, in `describeProject`'s channel order. */
  keys?: Record<string, DetailKey[]>
  /** Set when a channel had more than {@link MAX_DETAIL_KEYS_PER_CHANNEL} keys; `keyTotals` has the real counts. */
  keysThinned?: true
  keyTotals?: Record<string, number>
  /** Channels driven by an expression, with its source text. */
  expressions?: Record<string, string>
  text?: DetailText
  shape?: DetailShape
  freehand?: { color?: string; width?: number; pathLength?: number }
  generator?: { kind: string; params: Record<string, number | string | boolean>; seed?: number }
  layout?: Record<string, unknown>
  captions?: {
    mode?: string
    highlight?: string
    /** The true number of words, whether or not they are all listed. */
    wordCount: number
    /** Absent after a size trim; then `wordCount` is all that is left. */
    words?: Array<{ text: string; atSec: number; endSec: number }>
    wordsTruncated?: true
  }
  /** Ids of the transitions that start or end on this clip, from {@link describeTransitions}. */
  transitions: string[]
  linkId?: string
  /** Compounds: the clips inside, addressed as `'compoundId/childId'`. */
  children?: Array<{ id: string; name: string; type: Clip['type'] }>
  childrenOmitted?: number
}

export interface ClipDetailResult {
  clips: ClipDetail[]
  /** Refs that are no clip's id, name or compound path. */
  missing: string[]
  /** Refs that name several clips; use one of the ids. */
  ambiguous: Array<{ ref: string; ids: string[] }>
  /** Refs past the {@link MAX_DETAIL_CLIPS} cap (or cut to fit {@link MAX_DETAIL_BYTES}); ask again for them. */
  truncated: string[]
  /** Sections dropped to fit {@link MAX_DETAIL_BYTES}, as `clipId.words` / `clipId.keys` / `clipId`. */
  trimmed: string[]
}

export interface DescribeDetailOptions {
  /** A lower clip cap than {@link MAX_DETAIL_CLIPS}. A higher value is ignored. */
  maxClips?: number
  /** A lower per-channel key cap than {@link MAX_DETAIL_KEYS_PER_CHANNEL}. */
  maxKeysPerChannel?: number
  /** A lower caption word cap than {@link MAX_DETAIL_CAPTION_WORDS}. */
  maxCaptionWords?: number
  /** A lower total than {@link MAX_DETAIL_BYTES}. */
  maxBytes?: number
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Seconds, 3 decimals. */
const sec = (frames: number, fps: number): number => {
  const v = Number.isFinite(frames) ? frames / fps : 0
  return Math.round(v * 1000) / 1000
}

/** Any other number, 4 significant digits. A non-finite value is 0 (a hand-built document can hold one). */
const sig = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toPrecision(4)) : 0)

const sigOpt = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toPrecision(4)) : undefined)

const fpsOf = (project: Pick<Project, 'fps'>): number => (project.fps > 0 ? project.fps : 30)

/** `obj` without its undefined-valued keys. */
function compact<T extends object>(obj: T): T {
  for (const k of Object.keys(obj)) if ((obj as Record<string, unknown>)[k] === undefined) delete (obj as Record<string, unknown>)[k]
  return obj
}

const cap = (limit: number | undefined, ceiling: number): number => {
  if (limit === undefined || !Number.isFinite(limit)) return ceiling
  return Math.max(0, Math.min(Math.floor(limit), ceiling))
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function collectTransitions(project: Pick<Project, 'tracks' | 'clips' | 'transitions' | 'fps'>): DescribedTransitions {
  const fps = fpsOf(project)
  const clipById = new Map<string, Clip>()
  for (const list of Object.values(project.clips ?? {})) for (const c of list) clipById.set(c.id, c)
  const trackById = new Map((project.tracks ?? []).map((t) => [t.id, t]))
  const list = Array.isArray(project.transitions) ? project.transitions : []
  const out: Array<DescribedTransition & { _at: number }> = []
  let dropped = 0
  for (const t of list) {
    const from = clipById.get(t.fromClipId)
    const to = clipById.get(t.toClipId)
    if (!from || !to) {
      dropped++
      continue
    }
    const trackId = t.trackId || from.trackId
    const track = trackById.get(trackId)
    out.push({
      ...compact({
        id: t.id,
        kind: t.kind,
        direction: t.direction,
        easing: t.easing,
        track: { id: trackId, name: track?.name ?? trackId },
        from: { id: from.id, name: from.name },
        to: { id: to.id, name: to.name },
        atSec: sec(t.startFrame, fps),
        durationSec: sec(t.durationFrames, fps),
      }),
      _at: t.startFrame,
    })
  }
  out.sort((a, b) => a._at - b._at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { transitions: out.map(({ _at, ...rest }) => rest), dropped }
}

/**
 * Every transition on the timeline, soonest first, with the names of the clips
 * it joins. A transition whose clips are gone is counted in `dropped`, not
 * listed. Top-level tracks only: a compound's own transitions are reached
 * through {@link describeClipDetail} on a part of it.
 */
export function describeTransitions(project: Project): DescribedTransitions {
  return collectTransitions(project)
}

// ---------------------------------------------------------------------------
// Resolving refs
// ---------------------------------------------------------------------------

interface Resolved {
  ref: string
  id: string
  clip: Clip
  /** The project the clip sits in: the root, or a compound's inner project. */
  within: Project
}

type Resolution = { ok: true; found: Resolved } | { ok: false; ambiguous?: string[] }

/**
 * An id first, then one exact name, then one case-insensitive name (as
 * `sanitizeOps` reads a clip ref); a path `'compoundId/childId'` walks into
 * compounds. Several clips with the same name are ambiguous, never a pick.
 */
function resolveRef(project: Project, ref: string, roots: Map<string, Clip>, all: Clip[]): Resolution {
  const s = ref.trim()
  if (!s) return { ok: false }

  const byIdOrName = (key: string): Resolution & { clip?: Clip } => {
    const direct = roots.get(key)
    if (direct) return { ok: true, found: { ref, id: direct.id, clip: direct, within: project }, clip: direct }
    const exact = all.filter((c) => c.name === key)
    const hits = exact.length ? exact : all.filter((c) => typeof c.name === 'string' && c.name.toLowerCase() === key.toLowerCase())
    if (hits.length === 1) return { ok: true, found: { ref, id: hits[0]!.id, clip: hits[0]!, within: project }, clip: hits[0]! }
    if (hits.length > 1) return { ok: false, ambiguous: hits.map((c) => c.id) }
    return { ok: false }
  }

  if (!s.includes('/') || roots.has(s)) return byIdOrName(s)

  const segs = parseClipPath(s)
  if (!segs) return { ok: false }
  const root = byIdOrName(segs[0]!)
  if (!root.ok) return root
  let clip = root.found.clip
  let within = project
  const path = [clip.id]
  for (const seg of segs.slice(1)) {
    if (clip.type !== 'compound' || !clip.compound?.project) return { ok: false }
    within = clip.compound.project
    let next: Clip | undefined
    for (const list of Object.values(within.clips ?? {})) {
      next = list.find((c) => c.id === seg)
      if (next) break
    }
    if (!next) return { ok: false }
    clip = next
    path.push(clip.id)
  }
  return { ok: true, found: { ref, id: path.join('/'), clip, within } }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function paintOf(p: Paint | undefined): DetailPaint | undefined {
  if (!p || typeof p !== 'object') return undefined
  const stops = (s: Array<{ offset: number; color: string }>) => (Array.isArray(s) ? s.map((x) => ({ offset: sig(x.offset), color: x.color })) : [])
  if (p.type === 'solid') return { type: 'solid', color: p.color }
  if (p.type === 'linear') return { type: 'linear', angle: sig(p.angle), stops: stops(p.stops) }
  if (p.type === 'radial') return { type: 'radial', cx: sig(p.cx), cy: sig(p.cy), r: sig(p.r), stops: stops(p.stops) }
  return undefined
}

function viewBoxOf(vb: { x: number; y: number; width: number; height: number } | undefined): string | undefined {
  return vb ? `${sig(vb.x)} ${sig(vb.y)} ${sig(vb.width)} ${sig(vb.height)}` : undefined
}

function flat(obj: object | undefined): Record<string, number | string> | undefined {
  if (!obj) return undefined
  const out: Record<string, number | string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') out[k] = sig(v)
    else if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

function animationOf(a: Clip['textAnimation'], fps: number): DetailAnimation | undefined {
  if (!a) return undefined
  return compact({
    in: a.in,
    out: a.out,
    durationSec: sec(a.durationFrames, fps),
    inMotion: flat(a.inMotion),
    outMotion: flat(a.outMotion),
  })
}

/** Evenly thinned indexes `0..n-1`, `limit` of them, always including both ends. */
function thinIndexes(n: number, limit: number): number[] {
  if (limit < 2) return [0]
  const out: number[] = []
  for (let i = 0; i < limit; i++) out.push(Math.round((i * (n - 1)) / (limit - 1)))
  return out
}

function keyOut(channel: string, k: Keyframe, fps: number, clipViewBox: string | undefined): DetailKey {
  const base: DetailKey = { atSec: sec(k.frame, fps), easing: String(k.easing) }
  if ((COLOR_CHANNELS as ReadonlyArray<string>).includes(channel)) {
    const rgba = toRgba(k.vec)
    if (rgba) {
      base.hex = vecToHex(rgba)
      if (rgba[3] !== 1) base.alpha = sig(rgba[3])
    }
  } else if (channel === 'shape.path') {
    base.pathLength = typeof k.path === 'string' ? k.path.length : 0
    if (clipViewBox) base.viewBox = clipViewBox
  } else {
    base.value = sig(k.value)
  }
  if (Array.isArray(k.easingBezier) && k.easingBezier.length === 4 && k.easingBezier.every((n) => Number.isFinite(n))) {
    base.bezier = k.easingBezier.map(sig)
  }
  if (k.spring && typeof k.spring === 'object') {
    base.spring = compact({
      stiffness: sig(k.spring.stiffness),
      damping: sig(k.spring.damping),
      mass: sigOpt(k.spring.mass),
      velocity: sigOpt(k.spring.velocity),
    })
  }
  if (k.hold) base.hold = true
  return base
}

function keysSection(clip: Clip, fps: number, maxKeys: number): Pick<ClipDetail, 'keys' | 'keysThinned' | 'keyTotals' | 'expressions'> {
  const channels = clip.keyframes?.channels
  const out: Pick<ClipDetail, 'keys' | 'keysThinned' | 'keyTotals' | 'expressions'> = {}
  const viewBox = clip.type === 'shape' ? (viewBoxOf(clip.shapeViewBox) ?? '0 0 100 100') : undefined
  for (const channel of presentKeyframeChannels(channels)) {
    const track = channels?.[channel]
    if (!track) continue
    if (track.source?.kind === 'expression') (out.expressions ??= {})[channel] = String(track.source.source ?? '')
    const keys = normalizeKeys(track.keys)
    if (keys.length === 0) continue
    let chosen = keys
    if (keys.length > maxKeys) {
      chosen = thinIndexes(keys.length, maxKeys).map((i) => keys[i]!)
      out.keysThinned = true
      ;(out.keyTotals ??= {})[channel] = keys.length
    }
    ;(out.keys ??= {})[channel] = chosen.map((k) => keyOut(channel, k, fps, viewBox))
  }
  return out
}

function textSection(clip: Clip, fps: number): DetailText {
  const content = typeof clip.content === 'string' ? (clip.content.length > MAX_DETAIL_CONTENT_CHARS ? `${clip.content.slice(0, MAX_DETAIL_CONTENT_CHARS - 1)}…` : clip.content) : undefined
  const background = clip.backgroundColor || clip.borderWidth || clip.padding || clip.borderRadius
    ? compact({
        color: clip.backgroundColor ?? '',
        opacity: sigOpt(clip.backgroundOpacity),
        padding: sigOpt(clip.padding),
        borderRadius: sigOpt(clip.borderRadius),
        borderWidth: sigOpt(clip.borderWidth),
        borderColor: clip.borderColor,
      })
    : undefined
  return compact({
    content,
    fontId: clip.fontId,
    fontFamily: clip.fontFamily,
    fontSize: sigOpt(clip.fontSize),
    fontWeight: clip.fontWeight,
    fontStyle: clip.fontStyle,
    textAlign: clip.textAlign,
    color: clip.color,
    fill: paintOf(clip.textFill),
    outline: clip.textOutline ? { color: clip.textOutline.color, width: sig(clip.textOutline.width) } : undefined,
    shadow: clip.textShadow
      ? { color: clip.textShadow.color, blur: sig(clip.textShadow.blur), offsetX: sig(clip.textShadow.offsetX), offsetY: sig(clip.textShadow.offsetY) }
      : undefined,
    background,
    box: flat(clip.textBox),
    spans: Array.isArray(clip.spans) && clip.spans.length ? clip.spans.length : undefined,
    textAnimator: clip.textAnimator
      ? {
          unit: clip.textAnimator.unit,
          preset: clip.textAnimator.preset,
          staggerFrames: sig(clip.textAnimator.staggerFrames),
          durationFrames: sig(clip.textAnimator.durationFrames),
        }
      : undefined,
    textAnimation: animationOf(clip.textAnimation, fps),
  })
}

function shapeSection(clip: Clip, fps: number): DetailShape {
  const isPath = clip.shapeKind === 'path'
  return compact({
    variant: clip.shapeKind,
    fill: clip.shapeFill,
    stroke: clip.shapeStroke,
    fillPaint: paintOf(clip.shapeFillPaint),
    strokePaint: paintOf(clip.shapeStrokePaint),
    strokeWidth: sigOpt(clip.shapeStrokeWidth),
    cornerRadius: sigOpt(clip.cornerRadius),
    sides: sigOpt(clip.shapeSides),
    innerRatio: sigOpt(clip.shapeInnerRatio),
    arrowHead: clip.shapeArrowHead,
    dash: Array.isArray(clip.shapeStrokeDash) && clip.shapeStrokeDash.length ? clip.shapeStrokeDash.map(sig) : undefined,
    dashOffset: sigOpt(clip.shapeStrokeDashOffset),
    cap: clip.shapeStrokeCap,
    join: clip.shapeStrokeJoin,
    align: clip.shapeStrokeAlign,
    fillRule: clip.shapeFillRule,
    pathLength: isPath ? (clip.shapePath ?? '').length : undefined,
    viewBox: isPath ? (viewBoxOf(clip.shapeViewBox) ?? '0 0 100 100') : undefined,
    draw: clip.shapeDraw ? { start: sig(clip.shapeDraw.start), end: sig(clip.shapeDraw.end) } : undefined,
    animation: animationOf(clip.shapeAnimation, fps),
  })
}

function paramsOf(params: Record<string, number | string | boolean> | undefined): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [k, v] of Object.entries(params ?? {})) out[k] = typeof v === 'number' ? sig(v) : v
  return out
}

interface Budgets {
  maxKeys: number
  maxWords: number
}

function buildDetail(found: Resolved, budgets: Budgets, transitionsOf: (p: Project) => DescribedTransitions): ClipDetail {
  const { clip, within } = found
  const fps = fpsOf(within)
  const t = clip.transform ?? typeDefaultTransform(clip.type)
  const out: ClipDetail = {
    id: found.id,
    name: clip.name,
    type: clip.type,
    trackId: clip.trackId,
    startSec: sec(clip.startFrame, fps),
    durationSec: sec(clip.durationFrames, fps),
    transform: {
      x: sig(t.x),
      y: sig(t.y),
      scale: sig(t.scale),
      scaleX: sig(t.scaleX ?? 1),
      scaleY: sig(t.scaleY ?? 1),
      rotation: sig(t.rotation),
      anchorX: sig(t.anchor?.x ?? 0.5),
      anchorY: sig(t.anchor?.y ?? 0.5),
    },
    opacity: sig(clip.opacity ?? 1),
    volume: sig(clip.volume ?? 1),
    blend: clip.blend ?? 'normal',
    sourceStartSec: sec(clip.sourceStartFrame, fps),
    sourceDurationSec: sec(clip.sourceDurationFrames, fps),
    speed: sig(clip.speed ?? 1),
    transitions: [],
  }
  if (found.ref !== found.id) out.ref = found.ref
  if (!clip.transform) out.transformIsDefault = true
  if (clip.cornerRadius !== undefined && clip.cornerRadius !== 0) out.cornerRadius = sig(clip.cornerRadius)
  if (clip.crop) out.crop = { x: sig(clip.crop.x), y: sig(clip.crop.y), width: sig(clip.crop.width), height: sig(clip.crop.height) }
  if (clip.focus) out.focus = compact({ x: sig(clip.focus.x), y: sig(clip.focus.y), width: clip.focus.width !== undefined ? sig(clip.focus.width) : undefined, height: clip.focus.height !== undefined ? sig(clip.focus.height) : undefined }) as typeof out.focus
  if (clip.mask) {
    const m = clip.mask
    out.mask = compact({
      kind: m.kind,
      x: sig(m.x),
      y: sig(m.y),
      width: sig(m.width),
      height: sig(m.height),
      rotation: sigOpt(m.rotation),
      feather: sigOpt(m.feather),
      invert: m.invert ? true : undefined,
      angle: sigOpt(m.angle),
      pathLength: typeof m.path === 'string' ? m.path.length : undefined,
      viewBox: viewBoxOf(m.viewBox),
    })
  }
  if (clip.matte?.sourceClipId) {
    out.matte = compact({ sourceClipId: clip.matte.sourceClipId, kind: clip.matte.kind, invert: clip.matte.invert ? true : undefined })
  }
  if (Array.isArray(clip.effects) && clip.effects.length) {
    out.effects = clip.effects.map((e) =>
      compact({ id: e.id, kind: e.kind, enabled: e.enabled !== false, preset: e.preset, params: paramsOf(e.params) }),
    )
  }
  Object.assign(out, keysSection(clip, fps, budgets.maxKeys))

  if (clip.type === 'text') out.text = textSection(clip, fps)
  if (clip.type === 'shape') out.shape = shapeSection(clip, fps)
  if (clip.type === 'freehand') {
    out.freehand = compact({ color: clip.strokeColor, width: sigOpt(clip.strokeWidth), pathLength: typeof clip.pathData === 'string' ? clip.pathData.length : undefined })
  }
  if (clip.generator) {
    out.generator = compact({ kind: clip.generator.kind, params: paramsOf(clip.generator.params), seed: sigOpt(clip.generator.seed) })
  }
  if (clip.layout) out.layout = JSON.parse(JSON.stringify(clip.layout)) as Record<string, unknown>

  const words = Array.isArray(clip.words) ? clip.words : []
  if (words.length || clip.captionMode) {
    const listed = words.slice(0, budgets.maxWords)
    out.captions = compact({
      mode: clip.captionMode,
      highlight: clip.captionHighlight,
      wordCount: words.length,
      words: listed.map((w) => ({ text: w.text, atSec: sec(w.start, fps), endSec: sec(w.end, fps) })),
      wordsTruncated: words.length > listed.length ? (true as const) : undefined,
    })
  }

  const touching = transitionsOf(within).transitions.filter((x) => x.from.id === clip.id || x.to.id === clip.id)
  out.transitions = touching.map((x) => x.id)
  if (clip.linkId) out.linkId = clip.linkId

  if (clip.type === 'compound' && clip.compound?.project) {
    const inner = clip.compound.project
    const order = new Map((inner.tracks ?? []).map((tr) => [tr.id, tr.order]))
    const kids = Object.entries(inner.clips ?? {})
      .flatMap(([trackId, list]) => list.map((c) => ({ c, order: order.get(trackId) ?? 0 })))
      .sort((a, b) => a.c.startFrame - b.c.startFrame || a.order - b.order)
    out.children = kids.slice(0, MAX_DETAIL_CHILDREN).map(({ c }) => ({ id: `${found.id}/${c.id}`, name: c.name, type: c.type }))
    if (kids.length > MAX_DETAIL_CHILDREN) out.childrenOmitted = kids.length - MAX_DETAIL_CHILDREN
  }
  return out
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Everything `describeProject` leaves out about the clips in `clipRefs`.
 *
 * A ref is a clip id, else a clip name, else a compound part path
 * `'compoundId/childId'` (the compound itself may be named). A ref that is none
 * of those comes back in `missing`; this never throws. See the module comment
 * for the budgets and how a cut is reported.
 */
export function describeClipDetail(project: Project, clipRefs: string[], opts: DescribeDetailOptions = {}): ClipDetailResult {
  const budgets: Budgets = {
    maxKeys: Math.max(2, cap(opts.maxKeysPerChannel, MAX_DETAIL_KEYS_PER_CHANNEL)),
    maxWords: cap(opts.maxCaptionWords, MAX_DETAIL_CAPTION_WORDS),
  }
  const maxClips = cap(opts.maxClips, MAX_DETAIL_CLIPS)
  const maxBytes = cap(opts.maxBytes, MAX_DETAIL_BYTES)

  const roots = new Map<string, Clip>()
  const all: Clip[] = []
  for (const list of Object.values(project.clips ?? {})) {
    for (const c of list) {
      roots.set(c.id, c)
      all.push(c)
    }
  }

  const transitionCache = new Map<Project, DescribedTransitions>()
  const transitionsOf = (p: Project): DescribedTransitions => {
    let cached = transitionCache.get(p)
    if (!cached) {
      cached = collectTransitions(p)
      transitionCache.set(p, cached)
    }
    return cached
  }

  const result: ClipDetailResult = { clips: [], missing: [], ambiguous: [], truncated: [], trimmed: [] }
  const seen = new Set<string>()
  const refs = Array.isArray(clipRefs) ? clipRefs : []
  for (const raw of refs) {
    const ref = typeof raw === 'string' ? raw : String(raw)
    const r = resolveRef(project, ref, roots, all)
    if (!r.ok) {
      if (r.ambiguous) result.ambiguous.push({ ref, ids: r.ambiguous })
      else result.missing.push(ref)
      continue
    }
    if (seen.has(r.found.id)) continue
    seen.add(r.found.id)
    if (result.clips.length >= maxClips) {
      result.truncated.push(ref)
      continue
    }
    result.clips.push(buildDetail(r.found, budgets, transitionsOf))
  }

  fitToBudget(result, maxBytes)
  return result
}

/**
 * Bring the result under `maxBytes`: caption words first (largest first), then
 * keys (largest first), then, as a last resort, whole clips from the end. Each
 * cut is recorded in `trimmed` so the reader knows to ask again narrower.
 */
function fitToBudget(result: ClipDetailResult, maxBytes: number): void {
  const over = () => byteLength(result) > maxBytes
  if (!over()) return

  const largest = (pick: (c: ClipDetail) => unknown): ClipDetail | undefined => {
    let best: ClipDetail | undefined
    let bestSize = 0
    for (const c of result.clips) {
      const part = pick(c)
      if (part === undefined) continue
      const size = byteLength(part)
      if (size > bestSize) {
        best = c
        bestSize = size
      }
    }
    return best
  }

  while (over()) {
    const c = largest((x) => x.captions?.words)
    if (!c) break
    delete c.captions!.words
    delete c.captions!.wordsTruncated
    result.trimmed.push(`${c.id}.words`)
  }
  while (over()) {
    const c = largest((x) => x.keys)
    if (!c) break
    c.keyTotals = Object.fromEntries(Object.entries(c.keys!).map(([ch, ks]) => [ch, c.keyTotals?.[ch] ?? ks.length]))
    delete c.keys
    result.trimmed.push(`${c.id}.keys`)
  }
  while (over() && result.clips.length > 0) {
    const dropped = result.clips.pop()!
    result.truncated.push(dropped.ref ?? dropped.id)
    result.trimmed.push(dropped.id)
  }
}
