/**
 * `sanitizeOps` (EDX-P11): the gate between a model's JSON and the engine.
 *
 * Model output is untrusted: strict JSON-schema mode gives the right SHAPE
 * (every optional field present as `null`, params as `[{name, value}]`), but
 * names can be invented, ids stale, numbers absurd. This turns each raw op
 * into a typed `EditorOp` or drops it with a human reason — never throws —
 * so the plan card can show "skipped: no clip 'x7'" instead of failing whole.
 *
 * Enums are checked against the live registries, so the vocabulary the model
 * is told about and the one accepted here cannot drift.
 */

import type { BlendMode, Clip, Project, TransitionDirection } from '../types'
import type { MediaAsset } from '../assets/types'
import { isVectorAsset } from '../assets/vector'
import { BLEND_MODES } from '../types'
import { coerceProp, fallbackValue } from '../composition/validate'
import { parseClipPath, parseFieldPath } from '../composition/paths'
import { FONT_REGISTRY } from '../fonts/registry'
import { locateClip } from './nested'
import type { PropDef, PropType } from '../composition/types'
import { PROP_NAME_RE, PROP_TYPES } from '../composition/types'
import { EFFECT_REGISTRY, clampParam, getEffectDefinition } from '../effects/registry'
import { EFFECT_BUNDLES } from '../effects/bundles'
import { GENERATOR_REGISTRY } from '../generators/registry'
import { isTransitionKind } from '../transitions/registry'
import { MOTION_PRESET_NAMES } from '../elements/motionPresets'
import { STAGGER_FROM_NAMES, type StaggerFrom } from '../elements/stagger'
import { BEAT_PRESET_NAMES } from '../elements/beatPresets'
import { SPEED_PRESET_NAMES } from '../elements/speedPresets'
import { findTextTemplate } from '../elements/textTemplates'
import { MAX_REMOVE_RANGES } from '../elements/rangeEdits'
import { TEXT_ANIMATOR_PRESETS, findCaptionLook } from '../elements/captions'
import { COLOR_CHANNELS, KEYFRAME_CHANNELS, isTierBChannel, parseEffectChannel } from '../resolver/keyframes'
import { parsePathToCubics, reconcileCubics } from '../resolver/pathMorph'
import { BEZIER_PRESETS } from '../elements/easingPresets'
import { SPRING_PRESETS } from '../elements/springPresets'
import { TEXT_ANIMATION_EASINGS } from '../resolver/textAnimation'
import { MAX_EXPRESSION_LENGTH } from '../resolver/expr/scope'
import { parseExpression } from '../resolver/expr/parse'
import { MOTION_ENERGIES, type ComponentItem } from '../spec/components/types'
import { COMPONENT_FIELDS, MAX_COMPONENT_TEXT, MAX_EMPHASIS_WORDS, MAX_ITEM_SUB, MAX_ITEM_TEXT } from './componentEdit'
import { EDITOR_OP_NAMES, REGIONS, SHAPE_OP_KINDS, type EditorOp, type KeyOp, type OpParams, type Region } from './types'

export interface SanitizeResult {
  ops: EditorOp[]
  dropped: Array<{ index: number; reason: string }>
}

type Raw = Record<string, unknown>

const HEX = /^#[0-9a-f]{6}$/i
const MAX_TEXT = 200
const DIRECTIONS: ReadonlyArray<TransitionDirection> = ['left', 'right', 'up', 'down']
const CAPTION_MODES = ['static', 'karaoke', 'highlight', 'reveal'] as const

class Drop extends Error {}
const drop = (reason: string): never => {
  throw new Drop(reason)
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const present = (v: unknown) => v !== null && v !== undefined

function num(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, n))
}
function reqNum(v: unknown, min: number, max: number, what: string): number {
  return num(v, min, max) ?? drop(`${what} is missing or not a number`)
}
function str(v: unknown, max = MAX_TEXT): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}
function reqStr(v: unknown, what: string, max = MAX_TEXT): string {
  return str(v, max) ?? drop(`${what} is empty`)
}
function color(v: unknown): string | undefined {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}
function oneOf<T extends string>(v: unknown, options: ReadonlyArray<T>): T | undefined {
  return typeof v === 'string' && (options as ReadonlyArray<string>).includes(v) ? (v as T) : undefined
}
function reqOneOf<T extends string>(v: unknown, options: ReadonlyArray<T>, what: string): T {
  return oneOf(v, options) ?? drop(`unknown ${what} "${String(v)}"`)
}
/** Drop undefined keys so ops stay minimal. */
function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

/** `{a: 1}` or `[{name: 'a', value: 1}]` (the strict-schema form) → a params object. */
function params(v: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(v)) {
    const out: Record<string, unknown> = {}
    for (const p of v) if (isObj(p) && typeof p.name === 'string') out[p.name] = coerce(p.value)
    return Object.keys(out).length ? out : undefined
  }
  return isObj(v) ? v : undefined
}
/** Model values often arrive as strings: "0.5" → 0.5, "true" → true. */
function coerce(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && Number.isFinite(Number(t))) return Number(t)
  return t
}

const TIME_MAX = 60 * 60 * 3
/** `staggerPreset` (MG-P5): most clips in one stagger, the frame offset between neighbours (clamped), and its default. */
const MAX_STAGGER_CLIPS = 24
const STAGGER_OFFSET_MAX_FRAMES = 300
const STAGGER_DEFAULT_OFFSET_FRAMES = 6
const DUR_MIN = 0.1
const DUR_MAX = 60 * 30
/** `insertStock`: the B-roll length the planner may ask for. */
const STOCK_DUR_MIN = 0.5
const STOCK_DUR_MAX = 30

function at(v: unknown, what = 'at'): number {
  return reqNum(v, 0, TIME_MAX, what)
}
function duration(v: unknown): number {
  return reqNum(v, DUR_MIN, DUR_MAX, 'duration')
}

/** `crossfadeCuts` most clips, `duckUnder` most speech segments (CHAT-5a). */
const MAX_FADE_CLIPS = 64
const MAX_DUCK_SEGMENTS = 200

/**
 * `[{from, to}]` (or `[[from, to]]`, or `{start, end}` rows) as seconds pairs: finite, 0..TIME_MAX, each ending after
 * it starts. An unusable row is left out; the caller decides whether none left is a drop.
 */
function secondsPairs(v: unknown, max: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  for (const item of (Array.isArray(v) ? v : []).slice(0, max)) {
    const a = Array.isArray(item) ? item[0] : isObj(item) ? (item.from ?? item.start) : undefined
    const b = Array.isArray(item) ? item[1] : isObj(item) ? (item.to ?? item.end) : undefined
    const from = num(a, 0, TIME_MAX)
    const to = num(b, 0, TIME_MAX)
    if (from === undefined || to === undefined || to <= from) continue
    out.push({ from, to })
  }
  return out
}

const REVEALS = TEXT_ANIMATOR_PRESETS.map((p) => p.id)
const CURVES = [
  ...BEZIER_PRESETS.map((p) => p.id),
  ...TEXT_ANIMATION_EASINGS,
  ...SPRING_PRESETS.map((p) => `spring:${p.id}`),
]
const KEY_CHANNELS: ReadonlyArray<string> = [...KEYFRAME_CHANNELS, 'draw', 'draw.start']
const MASK_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'feather'] as const
const MAX_PATH_LENGTH = 4000
/** What a channel is keyed with: `scalar` keys carry `value`, `color` keys `vec`, `path` keys `path`. */
type KeyKind = 'scalar' | 'color' | 'path'

/**
 * `r`'s shape as one declared prop, or `null` when it cannot become one:
 * a bad name, an unknown type, or an `enum` with no usable options.
 */
function sanitizePropDef(r: Raw): PropDef | null {
  const name = typeof r.name === 'string' && PROP_NAME_RE.test(r.name) ? r.name : undefined
  if (!name) return null
  const type: PropType | undefined = oneOf(r.type, PROP_TYPES)
  if (!type) return null
  const label = str(r.label, 60) ?? name
  const min = num(r.min, -1e6, 1e6)
  const max = num(r.max, -1e6, 1e6)
  const rawOptions = Array.isArray(r.options) ? r.options.map((x) => str(x, 40)).filter((x): x is string => !!x) : []
  const options = type === 'enum' ? [...new Set(rawOptions)].slice(0, 20) : undefined
  if (type === 'enum' && (!options || options.length === 0)) return null

  const partial = clean({ name, type, label, min, max, options }) as unknown as PropDef
  const coerced = coerceProp(partial, coerce(r.default))
  const value = coerced.value !== undefined ? coerced.value : fallbackValue(partial)
  return { ...partial, default: value }
}

/** `2 subpaths: 4 + 3 segments, closed + open`: a path's structure as the morph compares it (after every command is a cubic). */
export function describeStructure(sub: ReadonlyArray<{ segs: number[]; closed: boolean }>): string {
  const n = sub.length
  return `${n} subpath${n === 1 ? '' : 's'}: ${sub.map((p) => p.segs.length / 6).join(' + ')} cubic segment${sub.length === 1 && sub[0]!.segs.length === 6 ? '' : 's'}, ${sub.map((p) => (p.closed ? 'closed' : 'open')).join(' + ')}`
}

/**
 * AGN-P26/P27: the refusal for consecutive `shape.path` keys the morph cannot
 * reconcile. Differing segment or subpath counts no longer refuse (the sampler
 * reconciles them); what is left is a genuine mismatch, so the message states the
 * reconciler's own reason and keeps each key's structure (subpath count, cubic
 * segment count and closedness, as the morph counts them: L, H, V, Q, S and T each
 * become one cubic segment) so a repair round can rewrite the odd key.
 */
function morphMismatch(keys: ReadonlyArray<KeyOp>, from: number, reason: string): string {
  const shown = (i: number) => `key ${i + 1} (at ${keys[i]!.at}s) is ${describeStructure(parsePathToCubics(keys[i]!.path!)!)}`
  return `"shape.path" keys ${from + 1} and ${from + 2} cannot morph: ${reason}. ${shown(from)}; ${shown(from + 1)}`
}

/**
 * Sanitize a model's op list against `project` (for clip ids and, for
 * `setProp`, the props an earlier `addComposition` in the same plan declared).
 * `$ref` names are valid once an earlier op declared them.
 */
export function sanitizeOps(
  raw: unknown,
  project: Pick<Project, 'clips' | 'composition'> & Partial<Pick<Project, 'tracks' | 'markers' | 'transitions'>> & { fps?: number },
  /** The library, for `insertSourceRange`: without it the range is checked but the asset id is not. */
  opts: { assets?: ReadonlyMap<string, Pick<MediaAsset, 'kind' | 'durationSec'> & Partial<Pick<MediaAsset, 'name' | 'src' | 'animated' | 'vector'>>> } = {},
): SanitizeResult {
  const list = Array.isArray(raw) ? raw : []
  const ids = new Set<string>()
  const roots = new Map<string, Project['clips'][string][number]>()
  for (const clips of Object.values(project.clips)) {
    for (const c of clips) {
      ids.add(c.id)
      roots.set(c.id, c)
    }
  }
  /**
   * AGN-P26: what an op in THIS plan will create, by `ref`, for the kinds whose
   * output is known from the op alone. `proveChannel` consults it, so a channel
   * can be proven on a `$ref` clip the same way it is on one already in the
   * project. A `ref` with no entry here has an output type that is not known yet.
   */
  const prospects = new Map<string, Pick<Clip, 'type'> & { shapeKind?: string }>()
  /** Refs made by `insertVector`: type unknown until the SVG is read, so no prospect; kept to give a better refusal. */
  const vectorRefs = new Set<string>()
  const refs = new Set<string>()
  const removed = new Set<string>()
  const declaredProps = new Set((project.composition?.props ?? []).map((p) => p.name))
  const out: EditorOp[] = []
  const dropped: SanitizeResult['dropped'] = []
  /** Plan index of each entry in `out`, so the plan-level pass below can report a drop against the step the model wrote. */
  const outIndex: number[] = []

  /**
   * AGN-P26: a clip named in `describeProject` by its NAME. An id always wins (an
   * id is exact, and a clip whose name equals another clip's id is reached by
   * that id only). Otherwise one exact name, else one case-insensitive name.
   * Two or more clips matching at the same step is a refusal naming every id:
   * never a pick. `undefined` = no clip has that name.
   */
  const byName = (s: string): string | undefined => {
    const all = [...roots.values()]
    const exact = all.filter((c) => c.name === s)
    const hits = exact.length > 0 ? exact : all.filter((c) => typeof c.name === 'string' && c.name.toLowerCase() === s.toLowerCase())
    if (hits.length === 0) return undefined
    if (hits.length > 1) return drop(`"${s}" names ${hits.length} clips (${hits.map((c) => c.id).join(', ')}); use the id of the one you mean`)
    return hits[0]!.id
  }
  const clipRef = (v: unknown, what = 'clip'): string => {
    let s = typeof v === 'string' ? v.trim() : ''
    if (!s) return drop(`${what} is missing`)
    if (s.startsWith('$')) {
      if (!refs.has(s.slice(1))) return drop(`${what} "${s}" refers to nothing created earlier in the plan`)
      return s
    }
    if (!ids.has(s)) {
      const named = byName(s)
      if (named === undefined) {
        if (s.includes('/')) return drop(`"${s}" is a path into a graphic; this op works on whole clips only`)
        return drop(`no clip "${s}" on the timeline`)
      }
      s = named
    }
    if (removed.has(s)) return drop(`clip "${s}" is removed earlier in the plan`)
    return s
  }
  /**
   * `clipRef`, plus a path `'compoundId/childId'` into a compound (EG-P4). The
   * path is checked by walking the project, so a part that is not there is a
   * readable drop rather than a later skip. Only the ops that edit a clip's own
   * properties use this one; every other op keeps `clipRef` and refuses a path.
   */
  const partRef = (v: unknown, what = 'clip'): string => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s.includes('/') || ids.has(s)) return clipRef(v, what)
    const segs = parseClipPath(s)
    if (!segs) return drop(`${what} "${s}" is not a valid part path`)
    if (segs[0]!.startsWith('$')) return drop(`${what} "${s}": a part of a clip created in this plan cannot be addressed yet`)
    let root = segs[0]!
    if (!ids.has(root)) {
      const named = byName(root)
      if (named === undefined) return drop(`no clip "${root}" on the timeline`)
      root = named
      segs[0] = root
    }
    if (removed.has(root)) return drop(`clip "${root}" is removed earlier in the plan`)
    const rootClip = roots.get(root)!
    if (rootClip.type !== 'compound' || !rootClip.compound?.project) return drop(`"${root}" is not a graphic or compound, so it has no parts`)
    const found = locateClip(rootClip.compound.project, segs.slice(1))
    if (!found.ok) return drop(`${found.reason} inside "${root}"`)
    return segs.join('/')
  }
  /** A clip id or a part path (never a `$ref`: a graphic made in this same plan has no fields to edit yet). */
  const instanceRef = (v: unknown): string => {
    if (typeof v === 'string' && v.trim().startsWith('$')) return drop('a graphic created in this plan cannot be edited in the same plan')
    return partRef(v)
  }
  const ref = (v: unknown): string | undefined => {
    const s = str(v, 40)?.replace(/^\$/, '').replace(/[^\w-]/g, '')
    if (s) refs.add(s)
    return s || undefined
  }
  const region = (v: unknown): Region | undefined => oneOf(v, REGIONS)
  /**
   * `under` on addGenerator / addImage: the clip this one is placed behind. A clip on the timeline or a `$ref` made
   * earlier in the plan; never audio (it has no picture to sit behind). `undefined` when the model sent none.
   */
  const underRef = (v: unknown): string | undefined => {
    if (!present(v) || v === '') return undefined
    const id = clipRef(v, 'under')
    const t = roots.get(id)
    if (t?.type === 'audio') drop(`under: "${t.name}" is audio, so nothing can sit behind it`)
    return id
  }
  const motion = (v: unknown) => oneOf(v, MOTION_PRESET_NAMES as ReadonlyArray<string>)

  /**
   * AGT-4b: a lane or a marker by id, else its exact name, else one case-insensitive name. Two or more at the
   * same step is a refusal naming every id: never a pick. One already removed earlier in the plan is a refusal.
   */
  const removedTracks = new Set<string>()
  const removedMarkers = new Set<string>()
  const byIdOrName = <T extends { id: string; name: string }>(all: ReadonlyArray<T>, v: unknown, what: string, gone: Set<string>): T => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s) return drop(`${what} is missing`)
    let hit = all.find((x) => x.id === s)
    if (!hit) {
      const exact = all.filter((x) => x.name === s)
      const hits = exact.length > 0 ? exact : all.filter((x) => x.name.toLowerCase() === s.toLowerCase())
      if (hits.length === 0) return drop(`no ${what} "${s}"`)
      if (hits.length > 1) return drop(`"${s}" names ${hits.length} ${what}s (${hits.map((x) => x.id).join(', ')}); use the id of the one you mean`)
      hit = hits[0]!
    }
    if (gone.has(hit.id)) return drop(`${what} "${s}" is removed earlier in the plan`)
    return hit
  }
  const trackRef = (v: unknown) => byIdOrName(project.tracks ?? [], v, 'track', removedTracks)
  const markerRef = (v: unknown) => byIdOrName(project.markers ?? [], v, 'marker', removedMarkers)
  const MARKER_LABEL = /^label-[1-8]$/

  /**
   * The clip a channel is about to be proven against: a top-level clip, or a
   * part inside a compound. `undefined` for a `$ref` made in this same plan,
   * which has nothing to inspect yet.
   */
  const clipFor = (target: string): Pick<Clip, 'type'> & Partial<Clip> | undefined => {
    if (target.startsWith('$')) return prospects.get(target.slice(1)) as (Pick<Clip, 'type'> & Partial<Clip>) | undefined
    if (!target.includes('/') || roots.has(target)) return roots.get(target)
    const segs = parseClipPath(target)
    const root = segs ? roots.get(segs[0]!) : undefined
    if (!segs || !root?.compound?.project) return undefined
    const found = locateClip(root.compound.project, segs.slice(1))
    return found.ok ? found.clip : undefined
  }
  /**
   * AGN-P21: prove from the project that `target` can carry `channel`, or drop
   * with the reason. The nine builtins and `draw` need no proof (every visual
   * clip has them). Every extended channel is checked against what THIS clip
   * really has, so a name the model made up is a readable refusal rather than a
   * key the engine would write and nothing would ever read.
   */
  const proveChannel = (channel: string, target: string, what = 'keyframe channel'): KeyKind => {
    if (KEY_CHANNELS.includes(channel)) return 'scalar'
    const fx = parseEffectChannel(channel)
    const known =
      fx !== undefined ||
      channel.startsWith('mask.') ||
      channel.startsWith('gen.') ||
      channel === 'shape.path' ||
      isTierBChannel(channel) ||
      (COLOR_CHANNELS as ReadonlyArray<string>).includes(channel)
    if (!known) return drop(`unknown ${what} "${channel}"`)
    const clip = clipFor(target)
    if (!clip) {
      if (target.startsWith('$') && vectorRefs.has(target.slice(1))) {
        return drop(
          `"${channel}" cannot be checked on a vector created in this plan: an SVG with one shape lands as a shape and any other SVG as a compound of parts, and which is not known until it is placed. Place it now and animate its parts (compoundId/childId, listed by describeProject) in the next plan; opacity, scale and position work on it already`,
        )
      }
      return drop(`"${channel}" cannot be checked on a clip created in this plan; add the keys in a later plan`)
    }
    // A clip created in this plan is known by type only: its effects, mask and generator params are not, so those channels stay refused.
    if (target.startsWith('$') && (fx !== undefined || channel.startsWith('mask.') || channel.startsWith('gen.'))) {
      return drop(`"${channel}" cannot be checked on a clip created in this plan; add the keys in a later plan`)
    }
    // MC-2d: the Tier B scalar channels, each proven against the clip type that reads it.
    if (channel === 'text.fontSize' || channel === 'text.letterSpacing') {
      if (clip.type !== 'text') return drop(`"${channel}" keys text, and this clip is not text`)
      // MC-1g: tracking keys move a boxless clip to boxed layout, which does not apply `spans`.
      if (channel === 'text.letterSpacing' && (clip.spans?.length ?? 0) > 0 && !clip.textBox) {
        return drop('this text has styled words; tracking keys would drop that styling — give it a text box first')
      }
      return 'scalar'
    }
    if (channel === 'stroke.width') {
      if (clip.type !== 'shape') return drop('"stroke.width" needs a shape clip')
      return 'scalar'
    }
    if (channel === 'anchor.x' || channel === 'anchor.y') {
      if (clip.type === 'audio') return drop(`"${channel}" needs a clip with a transform, and audio has none`)
      return 'scalar'
    }
    if (channel === 'color') {
      if (clip.type !== 'text') return drop('"color" keys the colour of text, and this clip is not text')
      return 'color'
    }
    if (channel === 'shape.fill' || channel === 'shape.stroke') {
      if (clip.type !== 'shape') return drop(`"${channel}" needs a shape clip`)
      return 'color'
    }
    if (channel === 'shape.path') {
      if (clip.type !== 'shape' || clip.shapeKind !== 'path') return drop('"shape.path" needs a shape clip whose variant is "path"')
      return 'path'
    }
    if (channel.startsWith('mask.')) {
      const field = channel.slice(5)
      if (!(MASK_FIELDS as ReadonlyArray<string>).includes(field)) return drop(`"${channel}" is not a mask field (${MASK_FIELDS.join(', ')})`)
      if (!clip.mask) return drop(`"${channel}": this clip has no mask`)
      return 'scalar'
    }
    if (channel.startsWith('gen.')) {
      const param = channel.slice(4)
      if (clip.type !== 'generator' || !clip.generator) return drop(`"${channel}" needs a generator clip`)
      const def = GENERATOR_REGISTRY.get(clip.generator.kind)?.params[param]
      if (!def) return drop(`"${channel}": the ${clip.generator.kind} generator has no param "${param}"`)
      if (def.type !== 'number' || !def.keyframeable) return drop(`"${channel}": that param cannot be animated`)
      return 'scalar'
    }
    // fx.<effectId>.<param>
    const { effectId, param } = fx!
    const effect = clip.effects?.find((e) => e.id === effectId)
    if (!effect) return drop(`"${channel}" names an effect this clip does not have ("${effectId}")`)
    const def = getEffectDefinition(effect.kind)?.params[param]
    if (!def) return drop(`"${channel}": the ${effect.kind} effect has no param "${param}"`)
    if (!def.keyframeable || (def.type !== 'number' && def.type !== 'color')) return drop(`"${channel}": that param cannot be animated`)
    return def.type === 'color' ? 'color' : 'scalar'
  }

  /**
   * AGN-P24: an unknown motion preset names the real ones. The live planner wrote
   * `overshoot` (AGN-P18's CURVE name) in the preset slot; the refusal teaches the
   * repair round instead of guessing a nearest preset.
   */
  const motionPreset = (v: unknown): string => {
    const all = [...MOTION_PRESET_NAMES, ...BEAT_PRESET_NAMES] as ReadonlyArray<string>
    return oneOf(v, all) ?? drop(`unknown motion preset "${String(v)}" (presets: ${all.join(', ')}; a curve name such as overshoot goes in a keyframe curve, not here)`)
  }
  /**
   * AGN-P24: build a `setKeyframes` op. Shared by `setKeyframes` and by
   * `setEffectParam` given `keys`, so both pass the same proofs.
   */
  const keyframeOp = (channelRaw: unknown, clipRaw: unknown, keysRaw: unknown): EditorOp => {
    const channel = typeof channelRaw === 'string' ? channelRaw.trim() : ''
    const target = partRef(clipRaw)
    const kind = proveChannel(channel, target)
    const rawKeys = (Array.isArray(keysRaw) ? keysRaw : []).filter(isObj).slice(0, 64)
    const keys: KeyOp[] = []
    for (const k of rawKeys) {
          const t = num(k.at, 0, TIME_MAX)
          if (t === undefined) continue
          const curve = oneOf(k.curve, CURVES)
          const hold = bool(k.hold) || undefined
          const hasVec = Array.isArray(k.vec) && k.vec.length > 0
          const hasPath = typeof k.path === 'string' && k.path.trim() !== ''
          if (kind === 'color') {
            if (hasPath) drop(`"${channel}" is a colour channel: its keys take vec, not path`)
            const vec = hasVec ? (k.vec as unknown[]) : []
            if ((vec.length !== 3 && vec.length !== 4) || !vec.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1)) {
              drop(`"${channel}" keys need vec: 3 or 4 numbers (r, g, b[, a]) each 0..1`)
            }
            keys.push(clean({ at: t, value: 0, vec: [...(vec as number[])], curve, hold }) as KeyOp)
          } else if (kind === 'path') {
            if (hasVec) drop('"shape.path" keys take path, not vec')
            if (!hasPath) drop('"shape.path" keys need path: SVG path data')
            const d = (k.path as string).trim()
            if (d.length > MAX_PATH_LENGTH) drop(`a "shape.path" key is longer than ${MAX_PATH_LENGTH} characters`)
            if (!parsePathToCubics(d)) drop('a "shape.path" key is not path data that can morph: use M, L, H, V, C, S, Q, T, A, Z; the two flags of an A arc must each be written 0 or 1 with spaces around them')
            keys.push(clean({ at: t, value: 0, path: d, curve, hold }) as KeyOp)
          } else {
            if (hasVec) drop(`vec is for colour channels only, and "${channel}" is a number channel`)
            if (hasPath) drop(`path is for the "shape.path" channel only, and "${channel}" is a number channel`)
            const v = num(k.value, -1e6, 1e6)
            if (v === undefined) continue
            keys.push(clean({ at: t, value: v, curve, hold }) as KeyOp)
          }
    }
    if (keys.length === 0) drop('no usable keyframes')
    if (kind === 'path') {
      // The sampler morphs CONSECUTIVE keys, so each consecutive pair must reconcile. Key data is stored exactly as authored.
      for (let i = 0; i + 1 < keys.length; i++) {
        const r = reconcileCubics(parsePathToCubics(keys[i]!.path!)!, parsePathToCubics(keys[i + 1]!.path!)!)
        if (!r.ok) drop(morphMismatch(keys, i, r.reason))
      }
    }
    return { op: 'setKeyframes', clip: target, channel, keys }
  }

  list.forEach((item, index) => {
    try {
      if (!isObj(item)) drop('not an object')
      const r = item as Raw
      const name = reqOneOf(r.op, EDITOR_OP_NAMES, 'op')
      let op: EditorOp
      switch (name) {
        case 'addText': {
          const template = str(r.template, 60)
          op = clean({
            op: name,
            ref: ref(r.ref),
            text: reqStr(r.text, 'text'),
            at: at(r.at),
            duration: duration(r.duration),
            template: template && findTextTemplate(template) ? template : undefined,
            color: color(r.color),
            size: num(r.size, 8, 600),
            region: region(r.region),
            motion: motion(r.motion),
            reveal: oneOf(r.reveal, REVEALS),
            outline: bool(r.outline),
            shadow: bool(r.shadow),
          })
          break
        }
        case 'addShape':
          op = clean({
            op: name,
            ref: ref(r.ref),
            kind: reqOneOf(r.kind, SHAPE_OP_KINDS, 'shape'),
            at: at(r.at),
            duration: duration(r.duration),
            color: color(r.color),
            outline: bool(r.outline),
            region: region(r.region),
            size: num(r.size, 0.02, 1.5),
            drawOn: bool(r.drawOn),
            motion: motion(r.motion),
          })
          break
        case 'addGenerator': {
          const kind = reqOneOf(r.kind, [...GENERATOR_REGISTRY.keys()], 'generator')
          const def = GENERATOR_REGISTRY.get(kind)!
          const preset = str(r.preset, 40)
          const genUnder = underRef(r.under)
          const p = params(r.params)
          const kept: OpParams = {}
          for (const [k, v] of Object.entries(p ?? {})) {
            const pd = def.params[k]
            if (pd) kept[k] = clampParam(pd, coerce(v))
          }
          op = clean({
            op: name,
            ref: ref(r.ref),
            kind,
            preset: preset && def.presets?.some((x) => x.id === preset) ? preset : undefined,
            params: Object.keys(kept).length ? kept : undefined,
            at: genUnder ? num(r.at, 0, TIME_MAX) : at(r.at),
            duration: genUnder ? num(r.duration, DUR_MIN, DUR_MAX) : duration(r.duration),
            region: region(r.region),
            under: genUnder,
          })
          break
        }
        case 'addLowerThird':
        case 'addTitleCard':
          op = clean({
            op: name,
            ref: ref(r.ref),
            title: reqStr(r.title ?? r.text, 'title', 80),
            subtitle: str(r.subtitle, 80),
            at: at(r.at),
            duration: duration(r.duration),
            ...(name === 'addLowerThird' ? { accent: color(r.accent ?? r.color) } : {}),
          }) as EditorOp
          break
        case 'addCallout':
          op = clean({
            op: name,
            ref: ref(r.ref),
            text: reqStr(r.text ?? r.title, 'text', 80),
            at: at(r.at),
            duration: duration(r.duration),
            region: region(r.region),
            accent: color(r.accent ?? r.color),
          })
          break
        case 'setCaptionStyle':
          op = clean({ op: name, mode: reqOneOf(r.mode, CAPTION_MODES, 'caption mode'), highlight: color(r.highlight ?? r.color) })
          break
        case 'removeClip': {
          const clip = clipRef(r.clip)
          if (!clip.startsWith('$')) removed.add(clip)
          op = { op: name, clip }
          break
        }
        case 'moveClip':
          op = { op: name, clip: clipRef(r.clip), at: at(r.at) }
          break
        case 'trimClip': {
          const start = num(r.start, 0, TIME_MAX)
          const end = num(r.end, 0, TIME_MAX)
          if (start === undefined && end === undefined) drop('trim needs a start or an end')
          if (start !== undefined && end !== undefined && end <= start) drop('trim end is before its start')
          op = clean({ op: name, clip: clipRef(r.clip), start, end })
          break
        }
        case 'splitClip':
          op = { op: name, clip: clipRef(r.clip), at: at(r.at) }
          break
        case 'setSpeed':
          op = { op: name, clip: clipRef(r.clip), speed: reqNum(r.speed, 0.25, 4, 'speed') }
          break
        case 'setFit':
          op = clean({
            op: name,
            clip: clipRef(r.clip),
            fit: reqOneOf(r.fit, ['contain', 'cover', 'blur-fill'] as const, 'fit'),
            focusX: num(r.focusX, 0, 1),
            focusY: num(r.focusY, 0, 1),
          })
          break
        case 'applySpeedPreset':
          op = clean({
            op: name,
            clip: clipRef(r.clip),
            preset: reqOneOf(r.preset, SPEED_PRESET_NAMES as ReadonlyArray<string>, 'speed preset'),
            at: num(r.at, 0, TIME_MAX),
          })
          break
        case 'setClipProps': {
          const props = clean({
            opacity: num(r.opacity, 0, 1),
            volume: num(r.volume, 0, 2),
            x: num(r.x, -1, 2),
            y: num(r.y, -1, 2),
            scale: num(r.scale, 0.01, 20),
            rotation: num(r.rotation, -3600, 3600),
            text: str(r.text),
            color: color(r.color),
            anchorX: num(r.anchorX, 0, 1),
            anchorY: num(r.anchorY, 0, 1),
          })
          const under = present(r.under) ? clipRef(r.under, 'under') : undefined
          if (Object.keys(props).length === 0 && under === undefined) drop('nothing to change')
          const target = partRef(r.clip)
          if (under !== undefined) {
            if (under === target) drop('a clip cannot sit under itself')
            if (target.includes('/')) drop('"under" is not available on a part of a graphic')
          }
          op = { op: name, clip: target, ...props, ...(under !== undefined ? { under } : {}) }
          break
        }
        case 'applyMotionPreset':
          op = clean({
            op: name,
            clip: partRef(r.clip),
            preset: motionPreset(r.preset),
            amount: num(r.amount, 0.25, 3),
            syncTo: oneOf(r.syncTo, ['beats'] as const),
            audio: present(r.audio) ? clipRef(r.audio, 'audio') : undefined,
          })
          break
        case 'staggerPreset': {
          // MG-P5. Flat, all-or-nothing: any bad clip or preset drops the whole op. Beat presets are not whole-clip
          // presets and cannot stagger, so the list is MOTION_PRESET_NAMES alone.
          const rawClips = Array.isArray(r.clips) ? (r.clips as unknown[]) : drop('staggerPreset needs a clips array')
          if (rawClips.length > MAX_STAGGER_CLIPS) drop(`staggerPreset takes at most ${MAX_STAGGER_CLIPS} clips`)
          const clips = rawClips.map((c) => clipRef(c, 'clip to stagger'))
          if (clips.length < 2) drop('staggerPreset needs at least two clips; use applyMotionPreset for one')
          if (new Set(clips).size !== clips.length) drop('staggerPreset was given the same clip twice')
          const preset =
            oneOf(r.preset, MOTION_PRESET_NAMES) ??
            drop(`unknown stagger preset "${String(r.preset)}" (presets: ${MOTION_PRESET_NAMES.join(', ')}; beat presets cannot stagger)`)
          const offset = num(r.offsetFrames, 0, STAGGER_OFFSET_MAX_FRAMES)
          // MOT-2. All optional; a value that is present but unusable drops the op, like an unknown preset.
          let from: StaggerFrom | undefined
          if (present(r.from)) {
            const named = oneOf(r.from, STAGGER_FROM_NAMES)
            const idx = num(r.from, 0, MAX_STAGGER_CLIPS - 1)
            if (named) from = named
            else if (idx !== undefined) from = Math.round(idx)
            else drop(`unknown stagger origin "${String(r.from)}" (use ${STAGGER_FROM_NAMES.join(', ')} or a clip index)`)
          }
          const ease = present(r.ease)
            ? (oneOf(r.ease, TEXT_ANIMATION_EASINGS) ?? drop(`unknown stagger ease "${String(r.ease)}"`))
            : undefined
          const gridCols = present(r.grid) ? num(r.grid, 1, MAX_STAGGER_CLIPS) : undefined
          if (present(r.grid) && gridCols === undefined) drop('stagger grid must be a column count')
          op = clean({
            op: name,
            clips,
            preset,
            amount: num(r.amount, 0.25, 3),
            offsetFrames: offset === undefined ? STAGGER_DEFAULT_OFFSET_FRAMES : Math.round(offset),
            from,
            ease,
            grid: gridCols === undefined ? undefined : Math.round(gridCols),
          })
          break
        }
        case 'setKeyframes':
          // AGN-P24: `param` is an accepted alias for `channel` (the live planner
          // wrote every channel there). `channel` wins when both are present.
          op = keyframeOp(r.channel ?? r.param, r.clip, r.keys)
          break
        case 'setExpression': {
          // AGN-P21: the original policy here was "builtin channels only", because
          // `fx.<id>.<param>` needs an effect id the model would have to invent and
          // `mask.`/`gen.` are per clip. `sanitizeOps` has the project, so each
          // extended channel is now PROVEN on this clip (`proveChannel`) instead of
          // banned. `draw` stays out: an expression cannot drive it.
          // AGN-P24: `param` is an accepted alias for `channel`, as on setKeyframes.
          const rawChannel = r.channel ?? r.param
          const channel = typeof rawChannel === 'string' ? rawChannel.trim() : ''
          const exprTarget = partRef(r.clip)
          // `draw` is a key channel but never an expression channel.
          if (channel === 'draw' || channel === 'draw.start' || isTierBChannel(channel)) drop(`unknown expression channel "${channel}"`)
                    const exprKind = proveChannel(channel, exprTarget, 'expression channel')
          if (exprKind !== 'scalar') drop(`"${channel}" is not a number channel, and an expression yields a number; key it with setKeyframes`)
          // `text` is an accepted alias: the model schema already has a nullable
          // `text` field, and it is the obvious one to reach for.
          const raw = r.source ?? r.text
          if (raw === null || raw === undefined) {
            op = { op: name, clip: exprTarget, channel, source: null }
            break
          }
          // Deliberately not `str()`: that truncates silently, and a silently
          // truncated expression is a mystery animation rather than a refusal.
          // `op = drop(...)` rather than a bare `drop(...)`: `drop` is a `const`
          // arrow typed `never`, which TypeScript will not treat as
          // never-returning, so the assignment is what tells the checker this
          // path cannot reach `out.push(op)` with `op` unset.
          if (typeof raw !== 'string') {
            op = drop('the expression is not text')
            break
          }
          const s = raw.trim()
          if (s === '') {
            op = { op: name, clip: exprTarget, channel, source: null }
            break
          }
          if (s.length > MAX_EXPRESSION_LENGTH) drop(`the expression is longer than ${MAX_EXPRESSION_LENGTH} characters`)
          const parsed = parseExpression(s)
          if (!parsed.ok) drop(`the expression does not parse: ${parsed.message}`)
          op = { op: name, clip: exprTarget, channel, source: s }
          break
        }
        case 'setStyle': {
          const strictColor = (v: unknown, what: string): string | undefined => {
            if (!present(v)) return undefined
            return color(v) ?? drop(`${what} must be a #rrggbb colour`)
          }
          let fontId: string | undefined
          if (present(r.fontId)) {
            const id = typeof r.fontId === 'string' ? r.fontId.trim() : ''
            if (!FONT_REGISTRY.some((f) => f.id === id)) drop(`unknown font "${String(r.fontId)}"`)
            fontId = id
          }
          const weight = num(r.fontWeight, 100, 900)
          const props = clean({
            fill: strictColor(r.fill, 'fill'),
            stroke: strictColor(r.stroke, 'stroke'),
            strokeWidth: num(r.strokeWidth, 0, 200),
            fontId,
            fontWeight: weight !== undefined ? Math.round(weight / 100) * 100 : undefined,
            fontSize: num(r.fontSize, 8, 600),
            cornerRadius: num(r.cornerRadius, 0, 0.5),
            textAlign: oneOf(r.textAlign, ['left', 'center', 'right'] as const),
            letterSpacing: num(r.letterSpacing, -20, 100),
          })
          if (Object.keys(props).length === 0) drop('nothing to change')
          op = { op: name, clip: partRef(r.clip), ...props }
          break
        }
        case 'addTransition': {
          const kind = typeof r.kind === 'string' && isTransitionKind(r.kind) ? r.kind : drop(`unknown transition "${String(r.kind)}"`)
          op = clean({
            op: name,
            from: clipRef(r.from ?? r.clip, 'from'),
            to: present(r.to) ? clipRef(r.to, 'to') : undefined,
            kind,
            duration: num(r.duration, 0.1, 5),
            direction: oneOf(r.direction, DIRECTIONS),
          })
          break
        }
        case 'removeTransition': {
          const transition = str(r.transition, 80)
          const all = project.transitions ?? []
          if (transition) {
            if (!all.some((t) => t.id === transition)) drop(`no transition "${transition}"`)
            op = { op: name, transition }
            break
          }
          const rawFrom = present(r.from) && r.from !== '' ? r.from : r.clip
          if (!present(rawFrom) || rawFrom === '') drop('removeTransition needs a transition id, or the clips it joins as from and to')
          const from = clipRef(rawFrom, 'from')
          const to = present(r.to) && r.to !== '' ? clipRef(r.to, 'to') : undefined
          if (from.startsWith('$') || to?.startsWith('$')) drop('a clip made in this plan has no transition to remove yet')
          const label = (id: string) => `"${roots.get(id)?.name ?? id}"`
          const joined = all.filter((t) => t.fromClipId === from && (to === undefined || t.toClipId === to))
          if (joined.length === 0) drop(to === undefined ? `no transition leaves ${label(from)}` : `no transition between ${label(from)} and ${label(to)}`)
          op = clean({ op: name, from, to })
          break
        }
        case 'beatCuts': {
          const every = num(r.every, 1, 16)
          op = clean({
            op: name,
            clip: clipRef(r.clip),
            every: every !== undefined ? Math.round(every) : undefined,
            audio: present(r.audio) ? clipRef(r.audio, 'audio') : undefined,
          })
          break
        }
        case 'silenceFreeze':
          op = clean({
            op: name,
            clip: clipRef(r.clip),
            minDuration: num(r.minDuration, 0.1, 10),
            audio: present(r.audio) ? clipRef(r.audio, 'audio') : undefined,
          })
          break
        // --- Cuts and mix (CHAT-5a) ---------------------------------------
        case 'removeRanges': {
          // The ranges are checked against the clip's source window when the op runs (an earlier op in the same plan
          // may have changed the clip), so a range outside it is a readable skip there, not a drop here.
          const id = clipRef(r.clip)
          const target = roots.get(id)
          if (target && target.type !== 'video' && target.type !== 'audio') drop(`"${target.name}" is a ${target.type} clip; ranges can only be cut out of video or audio`)
          const ranges = secondsPairs(r.ranges, MAX_REMOVE_RANGES)
          if (ranges.length === 0) drop('removeRanges needs ranges: [{from, to}] in SOURCE seconds, each ending after it starts')
          op = clean({ op: name, clip: id, ranges, ripple: coerce(r.ripple) === false ? false : undefined })
          break
        }
        case 'crossfadeCuts': {
          const clips = Array.isArray(r.clips) && r.clips.length > 0 ? [...new Set(r.clips.slice(0, MAX_FADE_CLIPS).map((c) => clipRef(c)))] : undefined
          const track = present(r.track) && r.track !== '' ? trackRef(r.track).id : undefined
          if (clips && track) drop('crossfadeCuts takes clips or a track, not both')
          op = clean({ op: name, clips, track, ms: num(r.ms, 2, 200) })
          break
        }
        case 'duckUnder': {
          const music = clipRef(r.music, 'music')
          const voice = clipRef(r.voice, 'voice')
          if (music === voice) drop('the music and the voice must be different clips')
          for (const [id, role] of [[music, 'music'], [voice, 'voice']] as const) {
            const t = roots.get(id)
            if (t && t.type !== 'audio' && t.type !== 'video') drop(`${role} "${t.name}" is a ${t.type} clip, which has no sound`)
          }
          const segments = secondsPairs(r.segments, MAX_DUCK_SEGMENTS)
          op = clean({
            op: name,
            music,
            voice,
            amountDb: num(r.amountDb, -40, 0),
            attackSec: num(r.attackSec, 0.01, 2),
            releaseSec: num(r.releaseSec, 0.05, 5),
            segments: segments.length > 0 ? segments : undefined,
          })
          break
        }
        case 'addSfx': {
          const asset = reqStr(r.asset ?? r.assetId, 'asset', 120)
          const known = opts.assets?.get(asset)
          if (opts.assets) {
            if (!known) drop(`no media “${asset}” in the library`)
            else if (known.kind !== 'audio') drop(`“${known.name ?? asset}” is ${known.kind === 'image' ? 'an image' : 'a video'}, not audio: addSfx places library sound effects`)
          }
          op = clean({ op: name, ref: ref(r.ref), asset, at: at(r.at), volume: num(r.volume, 0, 1), duration: num(r.duration, DUR_MIN, 60) })
          break
        }
        case 'addEffect': {
          const kind = reqOneOf(r.kind, [...EFFECT_REGISTRY.keys()], 'effect')
          const def = EFFECT_REGISTRY.get(kind)!
          const preset = str(r.preset, 40)
          const kept: OpParams = {}
          for (const [k, v] of Object.entries(params(r.params) ?? {})) {
            const pd = def.params[k]
            if (pd) kept[k] = clampParam(pd, coerce(v))
          }
          op = clean({
            op: name,
            clip: clipRef(r.clip),
            kind,
            preset: preset && def.presets?.some((x) => x.id === preset) ? preset : undefined,
            params: Object.keys(kept).length ? kept : undefined,
          })
          break
        }
        case 'applyLook':
          op = { op: name, clip: clipRef(r.clip), look: reqOneOf(r.look ?? r.preset, EFFECT_BUNDLES.map((b) => b.id), 'look') }
          break
        case 'setEffectParam': {
          const effect = reqStr(r.effect ?? r.kind, 'effect', 60)
          const param = reqStr(r.param, 'param', 60)
          if (Array.isArray(r.keys) && !present(r.value)) {
            // AGN-P24: `keys` is sugar for setKeyframes on fx.<effectId>.<param>.
            // The model writes the effect KIND; resolve it to this clip's effect id
            // when exactly one effect matches (an id is taken as is).
            const target = partRef(r.clip)
            const clip = clipFor(target)
            if (!clip) return drop('keys need a clip that already exists; add the keys in a later plan')
            const fxs = clip.effects ?? []
            const byId = fxs.filter((e) => e.id === effect)
            const hits = byId.length ? byId : fxs.filter((e) => e.kind === effect)
            if (hits.length === 0) drop(`this clip has no "${effect}" effect (it has: ${fxs.map((e) => e.kind).join(', ') || 'none'})`)
            if (hits.length > 1) drop(`this clip has ${hits.length} "${effect}" effects (ids: ${hits.map((e) => e.id).join(', ')}); name one by id`)
            op = keyframeOp(`fx.${hits[0]!.id}.${param}`, target, r.keys)
            break
          }
          const value = coerce(r.value)
          if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') drop('value is missing')
          op = { op: name, clip: clipRef(r.clip), effect, param, value: value as number | string | boolean }
          break
        }
        case 'removeEffects':
          op = { op: name, clip: clipRef(r.clip) }
          break
        case 'removeEffect': {
          // The id comes from describeClipDetail. A kind is taken when the clip has exactly one of it (like setEffectParam).
          const effect = reqStr(r.effect ?? r.kind, 'effect', 60)
          const target = clipRef(r.clip)
          const clip = clipFor(target)
          if (clip) {
            const fxs = clip.effects ?? []
            const byId = fxs.filter((e) => e.id === effect)
            const hits = byId.length ? byId : fxs.filter((e) => e.kind === effect)
            if (hits.length === 0) drop(`this clip has no "${effect}" effect (it has: ${fxs.map((e) => `${e.kind} ${e.id}`).join(', ') || 'none'})`)
            if (hits.length > 1) drop(`this clip has ${hits.length} "${effect}" effects (ids: ${hits.map((e) => e.id).join(', ')}); name one by id`)
          }
          op = { op: name, clip: target, effect }
          break
        }
        case 'setBlend':
          op = { op: name, clip: clipRef(r.clip), blend: reqOneOf(r.blend ?? r.mode, BLEND_MODES as ReadonlyArray<BlendMode>, 'blend mode') }
          break
        case 'setMask':
          op = clean({
            op: name,
            clip: clipRef(r.clip),
            shape: reqOneOf(r.shape ?? r.kind, ['rect', 'ellipse', 'none'] as const, 'mask shape'),
            feather: num(r.feather, 0, 1),
            invert: bool(r.invert),
          })
          break
        case 'addAdjustment': {
          const look = oneOf(r.look, EFFECT_BUNDLES.map((b) => b.id))
          const effects = (Array.isArray(r.effects) ? r.effects : [])
            .filter(isObj)
            .map((e): { kind: string; preset?: string } | null => {
              const kind = oneOf(e.kind, [...EFFECT_REGISTRY.keys()])
              if (!kind) return null
              const preset = str(e.preset, 40)
              return clean({ kind, preset: preset && EFFECT_REGISTRY.get(kind)!.presets?.some((x) => x.id === preset) ? preset : undefined })
            })
            .filter((e): e is { kind: string; preset?: string } => e !== null)
          if (!look && effects.length === 0) drop('an adjustment needs a look or an effect')
          op = clean({ op: name, ref: ref(r.ref), at: at(r.at), duration: duration(r.duration), look, effects: effects.length ? effects : undefined })
          break
        }
        case 'addMarker':
          op = clean({ op: name, at: at(r.at), name: str(r.name ?? r.text, 60) })
          break
        case 'setMarker': {
          const marker = markerRef(r.marker)
          const remove = bool(coerce(r.remove)) === true
          const newName = str(r.name, 60)
          const moveTo = num(r.at, 0, TIME_MAX)
          const rawColor = typeof r.color === 'string' ? r.color.trim() : ''
          if (rawColor && !color(rawColor) && !MARKER_LABEL.test(rawColor)) drop('a marker colour is #rrggbb or label-1 to label-8')
          const tint = rawColor ? (color(rawColor) ?? rawColor) : undefined
          if (remove) {
            if (newName !== undefined || moveTo !== undefined || tint !== undefined) drop('remove deletes the marker; do not combine it with name, at or color')
            removedMarkers.add(marker.id)
            op = { op: name, marker: marker.id, remove: true }
            break
          }
          if (newName === undefined && moveTo === undefined && tint === undefined) drop('nothing to change: give name, at, color or remove')
          op = clean({ op: name, marker: marker.id, name: newName, at: moveTo, color: tint })
          break
        }
        case 'setInOut': {
          const inSec = num(r.inSec, 0, TIME_MAX)
          const outSec = num(r.outSec, 0, TIME_MAX)
          if (bool(coerce(r.clear)) === true) {
            if (inSec !== undefined || outSec !== undefined) drop('clear removes the range; do not combine it with inSec or outSec')
            op = { op: name, clear: true }
            break
          }
          if (inSec === undefined && outSec === undefined) drop('give inSec, outSec or clear')
          if (inSec !== undefined && outSec !== undefined && outSec <= inSec) drop('outSec must be after inSec')
          op = clean({ op: name, inSec, outSec })
          break
        }
        case 'linkClips':
        case 'unlinkClips': {
          const given = Array.isArray(r.clips) ? (r.clips as unknown[]) : drop(`${name} needs a clips array`)
          const clips = given.map((c) => clipRef(c, 'clip'))
          if (new Set(clips).size !== clips.length) drop(`${name} was given the same clip twice`)
          if (name === 'linkClips' && clips.length < 2) drop('linkClips needs at least two clips')
          if (name === 'unlinkClips' && clips.length < 1) drop('unlinkClips needs at least one clip')
          op = { op: name, clips }
          break
        }
        case 'renameClip':
          op = { op: name, clip: clipRef(r.clip), name: reqStr(r.name ?? r.title, 'name', 80) }
          break
        case 'setTrack': {
          const track = trackRef(r.track)
          const remove = bool(coerce(r.remove)) === true
          const newName = str(r.name, 60)
          const locked = bool(coerce(r.locked))
          const hidden = bool(coerce(r.hidden))
          const muted = bool(coerce(r.muted))
          const edits = newName !== undefined || locked !== undefined || hidden !== undefined || muted !== undefined
          if (remove) {
            if (edits) drop('remove deletes the track; do not combine it with name, locked, hidden or muted')
            if (track.protected) drop(`track "${track.name}" is protected and cannot be removed`)
            if ((project.clips[track.id] ?? []).length > 0) drop('track has clips')
            removedTracks.add(track.id)
            op = { op: name, track: track.id, remove: true }
            break
          }
          if (!edits) drop('nothing to change: give name, locked, hidden, muted or remove')
          op = clean({ op: name, track: track.id, name: newName, locked, hidden, muted })
          break
        }
        case 'addComposition': {
          const rawProps = Array.isArray(r.props) ? r.props : []
          const propDefs = rawProps
            .filter(isObj)
            .map(sanitizePropDef)
            .filter((p): p is PropDef => p !== null)
            .slice(0, 30)
          for (const p of propDefs) declaredProps.add(p.name)

          type CompBinding = { clip: string; path: string; prop: string; template?: string }
          const rawBindings = Array.isArray(r.bindings) ? r.bindings : []
          const bindings = rawBindings
            .filter(isObj)
            .map((b): CompBinding | null => {
              try {
                const raw = typeof b.clip === 'string' ? b.clip.trim() : ''
                const [first, ...rest] = raw.split('/')
                const clip = clipRef(first, 'clip to bind')
                if (rest.some((s) => !s) || rest.length > 4) return null
                const path = str(b.path, 120)
                if (!path || !parseFieldPath(path)) return null
                const prop = str(b.prop, 40)
                if (!prop || !declaredProps.has(prop)) return null
                return clean({ clip: [clip, ...rest].join('/'), path, prop, template: str(b.template, 200) })
              } catch (err) {
                if (err instanceof Drop) return null
                throw err
              }
            })
            .filter((b): b is CompBinding => b !== null)
            .slice(0, 60)

          if (propDefs.length === 0 && bindings.length === 0) drop('a composition needs props or bindings')
          op = clean({ op: name, props: propDefs, bindings: bindings.length ? bindings : undefined })
          break
        }
        case 'setProp': {
          const pname = reqStr(r.name, 'prop name', 40)
          if (!declaredProps.has(pname)) drop(`no prop "${pname}"`)
          // Deliberately not `str()`: that collapses whitespace, and a
          // multi-line text value must survive.
          const value = coerce(r.value)
          if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') drop('value is missing')
          op = { op: name, name: pname, value: value as number | string | boolean }
          break
        }
        case 'nest': {
          // At least two clips: a one-clip compound has no picture and the pure
          // function refuses it anyway, so dropping it here gives the plan a
          // readable reason instead of a later "skipped".
          const list = Array.isArray(r.clips) ? (r.clips as unknown[]) : drop('nest needs a clips array')
          const clips = list
            .map((c) => clipRef(c, 'clip to nest'))
            .filter((c): c is string => typeof c === 'string')
          if (clips.length < 2) drop('nest needs at least two clips')
          if (new Set(clips).size !== clips.length) drop('nest was given the same clip twice')
          op = clean({ op: name, clips, ref: ref(r.ref), name: str(r.name ?? r.title, 60) })
          break
        }
        case 'unnest':
          op = clean({ op: name, clip: clipRef(r.clip, 'compound') })
          break
        case 'setComponentField': {
          const field = reqOneOf(r.field, COMPONENT_FIELDS, 'component field')
          let value: string | number | string[]
          switch (field) {
            case 'text':
            case 'sub':
              value = reqStr(r.value ?? r.text, `${field} value`, MAX_COMPONENT_TEXT)
              break
            case 'variant':
              value = reqStr(r.value, 'variant', 40)
              break
            case 'energy':
              value = reqOneOf(typeof r.value === 'string' ? r.value.trim().toLowerCase() : r.value, MOTION_ENERGIES, 'energy')
              break
            case 'duration':
              value = reqNum(r.value, 0.1, 600, 'duration')
              break
            case 'emphasis': {
              // Strict mode cannot carry an array in the shared `value`, so words arrive comma-separated; an array is accepted too.
              const words = Array.isArray(r.value) ? r.value : typeof r.value === 'string' ? r.value.split(',') : drop('emphasis words are missing')
              value = words.map((w) => str(w, 40)).filter((w): w is string => !!w).slice(0, MAX_EMPHASIS_WORDS)
              break
            }
          }
          op = { op: name, clip: instanceRef(r.clip), field, value }
          break
        }
        case 'setComponentItems': {
          if (!Array.isArray(r.items) || r.items.length === 0) drop('items is empty')
          const items: ComponentItem[] = []
          for (const raw of r.items as unknown[]) {
            if (!isObj(raw)) continue
            const item = clean({
              text: str(raw.text, MAX_ITEM_TEXT),
              sub: str(raw.sub, MAX_ITEM_SUB),
              icon: str(raw.icon, 40),
              value: num(raw.value, -1e9, 1e9),
              style: str(raw.style, 20),
            }) as ComponentItem
            if (Object.keys(item).length > 0) items.push(item)
          }
          if (items.length === 0) drop('none of the items has any content')
          op = { op: name, clip: instanceRef(r.clip), items: items.slice(0, 24) }
          break
        }
        case 'regenerateElement':
          op = { op: name, clip: instanceRef(r.clip), brief: reqStr(r.brief ?? r.prompt ?? r.text, 'brief', 600) }
          break
        case 'removeBackground': {
          // Ref validation lives here (and again in `applyOps`, which skips a missing or non-video clip).
          const id = clipRef(r.clip)
          if (id.startsWith('$')) drop('removeBackground needs footage that is already on the timeline, not one created in this plan')
          const target = roots.get(id)
          if (target && target.type !== 'video') drop(`removeBackground needs a video clip; "${target.name}" is ${target.type === 'image' ? 'an image' : `a ${target.type} clip`}`)
          // `idempotencyKey` and `projectId` are NEVER read from `r`: model output is untrusted and the web layer
          // stamps both (the key from the file and range, the id from the open project). Anything else is ignored too,
          // because an op is built field by field.
          // `subject` is dropped too (the host application finds the person). A legacy 'roto' means 'matte'; anything
          // unknown falls back to 'matte'.
          const land = r.land === 'roto' ? 'matte' : (oneOf(r.land, ['matte', 'sandwich'] as const) ?? 'matte')
          op = { op: name, clip: id, land }
          break
        }
        case 'insertSourceRange': {
          const asset = reqStr(r.asset ?? r.assetId, 'asset', 120)
          const known = opts.assets?.get(asset)
          if (opts.assets) {
            if (!known) drop(`no media “${asset}” in the library`)
            else if (known.kind !== 'video' && known.kind !== 'audio') drop(`“${asset}” is ${known.kind === 'image' ? 'an image' : known.kind}, which has no range to cut`)
          }
          const start = num(r.start, -1e9, 1e9) ?? drop('start is missing or not a number')
          const end = num(r.end, -1e9, 1e9) ?? drop('end is missing or not a number')
          if (start < 0) drop('start is before the beginning of the clip')
          if (end <= start) drop('the range is empty or runs backwards')
          if (end - start > DUR_MAX) drop('the range is longer than 30 minutes')
          if (known && Number.isFinite(known.durationSec) && known.durationSec > 0 && end > known.durationSec + 0.05) {
            drop(`range ends after the clip ends (${Math.round(known.durationSec * 10) / 10}s long)`)
          }
          op = clean({
            op: name,
            ref: ref(r.ref),
            asset,
            start,
            end,
            at: num(r.at, 0, TIME_MAX),
            speed: num(r.speed, 0.25, 4),
            mute: bool(coerce(r.mute)) ? true : undefined,
            overlay: bool(coerce(r.overlay)) ? true : undefined,
          })
          break
        }
        case 'addCaptions': {
          // `words` is never read here: the planner does not choose the words or their timings (AGN-P19).
          const id = clipRef(r.clip)
          if (id.startsWith('$')) drop('captions need footage that is already on the timeline, not one created in this plan')
          const source = roots.get(id)
          if (source && source.type !== 'video' && source.type !== 'audio') {
            drop(`"${source.name}" is ${source.type === 'image' ? 'an image' : `a ${source.type} clip`}, which has no speech to caption`)
          }
          if (typeof r.captionLook === 'string' && r.captionLook && !findCaptionLook(r.captionLook)) {
            drop(`there is no caption look called "${r.captionLook}"`)
          }
          const capFrom = num(r.from, 0, TIME_MAX)
          const capTo = num(r.to, 0, TIME_MAX)
          if (capFrom !== undefined && capTo !== undefined && capTo <= capFrom) drop('the caption range ends before it starts')
          const capFps = project.fps && project.fps > 0 ? project.fps : undefined
          if (source && capFps) {
            const len = source.durationFrames / capFps
            if (capFrom !== undefined && capFrom >= len) drop(`the caption range starts after the clip ends (${Math.round(len * 10) / 10}s long)`)
          }
          const rawStyle = r.style ?? r.mode
          const capStyle = present(rawStyle) && rawStyle !== '' ? reqOneOf(rawStyle, CAPTION_MODES, 'caption style') : undefined
          const rawPos = typeof r.position === 'string' ? r.position.trim().toLowerCase().replace('centre', 'center') : r.position
          const capPos = present(rawPos) && rawPos !== '' ? reqOneOf(rawPos, ['bottom', 'center', 'top'] as const, 'caption position') : undefined
          op = clean({ op: name, clip: id, style: capStyle, position: capPos, from: capFrom, to: capTo })
          break
        }
        case 'insertStock': {
          const stockDuration = reqNum(r.duration, -1e9, 1e9, 'duration')
          if (stockDuration < STOCK_DUR_MIN || stockDuration > STOCK_DUR_MAX) drop(`duration must be ${STOCK_DUR_MIN}-${STOCK_DUR_MAX} seconds`)
          const stockKind = present(r.kind) && r.kind !== '' ? reqOneOf(r.kind, ['video', 'photo'] as const, 'stock kind') : 'video'
          op = clean({
            op: name,
            ref: ref(r.ref),
            query: reqStr(r.query ?? r.text ?? r.prompt, 'query', 120),
            at: num(r.at, 0, TIME_MAX),
            duration: stockDuration,
            kind: stockKind,
            // Both default true at the resolver; only an explicit false is carried.
            overlay: coerce(r.overlay) === false ? false : undefined,
            mute: coerce(r.mute) === false ? false : undefined,
          })
          break
        }
        case 'addImage': {
          const asset = reqStr(r.asset ?? r.assetId, 'asset', 120)
          const known = opts.assets?.get(asset)
          if (opts.assets) {
            if (!known) drop(`no media “${asset}” in the library`)
            else if (known.kind !== 'image') drop(`“${known.name ?? asset}” is ${known.kind === 'video' ? 'a video' : 'audio'}, not an image: use insertSourceRange for footage`)
            else if (known.animated === true) drop(`“${known.name ?? asset}” is an animated image; place it from the Media panel`)
          }
          const rawImgDur = present(r.duration) && r.duration !== '' ? Number(r.duration) : undefined
          if (rawImgDur !== undefined && !(rawImgDur > 0)) drop('duration must be more than zero seconds')
          const imgDur = rawImgDur === undefined ? undefined : reqNum(rawImgDur, DUR_MIN, DUR_MAX, 'duration')
          op = clean({
            op: name,
            ref: ref(r.ref),
            asset,
            at: num(r.at, 0, TIME_MAX),
            duration: imgDur,
            overlay: bool(coerce(r.overlay)) ? true : undefined,
            under: underRef(r.under),
          })
          break
        }
        case 'insertVector': {
          // `clip` is never read here: only the client resolver, from the SVG itself, may supply the shapes.
          // MI-P9: a library `asset` OR a `query` (find an open-source icon); one of the two is required. An
          // `asset` wins when both are given, and then the query is not carried.
          const asset = str(r.asset ?? r.assetId, 120)
          const query = asset === undefined ? str(r.query ?? r.text, 64) : undefined
          if (asset === undefined && query === undefined) drop('insertVector needs an asset from the library or a query')
          if (asset !== undefined) {
            const known = opts.assets?.get(asset)
            if (opts.assets) {
              if (!known) drop(`no media “${asset}” in the library`)
              else if (!isVectorAsset(known)) {
                drop(`“${known.name ?? asset}” is not an SVG, so it cannot become vector shapes${known.kind === 'image' ? ': use addImage' : ''}`)
              }
            }
          }
          op = clean({ op: name, ref: ref(r.ref), asset, query, at: num(r.at, 0, TIME_MAX) })
          break
        }
        case 'generateMedia':
          op = clean({
            op: name,
            ref: ref(r.ref),
            media: reqOneOf(r.media ?? r.kind, ['image', 'video'] as const, 'media type'),
            prompt: reqStr(r.prompt ?? r.text, 'prompt', 600),
            at: at(r.at),
            duration: duration(r.duration),
          })
          break
        default:
          op = drop(`unsupported op "${String(name)}"`)
      }
      const made = 'ref' in op && typeof op.ref === 'string' ? op.ref : undefined
      if (made) {
        prospects.delete(made)
        vectorRefs.delete(made)
        if (op.op === 'addShape') prospects.set(made, { type: 'shape', shapeKind: op.kind })
        else if (op.op === 'addText') prospects.set(made, { type: 'text' })
        else if (op.op === 'addImage') prospects.set(made, { type: 'image' })
        else if (op.op === 'insertVector') vectorRefs.add(made)
      }
      out.push(op)
      outIndex.push(index)
    } catch (err) {
      if (err instanceof Drop) dropped.push({ index, reason: err.message })
      else dropped.push({ index, reason: 'could not read this step' })
    }
  })
  return coverStaggered(out, outIndex, dropped)
}

/**
 * A plan-level pass: the planner sometimes writes a per-clip `applyMotionPreset` AND a `staggerPreset` of the
 * same preset over the same clips. Both would apply, and the un-offset preset's keys would survive next to the
 * staggered ones. The stagger already carries the preset, so each such `applyMotionPreset` is dropped, whichever
 * side of the stagger it was written on. Clips are compared as sanitized (a resolved id or a `$ref`), so an op
 * whose clip cannot be shown to be one of the stagger's clips is kept. Never throws.
 */
function coverStaggered(out: EditorOp[], outIndex: number[], dropped: SanitizeResult['dropped']): SanitizeResult {
  const staggered = new Map<string, Set<string>>()
  for (const op of out) {
    if (op.op !== 'staggerPreset') continue
    const clips = staggered.get(op.preset) ?? new Set<string>()
    for (const c of op.clips) clips.add(c)
    staggered.set(op.preset, clips)
  }
  if (staggered.size === 0) return { ops: out, dropped }
  const ops: EditorOp[] = []
  const all = [...dropped]
  out.forEach((op, i) => {
    if (op.op === 'applyMotionPreset' && staggered.get(op.preset)?.has(op.clip)) {
      all.push({ index: outIndex[i]!, reason: 'covered by staggerPreset on the same clips' })
    } else {
      ops.push(op)
    }
  })
  all.sort((a, b) => a.index - b.index)
  return { ops, dropped: all }
}
