/**
 * Component instances: re-expand one component and merge the result into the
 * compound it made, keeping what the user edited (EG-P2).
 *
 *   instance (Clip.component) ──expandInstance──▶ child Project
 *   reconcileCompound(current, baseline, next)  ──▶ merged child Project + report
 *
 * ---------------------------------------------------------------------------
 * What was measured before this was designed (the plan's determinism risk)
 * ---------------------------------------------------------------------------
 * The nested project stored in a compound is the output of WHOLE-PIECE polish.
 * Of its passes, camera push, hand-offs and the ambient layer only touch
 * TOP-LEVEL elements, which are discarded here (we keep only the nested
 * project of the one group). What reaches the nested project is `polishLevel`
 * (stagger, arrivals/exits, idle), and its inputs are the group's children, the
 * piece's design, format and MOTION STYLE, and the seed.
 *
 * Measured for all 17 components, sequential and all-at-zero, piece energy
 * calm and bold crossed with component energy unset/bold/calm: a one-component
 * `expandComponents` + `polishSpec` + `compileVideoSpec` run reproduces the
 * stored nested project exactly, modulo generated ids (clip, track, keyframe
 * and effect ids), PROVIDED the polish pass is given the PIECE's style. The
 * instance record stores the component's resolved style, which differs from the
 * piece's when the component overrode its energy, so `InstanceContext.pieceStyle`
 * carries it (`Project.authored.spec.motion`, resolved). Without it the
 * baseline falls back to the instance style: it then differs from the stored
 * project only in stagger start frames of an energy-overridden component, and a
 * field that differs from the baseline reads as user-edited and is KEPT, which
 * is the safe direction (never loses an edit; may leave a stale value).
 *
 * So the baseline definition is: `expandInstance` runs `expandComponents` ->
 * `polishSpec` -> `compileVideoSpec` on a one-element spec with the stored
 * seed, style and design, and takes the group's nested project. No change to
 * `polishSpec` was needed.
 *
 * ---------------------------------------------------------------------------
 * The merge
 * ---------------------------------------------------------------------------
 * 3-way, per part (matched by `partId`), per field, where the three sides are
 * `current` (what the user has now), `baseline` (the expansion of the stored
 * input: what the user started from) and `next` (the expansion of the new
 * input). A field the user did not touch (`current == baseline`) takes
 * `next`; a field the user edited stays. Nothing is stored on the clip to make
 * this work: the baseline is recomputed.
 *
 * Fields: every own property of the clip except `id`, `trackId`, `partId`;
 * `transform` counts one field per member; `keyframes` one field per channel.
 * Equality is structural, key-order-insensitive, and ignores every `id` key
 * (keyframe and effect ids are generated and differ between runs).
 *
 * Clip ids referenced from a clip (`layout.anchorTo.clip`, `layout.fitTo.clip`,
 * `clip("...")` in an expression) are rewritten into the CURRENT id space
 * before any comparison, so a reference field neither looks edited nor
 * dangles after a merge.
 *
 * Track placement. A part's lane is its track's `order`. If the user did not
 * move the part to another lane (current order == baseline order) it goes to
 * the lane `next` puts it on; a lane that does not exist in `current` is
 * created from `next`'s track (its id kept unless it collides, then suffixed
 * `-r<n>`), inserted before the first track with a greater order. A track that
 * held parts and is empty afterwards is removed; a track that was already
 * empty is never touched.
 *
 * Parts:
 *   in all three            merged, keeps the CURRENT clip's id
 *   in next only            added (a part the user deleted from `current` while
 *                           it was in `baseline` stays deleted)
 *   in baseline+current,
 *     not in next           removed, edited or not, and listed in the report
 *   no `partId` in current  a user-added clip: never touched
 *   in current only         left alone (its owner is unknown)
 *   duplicate `partId` in   the first (track order, then clip order) is the
 *     current               match; the copies are user clips and never touched
 */

import { ICON_NAMES } from '../icons'
import type { Clip, ClipComponentInstance, Project, Track } from '../types'
import { COMPONENT_REGISTRY, expandComponents } from './components'
import {
  MOTION_ENERGIES,
  type ComponentDef,
  type ComponentFieldSpec,
  type ComponentName,
  type MotionStyle,
  type SpecComponent,
} from './components/types'
import { compileVideoSpec } from './compile'
import { polishSpec } from './polish'
import type { AuthoredSpec } from './components/types'
import type { SpecDesign, SpecFormat, SpecIssue } from './types'

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Stable JSON: object keys sorted, `undefined` members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** A deep copy without any `id` key (generated ids differ between runs). */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id') continue
      out[k] = withoutIds(v)
    }
    return out
  }
  return value
}

/** Structural equality that ignores key order and every `id`. */
function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(withoutIds(a)) === canonicalJson(withoutIds(b))
}

// ---------------------------------------------------------------------------
// componentFields: the Inspector schema
// ---------------------------------------------------------------------------

const ITEM_STYLES = ['accent', 'filled', 'outline', 'highlight', 'muted', 'serif'] as const

/**
 * The editable fields of a component, derived from its definition: the
 * fields every component shares (`text`, `sub`, `emphasis`, `energy`), plus
 * `variant` when it offers variants, `items` when it takes items, and
 * `duration` read-only. A def's own `fields` wins.
 */
export function componentFields(def: ComponentDef): ComponentFieldSpec[] {
  if (def.fields) return [...def.fields]
  const fields: ComponentFieldSpec[] = [
    { key: 'text', label: 'Text', kind: 'text' },
    { key: 'sub', label: 'Subtext', kind: 'text' },
    { key: 'emphasis', label: 'Emphasis words', kind: 'strings', hint: 'Words inside the text to set in the emphasis style' },
  ]
  if (def.variants && def.variants.length > 0) {
    fields.push({ key: 'variant', label: 'Variant', kind: 'select', options: [...def.variants] })
  }
  if (def.items) {
    fields.push({
      key: 'items',
      label: 'Items',
      kind: 'list',
      hint: def.items.hint,
      min: def.items.min,
      max: def.items.max,
      itemFields: [
        { key: 'text', label: 'Text', kind: 'text' },
        { key: 'sub', label: 'Subtext', kind: 'text' },
        { key: 'icon', label: 'Icon', kind: 'select', options: ICON_NAMES },
        { key: 'value', label: 'Value', kind: 'number' },
        { key: 'style', label: 'Style', kind: 'select', options: ITEM_STYLES },
      ],
    })
  }
  fields.push({ key: 'energy', label: 'Energy', kind: 'select', options: [...MOTION_ENERGIES] })
  fields.push({
    key: 'duration',
    label: 'Duration (s)',
    kind: 'number',
    min: def.duration.min,
    max: def.duration.max,
    defaultValue: def.duration.default,
    readOnly: true,
    hint: 'Set the clip length on the timeline',
  })
  return fields
}

// ---------------------------------------------------------------------------
// expandInstance
// ---------------------------------------------------------------------------

/** Piece-level facts the instance record does not carry. */
export interface InstanceContext {
  /** The stage and frame rate the component was laid on (the nested project's own `stage` and `fps`). */
  format: SpecFormat
  /**
   * The PIECE's motion style (`Project.authored.spec.motion`, resolved). Polish
   * runs with this, not with the component's own style. Absent = the
   * instance's style.
   */
  pieceStyle?: MotionStyle
  /** The piece's duration, which decides whether polish treats a part as spanning the whole piece. Absent = assume it does not. */
  pieceDuration?: number
}

export type InstanceExpansion =
  | { ok: true; child: Project; component: ClipComponentInstance; issues: SpecIssue[] }
  | { ok: false; reason: 'unknown-component' | 'expansion-failed'; issues: SpecIssue[] }

/**
 * Expand ONE component from its instance record, with `overrides` merged into
 * the stored input, and return the nested project the compound would hold.
 * Pure: no engine, no clock, no randomness beyond the stored seed. The same
 * arguments always give a `canonicalJson`-identical result, ids included.
 */
export function expandInstance(
  instance: ClipComponentInstance,
  ctx: InstanceContext,
  overrides: Partial<SpecComponent> = {},
): InstanceExpansion {
  const def = COMPONENT_REGISTRY.get(instance.name as ComponentName)
  if (!def) {
    return {
      ok: false,
      reason: 'unknown-component',
      issues: [{ severity: 'error', path: 'component', code: 'unknown-component', message: `unknown component "${instance.name}"` }],
    }
  }
  const input = { ...(instance.input as unknown as SpecComponent), ...overrides } as SpecComponent
  const style = ctx.pieceStyle ?? (instance.style as MotionStyle)
  const design = instance.design as SpecDesign | undefined
  const spec: AuthoredSpec = {
    format: ctx.format,
    duration: ctx.pieceDuration ?? Number.MAX_SAFE_INTEGER,
    ...(design ? { design } : {}),
    motion: style,
    elements: [input],
  }
  const expanded = expandComponents(spec, { seed: instance.seed })
  const polished = polishSpec(expanded.spec, expanded.style, { seed: instance.seed })
  const compiled = compileVideoSpec(polished.spec, { seed: instance.seed, componentInstances: expanded.componentInstances })
  const issues = [...expanded.issues, ...polished.issues, ...compiled.issues]
  const group = Object.values(compiled.project.clips)
    .flat()
    .find((c) => c.partId === input.id && c.component)
  if (!group?.compound || !group.component || issues.some((i) => i.severity === 'error' && i.code !== 'unknown-token')) {
    return { ok: false, reason: 'expansion-failed', issues }
  }
  return { ok: true, child: group.compound.project, component: group.component, issues }
}

// ---------------------------------------------------------------------------
// reconcileCompound
// ---------------------------------------------------------------------------

export interface ReconcileReport {
  /** Parts with at least one hand-edited field that was preserved, and which fields. */
  kept: Array<{ partId: string; fields: string[] }>
  /** Parts that exist only in the new expansion and were added. */
  added: string[]
  /** Parts the new expansion no longer has, removed whether or not they were edited. */
  removed: Array<{ partId: string; edited: boolean }>
  /** Parts where at least one field took the new expansion's value. */
  reflowed: string[]
  /** Parts the user deleted by hand that the new expansion still has; they stay deleted. */
  leftDeleted: string[]
}

export interface ReconcileResult {
  project: Project
  report: ReconcileReport
}

interface PartEntry {
  clip: Clip
  trackId: string
  order: number | undefined
}

function indexParts(project: Project): { parts: Map<string, PartEntry>; ordered: string[] } {
  const parts = new Map<string, PartEntry>()
  const ordered: string[] = []
  const orderOfTrack = new Map(project.tracks.map((t) => [t.id, t.order] as const))
  for (const track of project.tracks) {
    for (const clip of project.clips[track.id] ?? []) {
      const pid = clip.partId
      if (!pid || parts.has(pid)) continue
      parts.set(pid, { clip, trackId: track.id, order: orderOfTrack.get(track.id) })
      ordered.push(pid)
    }
  }
  return { parts, ordered }
}

const CLIP_REF_RE = /\bclip\(\s*(["'])((?:(?!\1)[^\n\r])*)\1\s*\)/g

/** A copy of `clip` with every clip id it references rewritten through `map`. */
function remapRefs(clip: Clip, map: ReadonlyMap<string, string>): Clip {
  const walk = (value: unknown, parentKey: string): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v, parentKey))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === 'clip' && typeof v === 'string' && (parentKey === 'anchorTo' || parentKey === 'fitTo')) out[k] = map.get(v) ?? v
        else if (k === 'source' && typeof v === 'string' && (value as Record<string, unknown>).kind === 'expression') {
          out[k] = v.replace(CLIP_REF_RE, (whole, q: string, id: string) => (map.has(id) ? `clip(${q}${map.get(id)}${q})` : whole))
        } else out[k] = walk(v, k)
      }
      return out
    }
    return value
  }
  return walk(clip, '') as Clip
}

const SKIP_FIELDS = new Set(['id', 'trackId', 'partId'])

/** Every field of a clip as `path -> value`. */
function fieldsOf(clip: Clip): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(clip as unknown as Record<string, unknown>)) {
    if (SKIP_FIELDS.has(k) || v === undefined) continue
    if (k === 'transform' && v && typeof v === 'object') {
      for (const [tk, tv] of Object.entries(v as Record<string, unknown>)) if (tv !== undefined) out.set(`transform.${tk}`, tv)
    } else if (k === 'keyframes' && v && typeof v === 'object') {
      for (const [kk, kv] of Object.entries(v as Record<string, unknown>)) {
        if (kk === 'channels' && kv && typeof kv === 'object') {
          for (const [ch, cv] of Object.entries(kv as Record<string, unknown>)) if (cv !== undefined) out.set(`keyframes.channels.${ch}`, cv)
        } else if (kv !== undefined) out.set(`keyframes.${kk}`, kv)
      }
    } else out.set(k, v)
  }
  return out
}

function setField(clip: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.')
  if (segs.length === 1) {
    if (value === undefined) delete clip[path]
    else clip[path] = value
    return
  }
  // `transform.<k>` or `keyframes.<k>` or `keyframes.channels.<ch>`
  const root = segs[0]!
  const holder = (clip[root] && typeof clip[root] === 'object' ? { ...(clip[root] as Record<string, unknown>) } : {}) as Record<string, unknown>
  if (segs.length === 2) {
    if (value === undefined) delete holder[segs[1]!]
    else holder[segs[1]!] = value
  } else {
    const channels = (holder.channels && typeof holder.channels === 'object' ? { ...(holder.channels as Record<string, unknown>) } : {}) as Record<string, unknown>
    if (value === undefined) delete channels[segs[2]!]
    else channels[segs[2]!] = value
    holder.channels = channels
  }
  if (root === 'keyframes') {
    const ch = holder.channels as Record<string, unknown> | undefined
    if (ch && Object.keys(ch).length === 0 && Object.keys(holder).length === 1) {
      delete clip[root]
      return
    }
  }
  clip[root] = holder
}

interface PartMerge {
  clip: Clip
  keptFields: string[]
  changedFields: string[]
}

function mergePart(current: Clip, baseline: Clip | undefined, next: Clip): PartMerge {
  if (!baseline) {
    // No record of what this part started as: every field might be the user's.
    return { clip: current, keptFields: [...fieldsOf(current).keys()], changedFields: [] }
  }
  const cur = fieldsOf(current)
  const base = fieldsOf(baseline)
  const nxt = fieldsOf(next)
  const paths = [...new Set([...cur.keys(), ...base.keys(), ...nxt.keys()])]
  let result = current as unknown as Record<string, unknown>
  let copied = false
  const keptFields: string[] = []
  const changedFields: string[] = []
  for (const p of paths) {
    const c = cur.get(p)
    const b = base.get(p)
    const n = nxt.get(p)
    if (!sameValue(c, b)) {
      keptFields.push(p)
      continue
    }
    if (sameValue(c, n)) continue // nothing to change; keeps the current value and its ids
    if (!copied) {
      result = { ...result }
      copied = true
    }
    setField(result, p, n)
    changedFields.push(p)
  }
  return { clip: result as unknown as Clip, keptFields, changedFields }
}

/**
 * 3-way merge of child projects. See the file comment for the rules.
 * Pure: no input is mutated.
 */
export function reconcileCompound(current: Project, baseline: Project, next: Project): ReconcileResult {
  const cur = indexParts(current)
  const base = indexParts(baseline)
  const nxt = indexParts(next)
  const report: ReconcileReport = { kept: [], added: [], removed: [], reflowed: [], leftDeleted: [] }

  // Every id in play in the merged project, so an added clip or track never collides.
  const taken = new Set<string>([
    ...current.tracks.map((t) => t.id),
    ...Object.values(current.clips).flat().map((c) => c.id),
  ])
  const unique = (id: string, suffix: string): string => {
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
    let n = 1
    while (taken.has(`${id}-${suffix}${n}`)) n++
    const out = `${id}-${suffix}${n}`
    taken.add(out)
    return out
  }

  // Clip-id maps into the current id space.
  const baseMap = new Map<string, string>()
  for (const [pid, b] of base.parts) {
    const c = cur.parts.get(pid)
    if (c) baseMap.set(b.clip.id, c.clip.id)
  }
  const nextMap = new Map<string, string>()
  for (const pid of nxt.ordered) {
    const n = nxt.parts.get(pid)!
    const c = cur.parts.get(pid)
    if (c) nextMap.set(n.clip.id, c.clip.id)
    else if (!base.parts.has(pid)) nextMap.set(n.clip.id, unique(n.clip.id, 'r'))
  }

  // Tracks and clip lists, copied so nothing in `current` is mutated.
  let tracks: Track[] = [...current.tracks]
  const lists = new Map<string, Clip[]>()
  const modified = new Set<string>()
  /** Clips this merge put on a lane (moved or added): the only ones it may relocate again. */
  const placed = new Set<string>()
  const hadClips = new Set<string>()
  for (const t of tracks) {
    const list = [...(current.clips[t.id] ?? [])]
    lists.set(t.id, list)
    if (list.length > 0) hadClips.add(t.id)
  }

  const trackForOrder = (order: number | undefined, source: Track | undefined): string | undefined => {
    const hit = tracks.find((t) => t.order === order)
    if (hit) return hit.id
    if (!source) return undefined
    const created: Track = { ...source, id: unique(source.id, 'r') }
    const at = tracks.findIndex((t) => t.order > created.order)
    tracks = at === -1 ? [...tracks, created] : [...tracks.slice(0, at), created, ...tracks.slice(at)]
    lists.set(created.id, [])
    return created.id
  }
  const nextTrack = (trackId: string): Track | undefined => next.tracks.find((t) => t.id === trackId)

  const replaceInList = (trackId: string, oldId: string, replacement: Clip | null) => {
    const list = lists.get(trackId)!
    const i = list.findIndex((c) => c.id === oldId)
    if (i === -1) return
    if (replacement) list[i] = replacement
    else list.splice(i, 1)
    modified.add(trackId)
  }

  // --- merged and removed parts, in current order --------------------------
  for (const pid of cur.ordered) {
    const c = cur.parts.get(pid)!
    const b = base.parts.get(pid)
    const n = nxt.parts.get(pid)
    if (!b && !n) continue // owner unknown: leave it alone
    if (b && !n) {
      const merged = mergePart(c.clip, remapRefs(b.clip, baseMap), c.clip)
      report.removed.push({ partId: pid, edited: merged.keptFields.length > 0 })
      replaceInList(c.trackId, c.clip.id, null)
      continue
    }
    const nextClip = remapRefs(n!.clip, nextMap)
    const baseClip = b ? remapRefs(b.clip, baseMap) : undefined
    const merged = mergePart(c.clip, baseClip, nextClip)
    if (merged.keptFields.length > 0) report.kept.push({ partId: pid, fields: merged.keptFields })
    if (merged.changedFields.length > 0) report.reflowed.push(pid)

    // Lane: follows `next` unless the user moved the part to another lane.
    const userMovedLane = !b || b.order !== c.order
    let targetTrack = c.trackId
    if (!userMovedLane && n!.order !== c.order) {
      targetTrack = trackForOrder(n!.order, nextTrack(n!.trackId)) ?? c.trackId
      if (targetTrack !== c.trackId && !report.reflowed.includes(pid)) report.reflowed.push(pid)
    }
    let placedClip = merged.clip
    if (targetTrack !== c.trackId) placedClip = { ...placedClip, trackId: targetTrack }
    if (merged.changedFields.length > 0) placed.add(placedClip.id)
    if (placedClip !== c.clip && targetTrack === c.trackId) replaceInList(c.trackId, c.clip.id, placedClip)
    else if (targetTrack !== c.trackId) {
      replaceInList(c.trackId, c.clip.id, null)
      lists.get(targetTrack)!.push(placedClip)
      placed.add(placedClip.id)
      modified.add(targetTrack)
    }
  }

  // --- added parts, in next order ------------------------------------------
  for (const pid of nxt.ordered) {
    if (cur.parts.has(pid)) continue
    if (base.parts.has(pid)) {
      report.leftDeleted.push(pid)
      continue
    }
    const n = nxt.parts.get(pid)!
    const trackId = trackForOrder(n.order, nextTrack(n.trackId))
    if (!trackId) continue
    const clip = { ...remapRefs(n.clip, nextMap), id: nextMap.get(n.clip.id)!, trackId }
    lists.get(trackId)!.push(clip)
    placed.add(clip.id)
    modified.add(trackId)
    report.added.push(pid)
  }

  // --- overlaps -----------------------------------------------------------------
  // `next` was packed without overlaps, but a kept (hand-edited) part can still
  // collide with a part this merge placed on its lane. A clip this merge placed
  // moves to the first lane that has room, or to a new front lane; nothing the
  // user placed is ever moved.
  const clash = (list: ReadonlyArray<Clip>, c: Clip) =>
    list.some((o) => o.id !== c.id && o.startFrame < c.startFrame + c.durationFrames && c.startFrame < o.startFrame + o.durationFrames)
  for (const id of placed) {
    const home = tracks.find((t) => lists.get(t.id)!.some((c) => c.id === id))
    if (!home) continue
    const clipHere = lists.get(home.id)!.find((c) => c.id === id)!
    if (!clash(lists.get(home.id)!, clipHere)) continue
    lists.set(home.id, lists.get(home.id)!.filter((c) => c.id !== id))
    modified.add(home.id)
    let target = tracks.find((t) => t.order > home.order && !clash(lists.get(t.id)!, clipHere))
    if (!target) {
      const top = tracks.reduce((m, t) => Math.max(m, t.order), 0)
      target = { ...home, id: unique(home.id, 'r'), order: top + 1, name: `Layer ${top + 1}` }
      tracks = [...tracks, target]
      lists.set(target.id, [])
    }
    lists.get(target.id)!.push({ ...clipHere, trackId: target.id })
    modified.add(target.id)
    const pid = clipHere.partId
    if (pid && !report.reflowed.includes(pid)) report.reflowed.push(pid)
  }

  // --- assemble ---------------------------------------------------------------
  const clips: Record<string, Clip[]> = {}
  const keptTracks: Track[] = []
  for (const t of tracks) {
    let list = lists.get(t.id)!
    if (list.length === 0 && hadClips.has(t.id)) continue // emptied by this merge
    if (modified.has(t.id)) list = [...list].sort((a, b) => a.startFrame - b.startFrame)
    keptTracks.push(t)
    clips[t.id] = list
  }
  const project: Project = { ...current, tracks: keptTracks, clips }
  return { project, report }
}
