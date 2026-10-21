/**
 * A compact, JSON-safe view of a project for an agent's context window.
 *
 * The agent never sees the raw document: it sees ids it may address, where
 * things sit in frames AND seconds (models reason in seconds, ops are written
 * in frames), what each clip contains in a phrase, which channels are keyed
 * and which effects are stacked. Anything an op cannot use — style fields,
 * key lists, crop windows — is left out, so the view stays small on long
 * timelines.
 *
 * Pure and deterministic: tracks in UI order, clips by start frame, keyed
 * channel names builtins-first. The same project always describes the same.
 */

import { MAX_COMPOUND_DEPTH, type Clip, type Project, type Track } from '../types'
import { parseCssColor } from '../vector/color'
import { parsePathToCubics } from '../resolver/pathMorph'
import { describeStructure } from './sanitize'
import { presentKeyframeChannels, normalizeKeys } from '../resolver/keyframes'
import { resolveMainTrackId } from '../actions/placement'
import { COMPONENT_REGISTRY } from '../spec/components'
import type { ComponentItem, ComponentName, SpecComponent } from '../spec/components/types'
import type { PropType, PropValue } from '../composition/types'
import { getEffectDefinition, type EffectParamValue, type ParamDef } from '../effects/registry'
import { GENERATOR_REGISTRY } from '../generators/registry'
import { markerSetForClip, clipBeatFrames, clipSilenceRanges } from '../audio/markers'

export interface DescribedEffect {
  id: string
  kind: string
  preset?: string
  enabled: boolean
  /**
   * AGN-P22: the params an `fx.<id>.<param>` key can drive, with their current
   * value (the clip's own, else the registry default). Keyframeable numbers and
   * colours only: the rest are refused by `sanitizeOps` anyway. Capped (see
   * {@link MAX_DESCRIBED_FX_PARAMS}); a param left out is simply not listed.
   */
  params?: Record<string, number | number[]>
}

/** AGN-P22: a generator clip's kind and its animatable params, for `gen.<param>`. */
export interface DescribedGenerator {
  kind: string
  params?: Record<string, number>
}

/** AGN-P28: a path shape's own path, so a `shape.path` morph starts from it instead of an invented one. */
export interface DescribedPath {
  /** The clip's own `shapePath`, verbatim, when it fits the per-clip and project budgets. Never truncated. */
  d?: string
  /** The user space it is authored in, as `x y width height`. Default `0 0 100 100`. */
  viewBox: string
  /** `1 subpath: 2 cubic segments, closed`: as the morph counts them. */
  structure: string
  /** Set when `d` was left out, so a reader knows the path exists and why it is not here. */
  dOmitted?: 'too-long' | 'budget'
}

export interface DescribedClip {
  id: string
  type: Clip['type']
  name: string
  startFrame: number
  durationFrames: number
  /** Last visible frame on the timeline: `startFrame + durationFrames - 1`. */
  endFrame: number
  startSec: number
  durationSec: number
  /** Asset id for media; the text for text; the shape kind for shapes. */
  content?: string
  /** Channel names carrying at least one key. */
  keyed?: string[]
  /** Channels driven by an expression (PV-P5b). */
  expressions?: string[]
  effects?: DescribedEffect[]
  /** Generator clips only (AGN-P22). */
  generator?: DescribedGenerator
  /** AGN-P28: `shape.path` clips only. What a morph has to match. */
  path?: DescribedPath
  blend?: string
  masked?: true
  matteOf?: string
  /** `alpha` (a cut-out, e.g. a removed background) or `luma`; present exactly when `matteOf` is. */
  matteKind?: 'alpha' | 'luma'
  speed?: number
  selected?: true
  /** Link group id: clips sharing it move, trim, split and delete together (PV-T1). */
  linked?: string
  /**
   * Compound only (PV-P1): what it holds, summarised rather than expanded.
   * `clips` counts every clip in the subtree; `depth` is the deepest compound
   * nesting inside it (0 when it holds no further compounds).
   */
  compound?: { clips: number; depth: number }
  /** The component that made this compound (`Clip.component.name`), when it is a generated graphic (EG-P4). */
  component?: string
  /**
   * Component compounds only (EG-P6): what the instance currently says, so an op
   * like `setComponentItems` can be written against it. Capped; `itemsOmitted`
   * counts the rows left out. `itemRange` and `variants` are the bounds an edit must respect.
   */
  instance?: DescribedInstance
  /**
   * Compound only (EG-P4): its children, capped (see `DescribeOptions.maxParts`),
   * in start order. Address one in an op as its `id`. `partsOmitted` counts
   * the children left out.
   */
  parts?: DescribedPart[]
  partsOmitted?: number
  /** Audio clips with a detected-beats set (PV-P10b-3); absent for every other clip. */
  beats?: { bpm?: number; count: number; silences: number }
}

export interface DescribedInstance {
  text?: string
  sub?: string
  variant?: string
  energy?: string
  emphasis?: string[]
  items?: ComponentItem[]
  itemsOmitted?: number
  itemRange?: [number, number]
  variants?: string[]
}

/** The most item rows listed per component (each is a few tokens). */
export const MAX_DESCRIBED_ITEMS = 12

function describeInstance(record: NonNullable<Clip['component']>): DescribedInstance | undefined {
  const input = record.input as unknown as Partial<SpecComponent>
  const def = COMPONENT_REGISTRY.get(record.name as ComponentName)
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const out: DescribedInstance = {}
  if (typeof input.text === 'string' && input.text) out.text = cut(input.text, 120)
  if (typeof input.sub === 'string' && input.sub) out.sub = cut(input.sub, 120)
  if (typeof input.variant === 'string' && input.variant) out.variant = input.variant
  if (typeof input.energy === 'string' && input.energy) out.energy = input.energy
  if (Array.isArray(input.emphasis) && input.emphasis.length) out.emphasis = input.emphasis.slice(0, 8).map((w) => cut(String(w), 40))
  if (Array.isArray(input.items) && input.items.length) {
    out.items = input.items.slice(0, MAX_DESCRIBED_ITEMS).map((it) => {
      const row: ComponentItem = {}
      if (it.text) row.text = cut(it.text, 60)
      if (it.sub) row.sub = cut(it.sub, 60)
      if (it.icon) row.icon = it.icon
      if (typeof it.value === 'number') row.value = it.value
      if (it.style) row.style = it.style
      return row
    })
    if (input.items.length > MAX_DESCRIBED_ITEMS) out.itemsOmitted = input.items.length - MAX_DESCRIBED_ITEMS
  }
  if (def?.items) out.itemRange = [def.items.min, def.items.max]
  if (def?.variants?.length) out.variants = [...def.variants]
  return Object.keys(out).length ? out : undefined
}

/**
 * One clip inside a compound (EG-P4). `id` is the path an op addresses it by,
 * `'compoundId/childId'`; times are in the compound's own frames.
 */
export interface DescribedPart {
  id: string
  /** The deterministic spec part id of a generated graphic's clip. */
  partId?: string
  type: Clip['type']
  /** The text for text; the shape kind for shapes (a path shape's name, since that is its icon); else the clip's name. */
  label?: string
  startFrame: number
  durationFrames: number
  selected?: true
  /** A part that is itself a compound lists its own parts, one level further. */
  compound?: { clips: number; depth: number }
  parts?: DescribedPart[]
  partsOmitted?: number
}

export interface DescribedTrack {
  id: string
  kind: Track['kind']
  name: string
  locked?: true
  hidden?: true
  muted?: true
  /** The magnetic main track: edits on it ripple instead of leaving gaps (PV-T1). */
  main?: true
  clips: DescribedClip[]
}

/** A composition's props and bindings (PV-P7), as an agent needs to see them. */
export interface DescribedComposition {
  props: Array<{ name: string; type: PropType; label: string; value: PropValue; options?: readonly string[]; min?: number; max?: number }>
  bindings: Array<{ clip: string; path: string; prop: string; template?: string }>
}

export interface DescribedProject {
  fps: number
  stage: { width: number; height: number }
  durationFrames: number
  durationSec: number
  tracks: DescribedTrack[]
  markers?: { id: string; frame: number; sec: number; name: string; kind?: string }[]
  /** Where the playhead is (EDX-P11: "here", "now"). */
  playheadSec?: number
  /** The in/out range, when set ("this part"). */
  inOut?: { inSec: number; outSec: number }
  /** Present only for a magnetic project (PV-T1); absent means free placement. */
  timelineMode?: 'magnetic'
  /** Props (PV-P7): setProp changes one everywhere it is bound. Present only for a composition. */
  composition?: DescribedComposition
}

export interface DescribeOptions {
  /** Clip ids the user has selected; flagged so "this clip" can resolve. */
  selection?: ReadonlyArray<string>
  /** Text longer than this is cut with an ellipsis. Default 80. */
  maxContentChars?: number
  /** The playhead frame, so "here" resolves. */
  playheadFrame?: number
  /** Most parts listed under one compound. Default {@link MAX_DESCRIBED_PARTS}. */
  maxParts?: number
  /** Most parts listed across the whole project. Default {@link MAX_DESCRIBED_PARTS_TOTAL}. */
  maxPartsTotal?: number
  /** Most effect/generator params listed on one clip. Default {@link MAX_DESCRIBED_FX_PARAMS}. */
  maxFxParams?: number
  /** Most effect/generator params listed across the whole project. Default {@link MAX_DESCRIBED_FX_PARAMS_TOTAL}. */
  maxFxParamsTotal?: number
  /** Longest `shapePath` listed verbatim on one clip. Default {@link MAX_DESCRIBED_PATH_LENGTH}. */
  maxPathLength?: number
  /** Most path characters listed across the whole project. Default {@link MAX_DESCRIBED_PATH_TOTAL}. */
  maxPathTotal?: number
}

/** Children listed under one compound by default; the rest are counted in `partsOmitted`. */
export const MAX_DESCRIBED_PARTS = 16
/** Parts listed across a whole project by default, so ten graphics cannot flood the prompt. */
export const MAX_DESCRIBED_PARTS_TOTAL = 120
/** How many compound levels are expanded into parts: a compound's children, and a child compound's children. */
const MAX_PART_LEVELS = 2

/** AGN-P22: params listed on one clip across all its effects (a colour grade alone has nine). */
export const MAX_DESCRIBED_FX_PARAMS = 24
/** AGN-P22: params listed across a whole project, so a timeline of graded clips cannot flood the route's 200,000 characters. */
export const MAX_DESCRIBED_FX_PARAMS_TOTAL = 400

/** AGN-P28: longest path listed verbatim on one shape clip; a longer one keeps its structure and viewBox only. */
export const MAX_DESCRIBED_PATH_LENGTH = 400
/** AGN-P28: path characters listed verbatim across a whole project. */
export const MAX_DESCRIBED_PATH_TOTAL = 4000
/** Past this a path is not even parsed for its structure: the sanitiser refuses keys over 4000 anyway. */
const MAX_PARSED_PATH_LENGTH = 20000

interface PartBudget {
  perCompound: number
  remaining: number
  /** AGN-P22: per-clip and project-wide allowance for effect/generator params. */
  fxPerClip: number
  fxRemaining: number
  /** AGN-P28: per-clip and project-wide allowance for path characters. */
  pathPerClip: number
  pathRemaining: number
}

const round = (n: number) => Math.round(n * 1e4) / 1e4

/** The animatable params of a registry entry, current values from `have`, defaulted; at most `take`. */
function rgbaVec(css: string): number[] {
  const c = parseCssColor(css)
  if (!c) return [0, 0, 0, 1]
  const q = (n: number) => Math.round((n / 255) * 1000) / 1000
  return [q(c.r), q(c.g), q(c.b), Math.round(c.a * 1000) / 1000]
}

function animatableParams(defs: Record<string, ParamDef>, have: Record<string, EffectParamValue> | undefined, colours: boolean, take: number): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  let n = 0
  for (const [name, def] of Object.entries(defs)) {
    if (n >= take) break
    if (!def.keyframeable) continue
    if (def.type !== 'number' && !(colours && def.type === 'color')) continue
    const v = have && name in have ? have[name] : def.default
    if (def.type === 'number') out[name] = typeof v === 'number' && Number.isFinite(v) ? round(v) : Number(def.default)
    // A colour param is described in the SAME form its keyframe takes (`vec`, 0..1 straight-alpha),
    // so the model never has to convert a hex string into a key value (AGN-P22 follow-up).
    else out[name] = rgbaVec(typeof v === 'string' ? v : String(def.default))
    n++
  }
  return out
}

function seconds(frames: number, fps: number): number {
  return Math.round((frames / fps) * 100) / 100
}

function contentOf(clip: Clip, max: number): string | undefined {
  if (clip.type === 'text') {
    const text = (clip.content ?? '').replace(/\s+/g, ' ').trim()
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
  }
  if (clip.type === 'shape') return clip.shapeKind
  return clip.assetId ?? undefined
}

function partLabel(clip: Clip, max: number): string | undefined {
  if (clip.type === 'text') return contentOf(clip, Math.min(max, 40))
  if (clip.type === 'shape') return clip.shapeKind === 'path' ? clip.name : clip.shapeKind
  return clip.name
}

/**
 * The children of a compound, in start order, up to the per-compound and the
 * project-wide caps. `prefix` is the path so far (`'compoundId'`).
 */
function describeParts(
  child: Project,
  prefix: string,
  level: number,
  selected: ReadonlySet<string>,
  max: number,
  budget: PartBudget,
): { parts: DescribedPart[]; omitted: number } {
  const order = new Map(child.tracks.map((t) => [t.id, t.order]))
  const all = Object.entries(child.clips)
    .flatMap(([trackId, list]) => list.map((c) => ({ c, order: order.get(trackId) ?? 0 })))
    .sort((a, b) => a.c.startFrame - b.c.startFrame || a.order - b.order)
  const take = Math.max(0, Math.min(budget.perCompound, budget.remaining, all.length))
  const parts: DescribedPart[] = []
  for (const { c } of all.slice(0, take)) {
    budget.remaining--
    const id = `${prefix}/${c.id}`
    const part: DescribedPart = { id, type: c.type, startFrame: c.startFrame, durationFrames: c.durationFrames }
    if (c.partId) part.partId = c.partId
    const label = partLabel(c, max)
    if (label) part.label = label
    if (selected.has(id)) part.selected = true
    if (c.type === 'compound' && c.compound) {
      part.compound = describeCompoundSummary(c.compound.project)
      if (level < MAX_PART_LEVELS) {
        const inner = describeParts(c.compound.project, id, level + 1, selected, max, budget)
        if (inner.parts.length) part.parts = inner.parts
        if (inner.omitted) part.partsOmitted = inner.omitted
      }
    }
    parts.push(part)
  }
  return { parts, omitted: all.length - parts.length }
}

function describePath(clip: Clip, budget: PartBudget | undefined): DescribedPath {
  const d = (clip.shapePath ?? '').trim()
  const vb = clip.shapeViewBox
  const viewBox = vb ? `${round(vb.x)} ${round(vb.y)} ${round(vb.width)} ${round(vb.height)}` : '0 0 100 100'
  const parsed = d.length > 0 && d.length <= MAX_PARSED_PATH_LENGTH ? parsePathToCubics(d) : null
  const structure = parsed ? describeStructure(parsed) : d.length === 0 ? 'no path data' : 'not path data that can morph'
  const out: DescribedPath = { viewBox, structure }
  if (!d) return out
  if (!budget) {
    out.dOmitted = 'budget'
    return out
  }
  if (d.length > budget.pathPerClip) {
    out.dOmitted = 'too-long'
    return out
  }
  if (d.length > budget.pathRemaining) {
    out.dOmitted = 'budget'
    return out
  }
  budget.pathRemaining -= d.length
  out.d = d
  return out
}

function describeClip(clip: Clip, fps: number, selected: ReadonlySet<string>, max: number, project?: Project, budget?: PartBudget): DescribedClip {
  const out: DescribedClip = {
    id: clip.id,
    type: clip.type,
    name: clip.name,
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    endFrame: clip.startFrame + clip.durationFrames - 1,
    startSec: seconds(clip.startFrame, fps),
    durationSec: seconds(clip.durationFrames, fps),
  }
  const content = contentOf(clip, max)
  if (content) out.content = content

  const channels = clip.keyframes?.channels
  const keyed = presentKeyframeChannels(channels).filter(
    (c) => normalizeKeys(channels?.[c]?.keys).length > 0,
  )
  if (keyed.length) out.keyed = keyed

  // An expression channel may hold no keys at all, so it would never appear in
  // `keyed` — a model reading the description would otherwise believe the clip
  // has no animation at all.
  const expressions = presentKeyframeChannels(channels).filter(
    (c) => channels?.[c]?.source?.kind === 'expression',
  )
  if (expressions.length) out.expressions = expressions

  if (clip.type === 'shape' && clip.shapeKind === 'path') out.path = describePath(clip, budget)

  if (Array.isArray(clip.effects) && clip.effects.length) {
    let clipLeft = budget ? budget.fxPerClip : 0
    out.effects = clip.effects.map((e) => {
      const d: DescribedEffect = {
        id: e.id,
        kind: e.kind,
        ...(e.preset ? { preset: e.preset } : {}),
        enabled: e.enabled !== false,
      }
      const def = budget ? getEffectDefinition(e.kind) : undefined
      if (budget && def) {
        const take = Math.max(0, Math.min(clipLeft, budget.fxRemaining))
        const params = animatableParams(def.params, e.params, true, take)
        const count = Object.keys(params).length
        if (count) {
          d.params = params
          clipLeft -= count
          budget.fxRemaining -= count
        }
      }
      return d
    })
  }
  if (clip.type === 'generator' && clip.generator) {
    const g: DescribedGenerator = { kind: clip.generator.kind }
    const def = budget ? GENERATOR_REGISTRY.get(clip.generator.kind) : undefined
    if (budget && def) {
      const take = Math.max(0, Math.min(budget.fxPerClip, budget.fxRemaining))
      const params = animatableParams(def.params, clip.generator.params, false, take) as Record<string, number>
      const count = Object.keys(params).length
      if (count) {
        g.params = params
        budget.fxRemaining -= count
      }
    }
    out.generator = g
  }
  if (clip.blend && clip.blend !== 'normal') out.blend = clip.blend
  if (clip.mask) out.masked = true
  if (clip.matte?.sourceClipId) {
    out.matteOf = clip.matte.sourceClipId
    // MI-P7b: an alpha matte is what a removed background looks like; the planner must not ask for it twice.
    out.matteKind = clip.matte.kind
  }
  if (clip.speed !== undefined && clip.speed !== 1) out.speed = clip.speed
  if (selected.has(clip.id)) out.selected = true
  if (clip.linkId) out.linked = clip.linkId
  // Compounds are summarised, never expanded: a nested dump would grow with the
  // document and an assistant has no use for a whole subtree in one clip's
  // description. Three numbers answer "what is in there and how deep does it go".
  if (clip.type === 'compound' && clip.compound) {
    out.compound = describeCompoundSummary(clip.compound.project)
    if (clip.component?.name) {
      out.component = clip.component.name
      const instance = describeInstance(clip.component)
      if (instance) out.instance = instance
    }
    if (budget) {
      const listed = describeParts(clip.compound.project, clip.id, 1, selected, max, budget)
      if (listed.parts.length) out.parts = listed.parts
      if (listed.omitted) out.partsOmitted = listed.omitted
    }
  }
  if (clip.type === 'audio' && project) {
    const set = markerSetForClip(project, clip)
    if (set) {
      out.beats = {
        count: clipBeatFrames(project, clip).length,
        silences: clipSilenceRanges(project, clip).length,
        ...(set.bpm !== undefined ? { bpm: set.bpm } : {}),
      }
    }
  }
  return out
}

/**
 * A compound's own size, how many clips it holds, and how deep they go.
 *
 * Bounded by `MAX_COMPOUND_DEPTH` for the same reason the walk is: a hand-built
 * document must not be able to make this recurse without end.
 */
function describeCompoundSummary(child: Project): DescribedClip['compound'] {
  let count = 0
  let deepest = 0
  const visit = (p: Project, depth: number) => {
    for (const clips of Object.values(p.clips)) {
      for (const c of clips) {
        count++
        if (depth > deepest) deepest = depth
        if (depth < MAX_COMPOUND_DEPTH && c.type === 'compound' && c.compound) visit(c.compound.project, depth + 1)
      }
    }
  }
  visit(child, 0)
  return { clips: count, depth: deepest }
}

/** The whole project, described. */
export function describeProject(project: Project, opts: DescribeOptions = {}): DescribedProject {
  const fps = project.fps > 0 ? project.fps : 30
  const selected = new Set(opts.selection ?? [])
  const max = opts.maxContentChars ?? 80
  const budget: PartBudget = {
    perCompound: Math.max(0, Math.floor(opts.maxParts ?? MAX_DESCRIBED_PARTS)),
    remaining: Math.max(0, Math.floor(opts.maxPartsTotal ?? MAX_DESCRIBED_PARTS_TOTAL)),
    fxPerClip: Math.max(0, Math.floor(opts.maxFxParams ?? MAX_DESCRIBED_FX_PARAMS)),
    fxRemaining: Math.max(0, Math.floor(opts.maxFxParamsTotal ?? MAX_DESCRIBED_FX_PARAMS_TOTAL)),
    pathPerClip: Math.max(0, Math.floor(opts.maxPathLength ?? MAX_DESCRIBED_PATH_LENGTH)),
    pathRemaining: Math.max(0, Math.floor(opts.maxPathTotal ?? MAX_DESCRIBED_PATH_TOTAL)),
  }

  let end = 0
  const mainId = resolveMainTrackId(project)
  const tracks: DescribedTrack[] = [...project.tracks]
    .sort((a, b) => a.order - b.order)
    .map((track) => {
      const clips = [...(project.clips[track.id] ?? [])]
        .sort((a, b) => a.startFrame - b.startFrame)
        .map((clip) => {
          end = Math.max(end, clip.startFrame + clip.durationFrames)
          return describeClip(clip, fps, selected, max, project, budget)
        })
      const t: DescribedTrack = { id: track.id, kind: track.kind, name: track.name, clips }
      if (track.locked) t.locked = true
      if (track.disabled) t.hidden = true
      if (track.muted) t.muted = true
      if (track.id === mainId) t.main = true
      return t
    })

  const described: DescribedProject = {
    fps,
    stage: { width: project.stage.width, height: project.stage.height },
    durationFrames: end,
    durationSec: seconds(end, fps),
    tracks,
  }
  if (project.markers?.length) {
    described.markers = [...project.markers]
      .sort((a, b) => a.frame - b.frame)
      .map((m) => ({
        id: m.id,
        frame: m.frame,
        sec: seconds(m.frame, fps),
        name: m.name,
        ...(m.kind ? { kind: m.kind } : {}),
      }))
  }
  if (opts.playheadFrame !== undefined && Number.isFinite(opts.playheadFrame)) {
    described.playheadSec = seconds(Math.max(0, opts.playheadFrame), fps)
  }
  if (project.inOut) described.inOut = { inSec: seconds(project.inOut.in, fps), outSec: seconds(project.inOut.out, fps) }
  if (project.timelineMode === 'magnetic') described.timelineMode = 'magnetic'
  if (project.composition?.props.length) {
    const comp = project.composition
    described.composition = {
      props: comp.props.map((p) => {
        const raw = comp.values?.[p.name] ?? p.default
        const value = typeof raw === 'string' && raw.length > max ? `${raw.slice(0, max - 1)}…` : raw
        return {
          name: p.name,
          type: p.type,
          label: p.label || p.name,
          value,
          ...(p.options !== undefined ? { options: p.options } : {}),
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
        }
      }),
      bindings: comp.bindings.map((b) => ({
        clip: b.clipId,
        path: b.path,
        prop: b.prop,
        ...(b.template !== undefined ? { template: b.template } : {}),
      })),
    }
  }
  return described
}
