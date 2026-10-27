/**
 * `applyOps` (EDX-P11): run a sanitized plan against the engine as ONE batch
 * — one undo step, named by the plan — and report exactly what happened.
 *
 * Each op runs in its own try: a step that cannot apply (a clip that would
 * overlap, a trim past the media) is SKIPPED with a reason instead of
 * throwing, because a throw inside `engine.batch` would roll the whole plan
 * back. Positions are pre-checked with `findOverlaps` where the engine would
 * otherwise throw.
 *
 * Graphics land on a free elements lane (never the Adjustment lane), top of
 * the stack first, creating a "Graphics" lane when none has room — the same
 * rule the Graphics tab uses, so a click and the assistant agree.
 *
 * `generateMedia` never runs here: it places a placeholder clip and is
 * returned in `deferred`, so the web layer can start the paid job only after
 * the user keeps the plan.
 */

import type { Clip, Transform } from '../types'
import type { MediaAsset } from '../assets/types'
import type { SpecComponent } from '../spec/components/types'
import type { TimelineEngine } from '../editor/TimelineEngine'
import { commitComposition, commitPropValues } from '../composition/commit'
import type { BaselineContext } from '../elements/keyframes'
import { setChannelExpression } from '../elements/keyframes'
import { keyPatch } from './keyPatch'
import type { AnyKeyframeChannel } from '../types'
import { staggerOffsets } from '../elements/stagger'
import { applyMotionPreset, MOTION_PRESETS, presetAppliesTo, staggerPresetPatches, type MotionPresetName } from '../elements/motionPresets'
import { applySpeedPreset, type SpeedPresetName } from '../elements/speedPresets'
import { applyBeatPreset, isBeatPreset, type BeatPresetName } from '../elements/beatPresets'
import { beatCutFrames, silenceFreezePatch, MAX_FREEZES } from '../elements/beatEdits'
import {
  clipSourceWindowSec,
  planCaptionRemoval,
  planMemberCuts,
  planSourceRanges,
  segmentIndex,
  sourceRangesToLocalFrames,
} from '../elements/rangeEdits'
import {
  CROSSFADE_DEFAULT_MS,
  DUCK_DEFAULT_ATTACK_SEC,
  DUCK_DEFAULT_DB,
  DUCK_DEFAULT_RELEASE_SEC,
  hasVolumeExpression,
  isAudioBearing,
  planCrossfades,
  planDuck,
} from '../elements/audioMix'
import { localBeatsInClip, defaultAudioSourceFor, clipSilenceRanges } from '../audio/markers'
import { hasTimeRemap } from '../resolver/sourceTime'
import { applyTextTemplate, findTextTemplate } from '../elements/textTemplates'
import { TEXT_ANIMATOR_PRESETS, captionClipsFromTranscript, captionLookPatch, estimateWordTimings, findCaptionLook } from '../elements/captions'
import { applyDrawOn } from '../elements/drawOn'
import { fitPlan, isFitBackdrop } from '../renderer/gpu/layers/fitCrop'
import { clampEffectParams, createEffect } from '../effects/registry'
import { bundleEffects } from '../effects/bundles'
import { createGenerator, getGeneratorDefinition } from '../generators/registry'
import { DEFAULT_SHAPE_TRANSFORM, DEFAULT_TEXT_TRANSFORM } from '../resolver/textAnimation'
import { findOverlaps } from '../utils/frames'
import { isMagneticMain, moveForMode, removeForMode, trimForMode } from '../actions/placement'
import { parseClipPath } from '../composition/paths'
import { getFont, fontWeights } from '../fonts/registry'
import { locateClip, patchClipAtPath } from './nested'
import { planInstanceUpdate } from './componentEdit'
import type { ApplyResult, EditorOp, KeyOp, Region } from './types'
import { IMAGE_DEFAULT_SECONDS } from './imageDefaults'

export interface ApplyContext {
  /** Playhead, frames. Ops may omit `at` only where a default makes sense. */
  playheadFrame?: number
  /** Tracks whose text clips are captions (`setCaptionStyle`); default: every text clip with words. */
  captionTrackIds?: ReadonlyArray<string>
  /** Undo label. Default: "Assistant edit". */
  description?: string
  /** The library, for `insertSourceRange`: an asset id not in here is skipped. */
  assets?: ReadonlyMap<string, Pick<MediaAsset, 'id' | 'src' | 'name' | 'durationSec' | 'kind' | 'media' | 'hasAudio' | 'width' | 'height'> & Partial<Pick<MediaAsset, 'animated'>>>
  /**
   * Text appended to a `generateMedia` placeholder's name (AGN-P5), so the web layer can tell a placeholder it
   * made from one a user renamed. Absent = the name is exactly what it always was.
   */
  placeholderTag?: (op: Extract<EditorOp, { op: 'generateMedia' }>) => string
}

/** Lanes a graphic never lands on. */
const RESERVED_LANES = new Set(['Adjustment'])
export const ASSISTANT_GRAPHICS_TRACK = 'Graphics'
export const ASSISTANT_MEDIA_TRACK = 'Generated'
/** The lane an insertVector lands on: the name the Media panel's SVG drop uses. */
const VECTOR_TRACK = 'Vector'
/** The lane an insertScene lands on (MC-2a). */
const SCENE_TRACK = 'Scenes'

const REGION_XY: Record<Region, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0.15],
  bottom: [0.5, 0.86],
  'lower-third': [0.5, 0.8],
  'upper-third': [0.5, 0.25],
  left: [0.22, 0.5],
  right: [0.78, 0.5],
  'top-left': [0.22, 0.15],
  'top-right': [0.78, 0.15],
  'bottom-left': [0.22, 0.85],
  'bottom-right': [0.78, 0.85],
}

class Skip extends Error {}
const skip = (reason: string): never => {
  throw new Skip(reason)
}

function overlaps(list: ReadonlyArray<Clip>, start: number, dur: number): boolean {
  return list.some((c) => start < c.startFrame + c.durationFrames && c.startFrame < start + dur)
}

/**
 * Free lane of `kind` over the range, top of the stack first; creates one when none has room.
 * `exclude` lanes are never chosen (an overlay keeps off the base lane).
 */
function laneFor(
  engine: TimelineEngine,
  kind: 'elements' | 'video' | 'audio',
  start: number,
  dur: number,
  newName: string,
  exclude?: string,
): string {
  const project = engine.getProject()
  // A lane whose clip ends right where this one starts comes first: a new
  // shot continues the sequence it follows (so a transition can join them).
  const follows = (id: string) => (project.clips[id] ?? []).some((c) => Math.abs(c.startFrame + c.durationFrames - start) <= 2)
  const lanes = project.tracks
    .filter((t) => t.kind === kind && !t.locked && t.id !== exclude && !RESERVED_LANES.has(t.name))
    .sort((a, b) => Number(follows(b.id)) - Number(follows(a.id)) || a.order - b.order)
  for (const t of lanes) if (!overlaps(project.clips[t.id] ?? [], start, dur)) return t.id
  return engine.addTrack(kind, { name: newName }).id
}

/**
 * `under` on `addGenerator` / `addImage`: a NEW video lane whose `order` sits directly beneath `target`'s lane
 * (a higher order draws on top, so the new lane draws behind it). Every lane from the target's up keeps its relative
 * order, because the new lane is spliced in before the target's and all orders are renumbered by rank. Runs inside the
 * plan's batch, so the undo that removes the clip removes the lane and restores the orders with it.
 */
function laneUnder(engine: TimelineEngine, target: Clip, newName: string): string {
  const track = engine.getProject().tracks.find((t) => t.id === target.trackId) ?? skip(`no lane holds "${target.name}"`)
  if (track.kind === 'audio') skip(`"${target.name}" is audio, so nothing can sit behind it`)
  const made = engine.addTrack('video', { name: newName })
  const ids = engine
    .getProject()
    .tracks.filter((t) => t.id !== made.id)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id)
  ids.splice(ids.indexOf(target.trackId), 0, made.id)
  engine.reorderTracks(ids)
  return made.id
}

/** Timing for a clip placed `under` `target`: omitted `at` starts with it, omitted `duration` runs to its end. */
function underSpan(target: Clip, atFrame: number | undefined, durFrames: number | undefined): { start: number; dur: number } {
  const start = atFrame ?? target.startFrame
  return { start, dur: durFrames ?? Math.max(1, target.startFrame + target.durationFrames - start) }
}

/** The patch `setClipProps` makes to `clip`: the same for a top-level clip and for a part inside a compound. */
function clipPropsPatch(clip: Clip, op: Extract<EditorOp, { op: 'setClipProps' }>): Partial<Clip> {
  const p: Partial<Clip> = {}
  if (op.opacity !== undefined) p.opacity = op.opacity
  if (op.volume !== undefined) p.volume = op.volume
  if (op.text !== undefined) {
    if (clip.type !== 'text') skip('only text clips have text')
    p.content = op.text
  }
  if (op.color !== undefined) {
    if (clip.type === 'text') p.color = op.color
    else if (clip.type === 'shape') {
      p.shapeFill = op.color
      // A gradient fill would otherwise hide this colour change entirely.
      if (clip.shapeFillPaint !== undefined) p.shapeFillPaint = undefined
    } else skip('only text and shapes have a colour')
  }
  if (op.x !== undefined || op.y !== undefined || op.scale !== undefined || op.rotation !== undefined || op.anchorX !== undefined || op.anchorY !== undefined) {
    const base =
      clip.transform ??
      (clip.type === 'text' ? DEFAULT_TEXT_TRANSFORM : clip.type === 'shape' ? DEFAULT_SHAPE_TRANSFORM : { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } })
    p.transform = {
      ...base,
      ...(op.x !== undefined ? { x: op.x } : {}),
      ...(op.y !== undefined ? { y: op.y } : {}),
      ...(op.scale !== undefined ? { scale: op.scale } : {}),
      ...(op.rotation !== undefined ? { rotation: (op.rotation * Math.PI) / 180 } : {}),
      ...(op.anchorX !== undefined || op.anchorY !== undefined
        ? { anchor: { x: op.anchorX ?? base.anchor?.x ?? 0.5, y: op.anchorY ?? base.anchor?.y ?? 0.5 } }
        : {}),
    }
  }
  return p
}

/**
 * The patch `setStyle` makes to `clip` (EG-P4). All or nothing: when any field
 * does not apply to this kind of clip the whole op is skipped, naming the
 * fields, so the model learns which kind of part it addressed.
 */
function stylePatch(clip: Clip, op: Extract<EditorOp, { op: 'setStyle' }>): Partial<Clip> {
  const p: Partial<Clip> = {}
  const bad: string[] = []
  const isText = clip.type === 'text'
  const isShape = clip.type === 'shape'

  if (op.fill !== undefined) {
    if (isText) {
      p.color = op.fill
      // `textFill` replaces `color` for the glyphs, so a gradient would hide this change.
      if (clip.textFill !== undefined) p.textFill = undefined
    } else if (isShape) {
      p.shapeFill = op.fill
      // Same reason as setClipProps: a gradient fill wins over `shapeFill`.
      if (clip.shapeFillPaint !== undefined) p.shapeFillPaint = undefined
    } else bad.push('fill')
  }
  if (op.stroke !== undefined || op.strokeWidth !== undefined) {
    if (isText) {
      const width = op.strokeWidth ?? clip.textOutline?.width ?? 4
      p.textOutline = width > 0 ? { color: op.stroke ?? clip.textOutline?.color ?? '#000000', width } : undefined
    } else if (isShape) {
      if (op.stroke !== undefined) {
        p.shapeStroke = op.stroke
        if (clip.shapeStrokePaint !== undefined) p.shapeStrokePaint = undefined
      }
      if (op.strokeWidth !== undefined) p.shapeStrokeWidth = op.strokeWidth
    } else bad.push(...[op.stroke !== undefined ? 'stroke' : '', op.strokeWidth !== undefined ? 'strokeWidth' : ''].filter(Boolean))
  }
  if (op.fontId !== undefined) {
    if (!isText) bad.push('fontId')
    else if (!getFont(op.fontId)) skip(`unknown font "${op.fontId}"`)
    else p.fontId = op.fontId
  }
  if (op.fontWeight !== undefined) {
    if (!isText) bad.push('fontWeight')
    else {
      const def = getFont(op.fontId ?? clip.fontId ?? '')
      if (def) {
        // A weight the family does not ship would silently paint the nearest
        // face anyway; say which one it is.
        const have = fontWeights(def)
        p.fontWeight = have.reduce((best, w) => (Math.abs(w - op.fontWeight!) < Math.abs(best - op.fontWeight!) ? w : best), have[0]!)
      } else {
        // A numeric weight means nothing without a bundled font (see `Clip.fontWeight`).
        p.fontWeight = op.fontWeight >= 600 ? 'bold' : 'normal'
      }
    }
  }
  if (op.fontSize !== undefined) {
    if (!isText) bad.push('fontSize')
    else p.fontSize = op.fontSize
  }
  if (op.textAlign !== undefined) {
    if (!isText) bad.push('textAlign')
    else p.textAlign = op.textAlign
  }
  if (op.letterSpacing !== undefined) {
    if (!isText) bad.push('letterSpacing')
    else p.textBox = { overflow: 'wrap', ...(clip.textBox ?? {}), letterSpacing: op.letterSpacing }
  }
  if (op.cornerRadius !== undefined) {
    if ((isShape && clip.shapeKind === 'rect') || clip.type === 'video' || clip.type === 'image') p.cornerRadius = op.cornerRadius
    else bad.push('cornerRadius')
  }

  if (bad.length) {
    const hint = clip.type === 'compound' ? ' — a compound has no style of its own; address one of its parts as "compoundId/childId"' : ''
    skip(`${bad.join(', ')} ${bad.length === 1 ? 'does' : 'do'} not apply to ${clip.type === 'shape' ? `a ${clip.shapeKind ?? 'shape'} shape` : `a ${clip.type} clip`}${hint}`)
  }
  return p
}

/**
 * Apply `ops` to `engine` as one undo step. Returns what was applied, what
 * was skipped (with a reason), refs, deferred generations and the touched
 * clip ids and frame range.
 */
export function applyOps(engine: TimelineEngine, ops: ReadonlyArray<EditorOp>, ctx: ApplyContext = {}): ApplyResult {
  const result: ApplyResult = {
    applied: [],
    skipped: [],
    refs: {},
    deferred: [],
    touched: { added: [], changed: [], removed: [] },
    range: null,
  }
  const fps = engine.getProject().fps > 0 ? engine.getProject().fps : 30
  const f = (sec: number) => Math.max(0, Math.round(sec * fps))
  const d = (sec: number) => Math.max(1, Math.round(sec * fps))
  const stage = engine.getProject().stage
  const kf: BaselineContext = { stage }
  const added = new Set<string>()
  const changed = new Set<string>()

  const widen = (start: number, dur: number) => {
    const end = start + dur
    result.range = result.range
      ? { startFrame: Math.min(result.range.startFrame, start), endFrame: Math.max(result.range.endFrame, end) }
      : { startFrame: start, endFrame: end }
  }
  const find = (ref: string): Clip => {
    const id = ref.startsWith('$') ? result.refs[ref.slice(1)] : ref
    if (!id) return skip(`"${ref}" was not created`)
    const found = engine.findClip(id)
    if (!found && id.includes('/')) return skip(`"${ref}" is a path into a graphic; this op works on whole clips only`)
    return found?.clip ?? skip(`no clip "${ref}"`)
  }
  /** A path `'compoundId/childId'` (EG-P4), unless a top-level clip really has that id. */
  const isPart = (ref: string): boolean => ref.includes('/') && !engine.findClip(ref)
  /**
   * One of the five property ops aimed at a clip INSIDE a compound. The patch
   * is computed against the child, written into a copy of the compound's nested
   * project, and committed with `updateCompoundProject` — inside the plan's
   * batch, so it is one undo step with every other op. A refusal from the
   * engine (locked lane, stale child) is a skip, never a throw.
   */
  const runPart = (op: Extract<EditorOp, { op: 'setClipProps' | 'setKeyframes' | 'applyMotionPreset' | 'setExpression' | 'setStyle' }>): void => {
    const segs = parseClipPath(op.clip) ?? skip(`"${op.clip}" is not a valid part path`)
    const [rootRef, ...rest] = segs
    const root = find(rootRef!)
    const inner = root.type === 'compound' ? root.compound?.project : undefined
    if (!inner) return skip(`"${root.name}" is not a graphic or compound, so it has no parts`)
    const located = locateClip(inner, rest)
    if (!located.ok) return skip(`${located.reason} inside "${root.name}"`)
    if (located.locked) return skip(`that part is on a locked or hidden lane inside "${root.name}"`)
    const target = located.clip
    const partKf: BaselineContext = { stage: inner.stage ?? stage }
    let p: Partial<Clip> = {}
    switch (op.op) {
      case 'setClipProps':
        p = clipPropsPatch(target, op)
        break
      case 'setStyle':
        p = stylePatch(target, op)
        break
      case 'applyMotionPreset':
        if (isBeatPreset(op.preset) || op.syncTo) return skip('beat sync is not available inside a graphic')
        p = applyMotionPreset(target, op.preset as MotionPresetName, op.amount !== undefined ? { amount: op.amount } : {}, partKf)
        break
      case 'setExpression':
        p = setChannelExpression(target, op.channel as AnyKeyframeChannel, op.source, partKf)
        if (Object.keys(p).length === 0) return skip(op.source ? 'that expression is already set' : `"${target.name}" has no ${op.channel} expression`)
        break
      case 'setKeyframes': {
        let cur = target
        for (const k of op.keys) {
          const local = Math.min(cur.durationFrames - 1, f(k.at))
          const kp = keyPatch(cur, op.channel, local, k, partKf)
          if (Object.keys(kp).length === 0) return skip(`"${target.name}" cannot take a ${op.channel} key`)
          p = { ...p, ...kp }
          cur = { ...cur, ...kp }
        }
        break
      }
    }
    if (Object.keys(p).length === 0) return
    const next = patchClipAtPath(inner, rest, p)
    if (!next) return skip(`no clip "${op.clip}"`)
    const r = engine.updateCompoundProject(root.id, next)
    if (!r.ok) return skip(`cannot edit inside "${root.name}": ${r.error.message}`)
    if (!added.has(root.id)) changed.add(root.id)
    widen(root.startFrame, root.durationFrames)
  }
  /**
   * `setComponentField` / `setComponentItems` (EG-P6): re-expand ONE component
   * instance with the change and merge it with the user's hand edits, then commit
   * through the engine's instance method (a top-level compound) or, for a
   * component nested in a raw group, through `updateCompoundProject` on the
   * group. Inside the plan's batch, so it is one undo step with every other op.
   * Every refusal is a skip with a reason; nothing throws out of here.
   */
  const runComponent = (op: Extract<EditorOp, { op: 'setComponentField' | 'setComponentItems' }>): void => {
    const overrides: Partial<SpecComponent> =
      op.op === 'setComponentItems'
        ? { items: op.items }
        : op.field === 'emphasis'
          ? { emphasis: op.value as string[] }
          : ({ [op.field]: op.value } as Partial<SpecComponent>)

    let root: Clip
    let rest: string[] = []
    let target: Clip
    if (isPart(op.clip)) {
      const segs = parseClipPath(op.clip) ?? skip(`"${op.clip}" is not a valid path`)
      const [rootRef, ...tail] = segs
      root = find(rootRef!)
      rest = tail
      const inner = root.type === 'compound' ? root.compound?.project : undefined
      if (!inner) return skip(`"${root.name}" is not a graphic or compound, so it has no parts`)
      const located = locateClip(inner, rest)
      if (!located.ok) return skip(`${located.reason} inside "${root.name}"`)
      if (located.locked) return skip(`that graphic is on a locked or hidden lane inside "${root.name}"`)
      target = located.clip
    } else {
      root = find(op.clip)
      target = root
    }
    if (target.type !== 'compound' || !target.compound) return skip(`"${target.name}" is not a graphic`)
    if (!target.component) return skip(`"${target.name}" is not a generated component, so it has no fields to edit`)

    const plan = planInstanceUpdate(target, engine.getProject().authored, { overrides })
    if (!plan.ok) return skip(plan.reason)

    const fps0 = (rest.length === 0 ? engine.getProject().fps : (root.compound?.project.fps ?? engine.getProject().fps)) || 30
    const resize = op.op === 'setComponentField' && op.field === 'duration' ? Math.max(1, Math.round((op.value as number) * fps0)) : undefined

    if (rest.length === 0) {
      if (resize !== undefined && resize > target.durationFrames) {
        const room = (engine.getProject().clips[target.trackId] ?? []).filter((c) => c.id !== target.id)
        if (overlaps(room, target.startFrame, resize)) return skip(`"${target.name}" cannot run ${resize / fps0}s: the next clip on its lane is in the way`)
      }
      const r = engine.updateCompoundInstance(target.id, plan.child, plan.component, { expectedChild: plan.expectedChild })
      if (!r.ok) return skip(`cannot edit "${target.name}": ${r.error.message}`)
      if (resize !== undefined && resize !== target.durationFrames) engine.updateClip(target.id, target.trackId, { durationFrames: resize })
    } else {
      const inner = root.compound!.project
      const written: Partial<Clip> = {
        component: plan.component,
        compound: { ...target.compound, project: plan.child },
        ...(resize !== undefined ? { durationFrames: resize } : {}),
      }
      const next = patchClipAtPath(inner, rest, written)
      if (!next) return skip(`no clip "${op.clip}"`)
      const r = engine.updateCompoundProject(root.id, next)
      if (!r.ok) return skip(`cannot edit inside "${root.name}": ${r.error.message}`)
    }
    if (!added.has(root.id)) changed.add(root.id)
    widen(root.startFrame, root.durationFrames)
  }
  const patch = (clip: Clip, p: Partial<Clip>) => {
    if (Object.keys(p).length === 0) return
    engine.updateClip(clip.id, clip.trackId, p)
    if (!added.has(clip.id)) changed.add(clip.id)
    widen(clip.startFrame, clip.durationFrames)
  }
  const created = (clip: Clip, ref?: string) => {
    added.add(clip.id)
    if (ref) result.refs[ref] = clip.id
    widen(clip.startFrame, clip.durationFrames)
    return clip
  }
  /** Report every clip a composition commit rewrote (PV-P7): a compound's id
   *  when the change reached one of its children, per `commitComposition` /
   *  `commitPropValues`'s `changedClipIds`. */
  const markChanged = (ids: ReadonlyArray<string>) => {
    for (const id of ids) {
      const c = engine.findClip(id)?.clip
      if (!c) continue
      if (!added.has(id)) changed.add(id)
      widen(c.startFrame, c.durationFrames)
    }
  }
  const fresh = (id: string) => engine.findClip(id)!.clip
  /** Timeline-local beats inside `clip`, from `audioRef`'s clip or every
   *  analysed audio clip when omitted (PV-P10b-3). `audioRef` resolution
   *  reuses `find`, so a bad `$ref` skips the whole op rather than reading no beats. */
  const beatsFor = (clip: Clip, audioRef?: string): number[] =>
    localBeatsInClip(engine.getProject(), clip, audioRef ? { audioClipId: find(audioRef).id } : undefined)
  // Magnetic main track (PV-T1): an edit there ripples other clips, which
  // the timeline's diff styling and "play the change" must know about.
  const starts = () => new Map(Object.values(engine.getProject().clips).flat().map((c) => [c.id, c.startFrame]))
  const markRippled = (before: Map<string, number>, except: string) => {
    for (const c of Object.values(engine.getProject().clips).flat()) {
      const was = before.get(c.id)
      if (was === undefined || was === c.startFrame || c.id === except) continue
      if (!added.has(c.id)) changed.add(c.id)
      widen(Math.min(was, c.startFrame), c.durationFrames + Math.abs(c.startFrame - was))
    }
  }
  const magnetic = (clip: Clip) => isMagneticMain(engine.getProject(), clip.trackId)

  const addText = (
    content: string,
    start: number,
    dur: number,
    opts: { template?: string; color?: string; size?: number; xy?: [number, number]; name?: string },
  ): Clip => {
    const trackId = laneFor(engine, 'elements', start, dur, ASSISTANT_GRAPHICS_TRACK)
    const clip = engine.addClip({
      trackId,
      type: 'text',
      name: opts.name ?? content.slice(0, 40),
      startFrame: start,
      durationFrames: dur,
      text: { content, ...(opts.size ? { fontSize: opts.size } : {}), ...(opts.color ? { color: opts.color } : {}) },
    })
    const template = opts.template ? findTextTemplate(opts.template) : undefined
    if (template) engine.updateClip(clip.id, trackId, applyTextTemplate(template, fresh(clip.id)))
    const after: Partial<Clip> = {}
    if (opts.xy) after.transform = { ...(fresh(clip.id).transform ?? DEFAULT_TEXT_TRANSFORM), x: opts.xy[0], y: opts.xy[1] }
    if (opts.color) after.color = opts.color
    if (opts.size) after.fontSize = opts.size
    if (Object.keys(after).length) engine.updateClip(clip.id, trackId, after)
    return fresh(clip.id)
  }

  const run = (op: EditorOp): void => {
    switch (op.op) {
      // --- Motion graphics -------------------------------------------------
      case 'addText': {
        const start = f(op.at)
        const dur = d(op.duration)
        let clip = addText(op.text, start, dur, {
          template: op.template,
          color: op.color,
          size: op.size,
          ...(op.region ? { xy: REGION_XY[op.region] } : {}),
        })
        const extra: Partial<Clip> = {}
        if (op.outline) extra.textOutline = { color: '#000000', width: 4 }
        if (op.shadow) extra.textShadow = { color: '#000000', blur: 12, offsetX: 0, offsetY: 4 }
        const reveal = op.reveal ? TEXT_ANIMATOR_PRESETS.find((p) => p.id === op.reveal) : undefined
        if (reveal) extra.textAnimator = reveal.animator
        if (Object.keys(extra).length) engine.updateClip(clip.id, clip.trackId, extra)
        if (op.motion) {
          clip = fresh(clip.id)
          engine.updateClip(clip.id, clip.trackId, applyMotionPreset(clip, op.motion as MotionPresetName, {}, kf))
        }
        created(fresh(clip.id), op.ref)
        return
      }
      case 'addShape': {
        const start = f(op.at)
        const dur = d(op.duration)
        const trackId = laneFor(engine, 'elements', start, dur, ASSISTANT_GRAPHICS_TRACK)
        const color = op.color ?? '#ffd400'
        const kind = op.kind
        const shape =
          kind === 'arrow'
            ? { shapeKind: 'line' as const, shapeStroke: color, shapeStrokeWidth: 10, shapeArrowHead: 'end' as const }
            : kind === 'line'
              ? { shapeKind: 'line' as const, shapeStroke: color, shapeStrokeWidth: 10 }
              : kind === 'star'
                ? { shapeKind: 'polygon' as const, shapeSides: 5, shapeInnerRatio: 0.45, shapeFill: op.outline ? 'transparent' : color, shapeStroke: color, shapeStrokeWidth: op.outline ? 8 : 0 }
                : { shapeKind: kind, shapeFill: op.outline ? 'transparent' : color, shapeStroke: color, shapeStrokeWidth: op.outline ? 8 : 0 }
        const clip = engine.addClip({ trackId, type: 'shape', name: kind, startFrame: start, durationFrames: dur, shape })
        const [x, y] = REGION_XY[op.region ?? 'center']
        const flat = kind === 'line' || kind === 'arrow'
        const transform: Transform = {
          ...DEFAULT_SHAPE_TRANSFORM,
          x,
          y,
          scale: op.size ?? DEFAULT_SHAPE_TRANSFORM.scale,
          ...(flat ? { scaleX: 1.4, scaleY: 0.25 } : {}),
        }
        engine.updateClip(clip.id, trackId, { transform })
        if (op.drawOn) engine.updateClip(clip.id, trackId, applyDrawOn(fresh(clip.id), 'draw-on'))
        if (op.motion) engine.updateClip(clip.id, trackId, applyMotionPreset(fresh(clip.id), op.motion as MotionPresetName, {}, kf))
        created(fresh(clip.id), op.ref)
        return
      }
      case 'addGenerator': {
        const def = getGeneratorDefinition(op.kind) ?? skip(`unknown generator "${op.kind}"`)
        const preset = op.preset ? def.presets?.find((p) => p.id === op.preset) : undefined
        const under = op.under !== undefined ? find(op.under) : undefined
        if (!under && (op.at === undefined || op.duration === undefined)) skip('at and duration are needed unless the clip goes under another')
        const span = under ? underSpan(under, op.at !== undefined ? f(op.at) : undefined, op.duration !== undefined ? d(op.duration) : undefined) : undefined
        const start = span ? span.start : f(op.at!)
        const dur = span ? span.dur : d(op.duration!)
        const trackId = under ? laneUnder(engine, under, 'Background') : laneFor(engine, 'elements', start, dur, ASSISTANT_GRAPHICS_TRACK)
        const clip = engine.addClip({
          trackId,
          type: 'generator',
          name: preset?.label ?? def.label,
          startFrame: start,
          durationFrames: dur,
          generator: createGenerator(op.kind, { ...(preset?.params ?? {}), ...(op.params ?? {}) }, 1 + ((start * 7919) % 9973)),
        })
        const extra: Partial<Clip> = {}
        if (def.blend) extra.blend = def.blend
        if (op.region && def.placed) {
          const [x, y] = REGION_XY[op.region]
          extra.transform = { x, y, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
        }
        if (Object.keys(extra).length) engine.updateClip(clip.id, trackId, extra)
        created(fresh(clip.id), op.ref)
        return
      }
      case 'addLowerThird': {
        const start = f(op.at)
        const dur = d(op.duration)
        const title = addText(op.title, start, dur, { template: 'template-lower-third', name: `Lower third: ${op.title}` })
        created(title, op.ref)
        if (op.subtitle) {
          const tt = title.transform ?? DEFAULT_TEXT_TRANSFORM
          const sub = addText(op.subtitle, start, dur, {
            template: 'template-lower-third',
            size: 26,
            xy: [tt.x, Math.min(0.97, tt.y + 0.075)],
            ...(op.accent ? { color: op.accent } : {}),
            name: `Lower third: ${op.subtitle}`,
          })
          // PV-P3b: the subtitle sits under the title's measured box, whatever
          // its length — the fixed `xy` above stays as the no-measurer fallback.
          engine.updateClip(sub.id, sub.trackId, { layout: { anchorTo: { clip: title.id, edge: 'bottom', align: 'start', gap: 8 } } })
          created(fresh(sub.id))
        } else if (op.accent) {
          engine.updateClip(title.id, title.trackId, { borderColor: op.accent, borderWidth: 3 })
        }
        return
      }
      case 'addTitleCard': {
        const start = f(op.at)
        const dur = d(op.duration)
        const title = addText(op.title, start, dur, { template: 'template-title-card', name: `Title: ${op.title}` })
        created(title, op.ref)
        if (op.subtitle) {
          const tt = title.transform ?? DEFAULT_TEXT_TRANSFORM
          const sub = addText(op.subtitle, start, dur, { template: 'template-elegant-reveal', size: 34, xy: [tt.x, Math.min(0.95, tt.y + 0.12)], name: `Subtitle: ${op.subtitle}` })
          // PV-P3b: same reasoning as addLowerThird, a looser gap for the card's
          // title/subtitle pair.
          engine.updateClip(sub.id, sub.trackId, { layout: { anchorTo: { clip: title.id, edge: 'bottom', align: 'center', gap: 16 } } })
          created(fresh(sub.id))
        }
        return
      }
      case 'addCallout': {
        const clip = addText(op.text, f(op.at), d(op.duration), {
          template: 'template-callout',
          ...(op.region ? { xy: REGION_XY[op.region] } : {}),
          name: `Callout: ${op.text}`,
        })
        // PV-P3b: the fixed `xy` above stays as the no-measurer fallback; with a
        // measurer the region keeps the callout inside title-safe at any length.
        if (op.region) engine.updateClip(clip.id, clip.trackId, { layout: { region: op.region } })
        if (op.accent) engine.updateClip(clip.id, clip.trackId, { borderColor: op.accent })
        created(fresh(clip.id), op.ref)
        return
      }
      case 'setCaptionStyle': {
        const project = engine.getProject()
        const lanes = ctx.captionTrackIds?.length ? ctx.captionTrackIds : Object.keys(project.clips)
        let n = 0
        for (const trackId of lanes) {
          for (const c of project.clips[trackId] ?? []) {
            if (c.type !== 'text') continue
            if (!ctx.captionTrackIds?.length && !c.words?.length) continue
            const words = c.words?.length ? c.words : estimateWordTimings(c.content ?? '', c.durationFrames)
            patch(c, {
              captionMode: op.mode === 'static' ? undefined : op.mode,
              ...(words.length ? { words } : {}),
              ...(op.highlight ? { captionHighlight: op.highlight } : {}),
            })
            n++
          }
        }
        if (n === 0) skip('there are no captions to restyle')
        return
      }
      case 'addCaptions': {
        // AGN-P19: `words` is filled by the web layer's resolver from a transcript already cached on the asset.
        // No words = never resolved: skip. Never guess text and never start a transcription.
        const words = op.words
        if (!words || words.length === 0) return skip('these captions were never resolved from a transcript, so there is nothing to place')
        const source = find(op.clip)
        if (source.type !== 'video' && source.type !== 'audio') return skip(`"${source.name}" is a ${source.type} clip, which has no speech to caption`)
        // A look carries the template, the reveal animator, the mode and the highlight (AGN-P20);
        // an explicit `style` still wins on the mode alone.
        const look = op.captionLook ? findCaptionLook(op.captionLook) : undefined
        const capMode = op.style ?? look?.mode
        const built = captionClipsFromTranscript(words, {
          fps,
          trackId: '',
          startFrame: source.startFrame,
          mode: capMode && capMode !== 'static' ? capMode : undefined,
          position: op.position === 'center' ? 'centre' : 'bottom',
        })
        if (built.length === 0) return skip('the transcript has no words in that range')
        const envStart = Math.min(...built.map((c) => c.startFrame))
        const envEnd = Math.max(...built.map((c) => c.startFrame + c.durationFrames))
        const trackId = laneFor(engine, 'elements', envStart, envEnd - envStart, 'Captions')
        const ids: string[] = []
        for (const b of built) {
          const clip = engine.addClip({ trackId, type: 'text', name: b.name, startFrame: b.startFrame, durationFrames: b.durationFrames, text: { content: b.content ?? '' } })
          const transform = op.position === 'top' && b.transform ? { ...b.transform, y: 0.14 } : b.transform
          engine.updateClip(clip.id, trackId, {
            words: b.words,
            ...(transform ? { transform } : {}),
            ...(b.captionMode !== undefined ? { captionMode: b.captionMode } : {}),
          })
          if (look) {
            const placed = engine.findClip(clip.id)?.clip
            if (placed) {
              const { words: _unused, ...styling } = captionLookPatch(look, placed)
              engine.updateClip(clip.id, trackId, styling)
            }
          }
          created(fresh(clip.id))
          ids.push(clip.id)
        }
        // They follow the footage through move, trim, split and delete (AGN-P8).
        engine.linkClips([...engine.getLinked(source.id).map((c) => c.id), ...ids])
        return
      }
      // --- Edit ------------------------------------------------------------
      case 'removeClip': {
        const clip = find(op.clip)
        if (magnetic(clip)) {
          const before = starts()
          const r = removeForMode(engine, clip.id)
          if (!r.ok) skip(`"${clip.name}" cannot be removed from the main track (${r.reason})`)
          markRippled(before, clip.id)
        } else {
          engine.removeClip(clip.id, clip.trackId)
        }
        if (added.has(clip.id)) added.delete(clip.id)
        else result.touched.removed.push({ id: clip.id, name: clip.name, trackId: clip.trackId, startFrame: clip.startFrame, durationFrames: clip.durationFrames })
        changed.delete(clip.id)
        widen(clip.startFrame, clip.durationFrames)
        return
      }
      case 'moveClip': {
        const clip = find(op.clip)
        const start = f(op.at)
        if (magnetic(clip)) {
          // The main track stays gapless: the clip is lifted and inserted at
          // the cut nearest the requested time.
          const before = starts()
          const r = moveForMode(engine, clip.id, start)
          if (!r.ok) skip(`"${clip.name}" cannot move on the main track (${r.reason})`)
          if (!added.has(clip.id)) changed.add(clip.id)
          widen(clip.startFrame, clip.durationFrames)
          widen(fresh(clip.id).startFrame, clip.durationFrames)
          markRippled(before, clip.id)
          return
        }
        const list = engine.getProject().clips[clip.trackId] ?? []
        if (findOverlaps(list, { startFrame: start, durationFrames: clip.durationFrames }, clip.id).length) {
          skip(`moving "${clip.name}" there would overlap another clip`)
        }
        widen(clip.startFrame, clip.durationFrames)
        engine.moveClip(clip.id, clip.trackId, clip.trackId, start)
        if (!added.has(clip.id)) changed.add(clip.id)
        widen(start, clip.durationFrames)
        return
      }
      case 'trimClip': {
        const clip = find(op.clip)
        const start = op.start !== undefined ? f(op.start) : clip.startFrame
        const end = op.end !== undefined ? f(op.end) : clip.startFrame + clip.durationFrames
        if (end - start < 1) skip('the trim leaves nothing')
        if (magnetic(clip)) {
          // The clip keeps its start; everything after it ripples.
          const before = starts()
          const r = trimForMode(engine, clip.id, start, end)
          const after = fresh(clip.id)
          if (!r.ok || (after.durationFrames === clip.durationFrames && after.sourceStartFrame === clip.sourceStartFrame)) {
            skip(`"${clip.name}" cannot be trimmed there (media length or a neighbour)`)
          }
          if (!added.has(clip.id)) changed.add(clip.id)
          widen(clip.startFrame, Math.max(clip.durationFrames, after.durationFrames))
          markRippled(before, clip.id)
          return
        }
        engine.trimClip(clip.id, clip.trackId, start, end - start)
        const after = fresh(clip.id)
        if (after.startFrame === clip.startFrame && after.durationFrames === clip.durationFrames) {
          skip(`"${clip.name}" cannot be trimmed there (media length or a neighbour)`)
        }
        if (!added.has(clip.id)) changed.add(clip.id)
        widen(Math.min(clip.startFrame, after.startFrame), Math.max(clip.durationFrames, after.durationFrames))
        return
      }
      case 'splitClip': {
        const clip = find(op.clip)
        const atFrame = f(op.at)
        if (atFrame <= clip.startFrame || atFrame >= clip.startFrame + clip.durationFrames) skip('the split point is outside the clip')
        const parts = engine.splitClip(clip.id, clip.trackId, atFrame)
        if (!parts) skip(`"${clip.name}" cannot be split`)
        for (const id of parts!) (added.has(clip.id) ? added : changed).add(id)
        widen(clip.startFrame, clip.durationFrames)
        return
      }
      case 'setSpeed': {
        const clip = find(op.clip)
        if (clip.type !== 'video') skip('speed applies to video clips')
        if (clip.keyframes?.channels?.time?.keys?.length) skip('this clip has a speed ramp; reset it first')
        engine.setClipSpeed(clip.id, clip.trackId, op.speed)
        if (!added.has(clip.id)) changed.add(clip.id)
        widen(clip.startFrame, Math.max(clip.durationFrames, fresh(clip.id).durationFrames))
        return
      }
      case 'setFit': {
        const clip = find(op.clip)
        if (clip.type !== 'video' && clip.type !== 'image' && clip.type !== 'sequence') skip(`"${clip.name}" is a ${clip.type} clip, which has no picture to fit`)
        if (op.fit === 'blur-fill' && clip.type === 'sequence') skip(`"${clip.name}" is an animated image; blur-fill works on video and still images`)
        const keyed = clip.keyframes?.channels
        if (keyed && (['x', 'y', 'scale', 'scaleX', 'scaleY'] as const).some((ch) => (keyed[ch]?.keys.length ?? 0) > 0)) {
          skip(`"${clip.name}" has keyed position or scale, so a fit would fight its keyframes`)
        }
        const asset = clip.assetId ? ctx.assets?.get(clip.assetId) : undefined
        const natW = clip.sequence?.width ?? asset?.width
        const natH = clip.sequence?.height ?? asset?.height
        if (!natW || !natH || !(natW > 0) || !(natH > 0)) skip(`the size of "${clip.name}" is not known yet`)
        const focus = { x: op.focusX ?? clip.focus?.x ?? 0.5, y: op.focusY ?? clip.focus?.y ?? 0.5 }
        const content = { width: natW as number, height: natH as number }
        const backdrop = engine.getLinked(clip.id).find((c) => isFitBackdrop(c, clip))
        const dropBackdrop = () => {
          if (!backdrop) return
          engine.removeClip(backdrop.id, backdrop.trackId)
          if (added.has(backdrop.id)) added.delete(backdrop.id)
          else result.touched.removed.push({ id: backdrop.id, name: backdrop.name, trackId: backdrop.trackId, startFrame: backdrop.startFrame, durationFrames: backdrop.durationFrames })
          changed.delete(backdrop.id)
          widen(backdrop.startFrame, backdrop.durationFrames)
        }
        if (op.fit !== 'blur-fill') {
          dropBackdrop()
          const plan = fitPlan(content, stage, op.fit, focus)
          patch(clip, { crop: plan.crop, transform: plan.transform, ...(op.fit === 'cover' ? { focus } : {}) })
          return
        }
        // blur-fill: the picture stays contained; a muted, blurred, darkened cover copy sits on a lane directly behind.
        const back = fitPlan(content, stage, 'cover', focus)
        patch(clip, { crop: undefined, transform: undefined, focus })
        if (!back.crop) {
          // The picture already has the stage's aspect: there is nothing to fill behind it.
          dropBackdrop()
          return
        }
        const effects = [createEffect('gaussianBlur'), createEffect('colorGrade')].map((e) => ({
          ...e,
          params: clampEffectParams(e.kind, { ...e.params, ...(e.kind === 'gaussianBlur' ? { radius: 40 } : { exposure: -0.6 }) }) ?? e.params,
        }))
        if (backdrop) {
          patch(backdrop, { crop: back.crop, transform: back.transform, focus, effects })
          return
        }
        const trackId = laneUnder(engine, clip, 'Fit background')
        const base = {
          trackId,
          name: `${clip.name} (fit background)`,
          src: clip.src ?? asset?.src ?? skip(`"${clip.name}" has no media source to copy`),
          ...(clip.assetId !== undefined ? { assetId: clip.assetId } : {}),
          startFrame: clip.startFrame,
          durationFrames: clip.durationFrames,
        }
        const copy = engine.addClip(clip.type === 'image' ? { ...base, type: 'image' } : { ...base, type: 'video' })
        engine.updateClip(copy.id, trackId, {
          sourceStartFrame: clip.sourceStartFrame,
          sourceDurationFrames: clip.sourceDurationFrames,
          ...(clip.assetFrames !== undefined ? { assetFrames: clip.assetFrames } : {}),
          ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
          ...(clip.media ? { media: clip.media } : {}),
          ...(clip.type === 'video' ? { embeddedAudio: clip.embeddedAudio ?? true } : {}),
          ...(clip.keyframes && hasTimeRemap(clip) ? { keyframes: clip.keyframes } : {}),
          volume: 0,
          crop: back.crop,
          transform: back.transform,
          focus,
          effects,
        })
        created(fresh(copy.id))
        engine.linkClips([...engine.getLinked(clip.id).map((c) => c.id), copy.id])
        return
      }
      case 'applySpeedPreset': {
        const clip = find(op.clip)
        if (clip.type !== 'video') skip('speed ramps apply to video clips')
        const local = op.at !== undefined ? f(op.at) - clip.startFrame : undefined
        patch(clip, applySpeedPreset(clip, op.preset as SpeedPresetName, local !== undefined ? { atFrame: local } : {}))
        return
      }
      case 'setClipProps': {
        if (isPart(op.clip)) return runPart(op)
        const clip = find(op.clip)
        const p = clipPropsPatch(clip, op)
        if (op.under !== undefined) {
          const target = find(op.under)
          if (target.id === clip.id) skip('a clip cannot sit under itself')
          if (clip.type !== 'text' && clip.type !== 'shape' && clip.type !== 'freehand') skip('only text, shape and freehand clips can sit under another clip')
          if (target.type !== 'text' && target.type !== 'shape' && target.type !== 'freehand') skip(`"${target.name}" is not text, a shape or a drawing, so nothing can sit under it`)
          p.layout = { ...clip.layout, anchorTo: { clip: target.id, edge: 'bottom', align: 'center', gap: 12 } }
        }
        patch(clip, p)
        return
      }
      case 'setStyle': {
        if (isPart(op.clip)) return runPart(op)
        const clip = find(op.clip)
        patch(clip, stylePatch(clip, op))
        return
      }
      case 'applyMotionPreset': {
        if (isPart(op.clip)) return runPart(op)
        const clip = find(op.clip)
        // Beat presets (PV-P10b-3): key on every detected beat, never the
        // whole-clip presets' single ramp.
        if (isBeatPreset(op.preset)) {
          const beats = beatsFor(clip, op.audio)
          if (beats.length === 0) skip(`no detected beats inside "${clip.name}" — detect beats on the music first`)
          const { patch: p, hits } = applyBeatPreset(
            clip,
            op.preset as BeatPresetName,
            beats,
            op.amount !== undefined ? { amount: op.amount } : {},
            kf,
          )
          if (hits === 0) skip(`${op.preset} does not apply to ${clip.type} clips`)
          patch(clip, p)
          return
        }
        // PQ-2d: a wipe on audio or an underline on text writes nothing; say so instead of reporting success.
        if (!presetAppliesTo(op.preset as MotionPresetName, clip.type)) skip(`${op.preset} does not apply to ${clip.type} clips`)
        // `syncTo: 'beats'` lands an enter/exit preset on the clip's first (or
        // last) beat, by choosing the ramp length that ends exactly there.
        // The old, unsynced line below is UNCHANGED for every other input.
        if (op.syncTo === 'beats') {
          const def = MOTION_PRESETS.find((p) => p.name === op.preset)
          if (!def || def.end === 'whole') skip('syncTo "beats" applies to enter and exit presets')
          const beats = beatsFor(clip, op.audio)
          const last = clip.durationFrames - 1
          const ramp =
            def!.end === 'in'
              ? beats.find((f) => f > 0)
              : (() => {
                  const held = beats.filter((f) => f < last)
                  return held.length ? last - held[held.length - 1]! : undefined
                })()
          if (ramp === undefined) skip(`no beat inside "${clip.name}" to land on`)
          patch(
            clip,
            applyMotionPreset(
              clip,
              op.preset as MotionPresetName,
              { ...(op.amount !== undefined ? { amount: op.amount } : {}), rampFrames: ramp },
              kf,
            ),
          )
          return
        }
        patch(clip, applyMotionPreset(clip, op.preset as MotionPresetName, op.amount !== undefined ? { amount: op.amount } : {}, kf))
        return
      }
      case 'staggerPreset': {
        // MG-P5. Resolve and check EVERY clip before writing any, so a bad ref or a locked lane skips the whole op
        // with a reason instead of half-applying it.
        const targets: Clip[] = []
        for (const ref of op.clips) {
          const target = find(ref)
          if (targets.some((t) => t.id === target.id)) skip(`"${target.name}" is listed twice`)
          if (engine.isTrackLocked(target.trackId)) skip(`"${target.name}" is on a locked track`)
          targets.push(target)
        }
        if (targets.length < 2) skip('staggerPreset needs at least two clips')
        const rich =
          op.from !== undefined || op.ease !== undefined || op.grid !== undefined
            ? { each: op.offsetFrames, ...(op.from !== undefined ? { from: op.from } : {}), ...(op.ease !== undefined ? { ease: op.ease } : {}), ...(op.grid !== undefined ? { grid: { cols: op.grid } } : {}) }
            : undefined
        const patches = staggerPresetPatches(targets, op.preset as MotionPresetName, op.amount !== undefined ? { amount: op.amount } : {}, op.offsetFrames, kf, rich ? staggerOffsets(targets.length, rich) : undefined)
        if (patches.every((p) => Object.keys(p.patch).length === 0)) skip(`${op.preset} does not apply to those clips`)
        for (const p of patches) patch(targets.find((t) => t.id === p.clipId)!, p.patch)
        return
      }
      case 'beatCuts': {
        const clip = find(op.clip)
        const every = Math.min(16, Math.max(1, Math.round(op.every ?? 1)))
        const beats = beatsFor(clip, op.audio)
        const cuts = beatCutFrames(beats, every)
        if (cuts.length === 0) skip(`no detected beats inside "${clip.name}"`)
        if (engine.isTrackLocked(clip.trackId)) skip(`"${clip.name}" is on a locked track`)
        // Descending order: every split targets the ORIGINAL clip id, since
        // the left half of a split always keeps it.
        for (const cut of [...cuts].sort((a, b) => b - a)) {
          const parts = engine.splitClip(clip.id, clip.trackId, clip.startFrame + cut)
          if (!parts) continue
          for (const id of parts) (added.has(clip.id) ? added : changed).add(id)
        }
        widen(clip.startFrame, clip.durationFrames)
        return
      }
      case 'silenceFreeze': {
        const clip = find(op.clip)
        if (clip.type !== 'video') skip('silence freeze applies to video clips')
        if (hasTimeRemap(clip)) skip('this clip has a speed ramp; reset it first')
        const source = op.audio ? find(op.audio) : defaultAudioSourceFor(engine.getProject(), clip)
        if (!source) skip('no analysed audio under this clip — detect beats on the audio first')
        const minFrames = Math.max(1, Math.round((op.minDuration ?? 0.5) * fps))
        const clipEnd = clip.startFrame + clip.durationFrames
        const ranges: Array<[number, number]> = clipSilenceRanges(engine.getProject(), source!)
          .map(([s, e]): [number, number] => [Math.max(s, clip.startFrame), Math.min(e, clipEnd)])
          .filter(([a, b]) => b > a)
          .map(([a, b]): [number, number] => [a - clip.startFrame, b - clip.startFrame])
          .filter(([a, b]) => b - a >= minFrames)
          .slice(0, MAX_FREEZES)
        if (ranges.length === 0) skip('no silence long enough inside the clip')
        patch(clip, silenceFreezePatch(clip, ranges, kf))
        return
      }
      case 'setKeyframes': {
        if (isPart(op.clip)) return runPart(op)
        let clip = find(op.clip)
        for (const k of op.keys) {
          const local = Math.min(clip.durationFrames - 1, f(k.at))
          const p = keyPatch(clip, op.channel, local, k, kf)
          if (Object.keys(p).length === 0) {
            skip(`"${clip.name}" cannot take a ${op.channel} key`)
            return
          }
          engine.updateClip(clip.id, clip.trackId, p)
          clip = fresh(clip.id)
        }
        widen(clip.startFrame, clip.durationFrames)
        if (!added.has(clip.id)) changed.add(clip.id)
        return
      }
      case 'setExpression': {
        if (isPart(op.clip)) return runPart(op)
        const clip = find(op.clip)
        // One `patch`, so one undo step: setting an expression on a clip that
        // bakes a baseline transform must not become two history entries.
        const p = setChannelExpression(clip, op.channel as AnyKeyframeChannel, op.source, kf)
        if (Object.keys(p).length === 0) {
          skip(op.source ? 'that expression is already set' : `"${clip.name}" has no ${op.channel} expression`)
          return
        }
        patch(clip, p)
        return
      }
      case 'addTransition': {
        const from = find(op.from)
        let to: Clip | undefined
        if (op.to) to = find(op.to)
        else {
          const end = from.startFrame + from.durationFrames
          to = (engine.getProject().clips[from.trackId] ?? []).find((c) => c.id !== from.id && c.startFrame >= end && c.startFrame - end <= 2)
        }
        if (!to) skip(`no clip starts right after "${from.name}"`)
        if (to!.trackId !== from.trackId) skip('a transition joins two clips on the same track')
        const existing = engine.getProject().transitions.find((t) => t.fromClipId === from.id && t.toClipId === to!.id)
        const durationFrames = Math.max(2, d(op.duration ?? 0.5))
        if (existing) {
          engine.updateTransition(existing.id, { kind: op.kind as never, durationFrames, ...(op.direction ? { direction: op.direction } : {}) })
        } else {
          const t = engine.addTransition({
            fromClipId: from.id,
            toClipId: to!.id,
            trackId: from.trackId,
            kind: op.kind as never,
            durationFrames,
            ...(op.direction ? { direction: op.direction } : {}),
          })
          if (!t) skip('the clips are too short for that transition')
        }
        changed.add(from.id)
        changed.add(to!.id)
        widen(from.startFrame + from.durationFrames - durationFrames, durationFrames * 2)
        return
      }
      case 'removeTransition': {
        const all = engine.getProject().transitions
        let target: (typeof all)[number] | undefined
        let from: Clip | undefined
        let to: Clip | undefined
        if (op.transition) {
          target = all.find((t) => t.id === op.transition)
          if (!target) skip(`no transition "${op.transition}"`)
          from = engine.findClip(target!.fromClipId)?.clip
          to = engine.findClip(target!.toClipId)?.clip
        } else {
          from = find(op.from ?? skip('removeTransition needs a transition or the clips it joins'))
          to = op.to ? find(op.to) : undefined
          const joined = all.filter((t) => t.fromClipId === from!.id && (to === undefined || t.toClipId === to.id))
          if (joined.length === 0) skip(to ? `no transition between "${from.name}" and "${to.name}"` : `no transition leaves "${from.name}"`)
          target = joined[0]
          to = engine.findClip(target!.toClipId)?.clip
        }
        engine.removeTransition(target!.id)
        for (const c of [from, to]) if (c && !added.has(c.id)) changed.add(c.id)
        widen(target!.startFrame, target!.durationFrames)
        return
      }
      // --- Look ------------------------------------------------------------
      // --- Cuts and mix (CHAT-5a) -------------------------------------------
      case 'removeRanges': {
        const clip = find(op.clip)
        if (clip.type !== 'video' && clip.type !== 'audio') skip(`"${clip.name}" is a ${clip.type} clip; ranges can only be cut out of video or audio`)
        if (hasTimeRemap(clip)) skip('this clip has a speed ramp; reset it first')
        const ripple = op.ripple !== false
        const sourcePlan = planSourceRanges(op.ranges, clipSourceWindowSec(clip, fps))
        if (!sourcePlan.ok) return skip(sourcePlan.reason)
        const local = sourceRangesToLocalFrames(sourcePlan.ranges, clip, fps)
        if (local.length === 0) skip('the ranges are shorter than one frame, so there is nothing to cut')
        // Absolute timeline frames of every cut. A linked partner is cut at these same moments.
        const cuts = local.map(([a, b]): [number, number] => [clip.startFrame + a, clip.startFrame + b])

        // EVERYTHING is read and checked before anything is written: an op that skipped halfway through would leave
        // its splits behind, because the plan's batch only rolls back on a throw.
        const group = engine.getLinked(clip.id)
        const cutMembers = [clip, ...group.filter((c) => c.id !== clip.id && (c.type === 'video' || c.type === 'audio'))]
          .map((m) => ({ clip: m, plan: planMemberCuts(m.startFrame, m.startFrame + m.durationFrames, cuts) }))
          .filter((m) => m.plan.ranges.length > 0)
        for (const m of cutMembers) {
          if (engine.isTrackLocked(m.clip.trackId)) skip(`"${m.clip.name}" is on a locked track`)
          if (!ripple && magnetic(m.clip)) skip(`"${m.clip.name}" is on the magnetic main track, which cannot keep a gap: cut with ripple on`)
        }
        const captionClips = group.filter((c) => c.type === 'text' && c.words !== undefined && c.words.length > 0)
        for (const c of captionClips) if (engine.isTrackLocked(c.trackId)) skip(`the captions of "${clip.name}" are on a locked track`)
        const captionPlan = planCaptionRemoval(
          captionClips.map((c) => ({ id: c.id, trackId: c.trackId, startFrame: c.startFrame, durationFrames: c.durationFrames, words: c.words! })),
          cuts,
          ripple,
          (trackId) => engine.getClipsOnTrack(trackId),
        )

        const before = starts()
        const moves: Array<{ clipId: string; trackId: string; delta: number }> = []
        const segments = new Map<number, string[]>()
        for (const m of cutMembers) {
          const mc = m.clip
          const memberEnd = mc.startFrame + mc.durationFrames
          const wasAdded = added.has(mc.id)
          const pieces = new Map<number, string>()
          // Right to left, so the left half of every split keeps the original id and the cut positions stay valid.
          let current: string | null = mc.id
          let currentEnd = memberEnd
          for (const [a, b] of [...m.plan.ranges].reverse()) {
            if (b < currentEnd) {
              const parts = engine.splitClip(current!, mc.trackId, b)
              if (!parts) skip(`"${mc.name}" cannot be split there`)
              pieces.set(b, parts![1])
            }
            if (a > mc.startFrame) {
              const parts = engine.splitClip(current!, mc.trackId, a)
              if (!parts) skip(`"${mc.name}" cannot be split there`)
              engine.removeClip(parts![1], mc.trackId)
              if (!wasAdded) result.touched.removed.push({ id: parts![1], name: mc.name, trackId: mc.trackId, startFrame: a, durationFrames: b - a })
            } else {
              engine.removeClip(current!, mc.trackId)
              if (!wasAdded) result.touched.removed.push({ id: mc.id, name: mc.name, trackId: mc.trackId, startFrame: a, durationFrames: b - a })
              changed.delete(mc.id)
              current = null
            }
            currentEnd = a
          }
          if (current) pieces.set(mc.startFrame, current)
          if (wasAdded && current === null) added.delete(mc.id)
          for (const piece of m.plan.kept) {
            const id = pieces.get(piece.origStart)
            if (!id) continue
            ;(wasAdded ? added : changed).add(id)
            const seg = segmentIndex(piece.origStart, cuts)
            segments.set(seg, [...(segments.get(seg) ?? []), id])
            if (ripple && piece.shift > 0) moves.push({ clipId: id, trackId: mc.trackId, delta: -piece.shift })
          }
          if (ripple) {
            // Whatever follows the clip on its lane moves up by everything taken out of it.
            const pieceIds = new Set(pieces.values())
            for (const later of engine.getProject().clips[mc.trackId] ?? []) {
              if (later.startFrame >= memberEnd && !pieceIds.has(later.id)) moves.push({ clipId: later.id, trackId: mc.trackId, delta: -m.plan.removed })
            }
          }
          widen(mc.startFrame, mc.durationFrames)
        }
        if (moves.length > 0 && !engine.shiftClips(moves, 'Close gaps')) skip('the cuts were made but the gaps could not be closed')

        // The pieces of one stretch (the picture and its sound) stay linked, as a split-as-a-group would leave them.
        for (const ids of segments.values()) {
          if (ids.length < 2) continue
          const links = new Set(ids.map((id) => engine.findClip(id)?.clip.linkId))
          if (links.size === 1 && !links.has(undefined)) continue
          engine.linkClips(ids)
        }

        for (const id of captionPlan.removals) {
          const cap = engine.findClip(id)?.clip
          if (!cap) continue
          engine.removeClip(cap.id, cap.trackId)
          if (added.has(cap.id)) added.delete(cap.id)
          else result.touched.removed.push({ id: cap.id, name: cap.name, trackId: cap.trackId, startFrame: cap.startFrame, durationFrames: cap.durationFrames })
          changed.delete(cap.id)
        }
        for (const p of captionPlan.patches) {
          engine.updateClip(p.clipId, p.trackId, { startFrame: p.startFrame, durationFrames: p.durationFrames, words: p.words, content: p.content })
          if (!added.has(p.clipId)) changed.add(p.clipId)
        }
        markRippled(before, clip.id)
        return
      }
      case 'crossfadeCuts': {
        const project = engine.getProject()
        let pool: Clip[]
        if (op.clips && op.clips.length > 0) {
          pool = [...new Map(op.clips.map((ref) => find(ref)).map((c) => [c.id, c])).values()]
        } else if (op.track !== undefined) {
          const track = project.tracks.find((t) => t.id === op.track) ?? project.tracks.find((t) => t.name === op.track) ?? skip(`no track "${op.track}"`)
          pool = project.clips[track.id] ?? []
        } else {
          pool = Object.values(project.clips).flat()
        }
        const plan = planCrossfades(pool, fps, op.ms ?? CROSSFADE_DEFAULT_MS, kf)
        if (plan.joins === 0) skip('there are no joins between back-to-back audio clips')
        const open = plan.patches.filter((p) => !engine.isTrackLocked(p.trackId))
        if (open.length === 0) skip(plan.patches.length > 0 ? 'the clips at those joins are on locked tracks' : 'the clips at those joins are driven by a volume expression or too short to fade')
        for (const p of open) patch(fresh(p.clipId), p.patch)
        return
      }
      case 'duckUnder': {
        const music = find(op.music)
        const voice = find(op.voice)
        if (music.id === voice.id) skip('the music and the voice must be different clips')
        if (!isAudioBearing(music)) skip(`"${music.name}" has no sound to lower`)
        if (!isAudioBearing(voice)) skip(`"${voice.name}" has no sound, so there is no speech to duck under`)
        if (engine.isTrackLocked(music.trackId)) skip(`"${music.name}" is on a locked track`)
        if (hasVolumeExpression(music)) skip(`"${music.name}" has its volume driven by an expression; remove it first`)
        const speech: Array<[number, number]> =
          op.segments && op.segments.length > 0
            ? op.segments.map((s): [number, number] => [f(s.from), f(s.to)])
            : [[voice.startFrame, voice.startFrame + voice.durationFrames]]
        const plan = planDuck(
          music,
          speech,
          { fps, amountDb: op.amountDb ?? DUCK_DEFAULT_DB, attackSec: op.attackSec ?? DUCK_DEFAULT_ATTACK_SEC, releaseSec: op.releaseSec ?? DUCK_DEFAULT_RELEASE_SEC },
          kf,
        )
        if (plan.spans === 0) skip(`the speech does not overlap "${music.name}"`)
        patch(music, plan.patch)
        return
      }
      case 'addSfx': {
        const asset = ctx.assets?.get(op.asset) ?? skip('that media is not in the library')
        if (asset.kind !== 'audio') skip(`“${asset.name}” is ${asset.kind === 'image' ? 'an image' : 'a video'}, not audio`)
        const start = f(op.at)
        const assetFrames = Number.isFinite(asset.durationSec) && asset.durationSec > 0 ? Math.max(1, Math.round(asset.durationSec * fps)) : undefined
        const wanted = op.duration !== undefined ? d(op.duration) : (assetFrames ?? d(2))
        const dur = assetFrames !== undefined ? Math.min(wanted, assetFrames) : wanted
        const project = engine.getProject()
        const sfxLanes = project.tracks.filter((t) => t.kind === 'audio' && /^sfx( \d+)?$/i.test(t.name.trim())).sort((a, b) => a.order - b.order)
        const lane = sfxLanes.find((t) => !t.locked && !overlaps(project.clips[t.id] ?? [], start, dur))
        const trackId = lane?.id ?? engine.addTrack('audio', { name: sfxLanes.length === 0 ? 'SFX' : `SFX ${sfxLanes.length + 1}` }).id
        const clip = engine.addClip({ trackId, type: 'audio', name: asset.name, src: asset.src, assetId: asset.id, startFrame: start, durationFrames: dur })
        engine.updateClip(clip.id, trackId, {
          sourceStartFrame: 0,
          sourceDurationFrames: dur,
          ...(assetFrames !== undefined ? { assetFrames } : {}),
          volume: op.volume ?? 0.6,
          ...(asset.media ? { media: asset.media } : {}),
        })
        created(fresh(clip.id), op.ref)
        return
      }
      case 'addEffect': {
        const clip = find(op.clip)
        if (clip.type === 'audio') skip('audio clips have no picture')
        const e = createEffect(op.kind, op.preset)
        const params = op.params ? (clampEffectParams(op.kind, { ...e.params, ...op.params }) ?? e.params) : e.params
        patch(clip, { effects: [...(clip.effects ?? []), { ...e, params }] })
        return
      }
      case 'applyLook': {
        const clip = find(op.clip)
        if (clip.type === 'audio') skip('audio clips have no picture')
        patch(clip, { effects: [...(clip.effects ?? []), ...bundleEffects(op.look)] })
        return
      }
      case 'setEffectParam': {
        const clip = find(op.clip)
        const effects = clip.effects ?? []
        const target = effects.find((e) => e.id === op.effect) ?? [...effects].reverse().find((e) => e.kind === op.effect)
        if (!target) skip(`"${clip.name}" has no ${op.effect} effect`)
        const params = clampEffectParams(target!.kind, { ...target!.params, [op.param]: op.value })
        if (!params || !(op.param in params)) skip(`${target!.kind} has no "${op.param}"`)
        patch(clip, { effects: effects.map((e) => (e.id === target!.id ? { ...e, params: params! } : e)) })
        return
      }
      case 'removeEffects': {
        const clip = find(op.clip)
        if (!clip.effects?.length) skip(`"${clip.name}" has no effects`)
        patch(clip, { effects: undefined })
        return
      }
      case 'removeEffect': {
        const clip = find(op.clip)
        const effects = clip.effects ?? []
        const byId = effects.filter((e) => e.id === op.effect)
        const hits = byId.length ? byId : effects.filter((e) => e.kind === op.effect)
        if (hits.length === 0) skip(`"${clip.name}" has no "${op.effect}" effect`)
        if (hits.length > 1) skip(`"${clip.name}" has ${hits.length} "${op.effect}" effects; name one by id`)
        const gone = hits[0]!.id
        const kept = effects.filter((e) => e.id !== gone)
        const p: Partial<Clip> = { effects: kept.length ? kept : undefined }
        // The keys that drove the effect go with it (the Inspector's remove does the same).
        const channels = clip.keyframes?.channels
        if (channels) {
          const prefix = `fx.${gone}.`
          const left = Object.fromEntries(Object.entries(channels).filter(([channel]) => !channel.startsWith(prefix)))
          if (Object.keys(left).length !== Object.keys(channels).length) {
            p.keyframes = Object.keys(left).length ? { ...clip.keyframes, channels: left } : undefined
          }
        }
        patch(clip, p)
        return
      }
      case 'setBlend': {
        const clip = find(op.clip)
        patch(clip, { blend: op.blend === 'normal' ? undefined : op.blend })
        return
      }
      case 'setMask': {
        const clip = find(op.clip)
        patch(
          clip,
          op.shape === 'none'
            ? { mask: undefined }
            : {
                mask: {
                  kind: op.shape,
                  x: 0.5,
                  y: 0.5,
                  width: 0.8,
                  height: 0.8,
                  ...(op.feather !== undefined ? { feather: op.feather } : { feather: 0.1 }),
                  ...(op.invert ? { invert: true } : {}),
                },
              },
        )
        return
      }
      case 'addAdjustment': {
        const start = f(op.at)
        const dur = d(op.duration)
        const project = engine.getProject()
        const existing = project.tracks.find(
          (t) => t.kind === 'elements' && t.name === 'Adjustment' && !t.locked && !overlaps(project.clips[t.id] ?? [], start, dur),
        )
        const trackId = existing?.id ?? engine.addTrack('elements', { name: 'Adjustment' }).id
        const clip = engine.addClip({ trackId, type: 'adjustment', name: 'Adjustment', startFrame: start, durationFrames: dur })
        const effects = [...(op.look ? bundleEffects(op.look) : []), ...(op.effects ?? []).map((e) => createEffect(e.kind, e.preset))]
        engine.updateClip(clip.id, trackId, { effects })
        created(fresh(clip.id), op.ref)
        return
      }
      // --- Structure --------------------------------------------------------
        case 'addMarker': {
          engine.addMarker(f(op.at), op.name ? { name: op.name } : undefined)
          widen(f(op.at), 1)
          return
        }
        case 'setMarker': {
          const marker = (engine.getProject().markers ?? []).find((m) => m.id === op.marker) ?? skip(`no marker "${op.marker}"`)
          if (op.remove) {
            engine.removeMarker(marker.id)
            widen(marker.frame, 1)
            return
          }
          engine.updateMarker(marker.id, {
            ...(op.name !== undefined ? { name: op.name } : {}),
            ...(op.color !== undefined ? { color: op.color } : {}),
            ...(op.at !== undefined ? { frame: f(op.at) } : {}),
          })
          widen(op.at !== undefined ? f(op.at) : marker.frame, 1)
          return
        }
        case 'setInOut': {
          if (op.clear) {
            if (!engine.getProject().inOut) skip('there is no in/out range to clear')
            engine.setInOut(null)
            return
          }
          const range = { ...(op.inSec !== undefined ? { in: f(op.inSec) } : {}), ...(op.outSec !== undefined ? { out: f(op.outSec) } : {}) }
          // The engine clears a range that ends at or before its start; say so instead of silently removing the old one.
          const current = engine.getProject().inOut
          const start = range.in ?? current?.in ?? 0
          const stop = range.out ?? current?.out ?? Math.max(1, engine.getTotalFrames())
          if (stop <= start) skip('that in/out range is empty: out must be after in')
          engine.setInOut(range)
          widen(start, stop - start)
          return
        }
        case 'linkClips': {
          const ids = [...new Set(op.clips.map((c) => find(c).id))]
          if (ids.length < 2) skip('linking needs at least two different clips')
          if (!engine.linkClips(ids)) skip('could not link those clips')
          for (const id of ids) if (!added.has(id)) changed.add(id)
          return
        }
        case 'unlinkClips': {
          const clips = op.clips.map((c) => find(c))
          if (!clips.some((c) => c.linkId)) skip('none of those clips is linked')
          engine.unlinkClips(clips.map((c) => c.id))
          for (const c of clips) if (c.linkId && !added.has(c.id)) changed.add(c.id)
          return
        }
        case 'renameClip': {
          const clip = find(op.clip)
          if (clip.name === op.name) skip(`"${clip.name}" already has that name`)
          patch(clip, { name: op.name })
          return
        }
        case 'setTrack': {
          const track = engine.getProject().tracks.find((t) => t.id === op.track) ?? skip(`no track "${op.track}"`)
          if (op.remove) {
            if (track.protected) skip(`track "${track.name}" is protected and cannot be removed`)
            if ((engine.getProject().clips[track.id] ?? []).length > 0) skip('track has clips')
            engine.removeTrack(track.id)
            return
          }
          const updates: Partial<typeof track> = {
            ...(op.name !== undefined ? { name: op.name } : {}),
            ...(op.locked !== undefined ? { locked: op.locked } : {}),
            ...(op.hidden !== undefined ? { disabled: op.hidden } : {}),
            ...(op.muted !== undefined ? { muted: op.muted } : {}),
          }
          if (Object.keys(updates).length === 0) skip('nothing to change')
          engine.updateTrack(track.id, updates)
          return
        }
        // --- Compounds (PV-P1) ---------------------------------------------
        case 'nest': {
          // Each `clips` entry may be a bare id or a `$ref` from earlier in the
          // same plan, so `nest` can build on an op the plan has not run yet.
          const ids = op.clips.map((ref) => (ref.startsWith('$') ? result.refs[ref.slice(1)] : ref))
          if (ids.some((id) => !id)) {
            skip('a clip to nest was not created by an earlier op in this plan')
            return
          }
          // Read the parts BEFORE nesting: once the compound exists the children
          // are gone from the project, and the diff styling still needs their old
          // names and positions.
          const parts = (ids as string[])
            .map((id) => engine.findClip(id))
            .filter((f): f is NonNullable<ReturnType<TimelineEngine['findClip']>> => !!f)
            .map((f) => f.clip)
          // A refusal is reported, never thrown: the rest of the plan still runs,
          // and `touched` is left alone because nothing changed.
          const nested = engine.nestClips(ids as string[], op.name ? { name: op.name } : undefined)
          if (!nested.ok) {
            skip(`cannot nest those clips: ${nested.error.message}`)
            return
          }
          // The compound replaces its parts: the new id is an addition and the
          // children are gone, so both are reported for the diff styling.
          for (const part of parts) {
            if (added.has(part.id)) added.delete(part.id)
            else {
              result.touched.removed.push({
                id: part.id,
                name: part.name,
                trackId: part.trackId,
                startFrame: part.startFrame,
                durationFrames: part.durationFrames,
              })
            }
            changed.delete(part.id)
          }
          added.add(nested.data)
          if (op.ref) result.refs[op.ref] = nested.data
          const made = engine.findClip(nested.data)
          if (made) widen(made.clip.startFrame, made.clip.durationFrames)
          return
        }
        case 'unnest': {
          const compound = find(op.clip)
          if (compound.type !== 'compound') {
            skip(`"${op.clip}" is not a compound`)
            return
          }
          const opened = engine.unnestClip(compound.id)
          if (!opened.ok) {
            // The project is untouched on refusal, so `touched` stays empty for
            // this op — an unsupported un-nest must not look like a partial edit.
            skip(`cannot un-nest that compound: ${opened.error.message}`)
            return
          }
          for (const clipId of opened.data) {
            if (added.has(clipId)) continue
            changed.add(clipId)
          }
          // The compound is gone and its children are back, so the diff styling
          // gets one removal and one set of changes.
          if (added.has(compound.id)) {
            added.delete(compound.id)
          } else {
            result.touched.removed.push({
              id: compound.id,
              name: compound.name,
              trackId: compound.trackId,
              startFrame: compound.startFrame,
              durationFrames: compound.durationFrames,
            })
          }
          changed.delete(compound.id)
          widen(compound.startFrame, compound.durationFrames)
          return
        }
      // --- Composition (PV-P7) --------------------------------------------
      case 'addComposition': {
        const current = engine.getProject().composition ?? { props: [], bindings: [] }
        const props = [...current.props.filter((p) => !op.props.some((n) => n.name === p.name)), ...op.props]
        const bindings = [...current.bindings]
        for (const b of op.bindings ?? []) {
          const [first, ...rest] = b.clip.split('/')
          // `find` resolves a `$ref` (or skips the whole op when it names
          // nothing created earlier in the plan) and never a bare id lookup
          // failure here, since sanitize already checked plain ids exist.
          const root = find(first!)
          const clipId = [root.id, ...rest].join('/')
          const next = { clipId, path: b.path, prop: b.prop, ...(b.template ? { template: b.template } : {}) }
          const i = bindings.findIndex((x) => x.clipId === next.clipId && x.path === next.path)
          if (i >= 0) bindings[i] = next
          else bindings.push(next)
        }
        const r = commitComposition(engine, { props, bindings, ...(current.values ? { values: current.values } : {}) })
        markChanged(r.changedClipIds)
        return
      }
      case 'setProp': {
        const r = commitPropValues(engine, { [op.name]: op.value })
        if (!r.ok) {
          skip(r.issues.find((i) => i.severity === 'error')?.message ?? `"${op.name}" cannot take that value`)
          return
        }
        markChanged(r.changedClipIds)
        return
      }
      // --- Generated graphics (EG-P6) ----------------------------------------
      case 'setComponentField':
      case 'setComponentItems':
        return runComponent(op)
      case 'regenerateElement': {
        // Deferred: writes NOTHING. The target is only checked, so the card can say
        // "no such clip" now rather than after the director has been asked.
        if (isPart(op.clip)) {
          const segs = parseClipPath(op.clip) ?? skip(`"${op.clip}" is not a valid path`)
          const [rootRef, ...tail] = segs
          const root = find(rootRef!)
          const inner = root.type === 'compound' ? root.compound?.project : undefined
          if (!inner) return skip(`"${root.name}" is not a graphic or compound, so it has no parts`)
          const located = locateClip(inner, tail)
          if (!located.ok) return skip(`${located.reason} inside "${root.name}"`)
        } else {
          find(op.clip)
        }
        ;(result.regenerations ??= []).push({ index: -1, clip: op.clip, brief: op.brief })
        return
      }
      case 'removeBackground': {
        // Deferred and PAID (MI-P7b): writes NOTHING. A clip that already has a `matte` is allowed (a re-run);
        // `describeProject` shows the matte so the planner does not ask twice.
        const target = find(op.clip)
        if (target.type !== 'video') skip('removeBackground needs a video clip')
        // The clip's trim window in SOURCE frames. A clip without one reads as 0 and its on-timeline length
        // scaled by speed (the source frames it plays through), never less than 1.
        const speed = target.speed !== undefined && target.speed > 0 ? target.speed : 1
        const sourceStartFrame = Number.isFinite(target.sourceStartFrame) ? Math.max(0, target.sourceStartFrame) : 0
        const sourceDurationFrames =
          Number.isFinite(target.sourceDurationFrames) && target.sourceDurationFrames > 0
            ? target.sourceDurationFrames
            : Math.max(1, Math.round(target.durationFrames * speed))
        ;(result.backgroundRemovals ??= []).push({
          index: -1,
          op,
          clipId: target.id,
          trackId: target.trackId,
          startFrame: target.startFrame,
          durationFrames: target.durationFrames,
          sourceStartFrame,
          sourceDurationFrames,
        })
        return
      }
      // --- Library media ----------------------------------------------------
      case 'insertSourceRange': {
        const asset = ctx.assets?.get(op.asset) ?? skip('that media is not in the library')
        if (asset.kind !== 'video' && asset.kind !== 'audio') skip(`“${asset.name}” is ${asset.kind === 'image' ? 'an image' : 'not video or audio'}, so it has no range to cut`)
        const speed = op.speed ?? 1
        const srcStart = f(op.start)
        const srcDur = d(op.end - op.start)
        const dur = Math.max(1, Math.round(srcDur / speed))
        const kind = asset.kind === 'audio' ? 'audio' : 'video'
        const project = engine.getProject()
        // An overlay keeps off the base lane: the lowest video lane that can take clips.
        const base =
          op.overlay && kind === 'video'
            ? project.tracks.filter((t) => t.kind === 'video' && !t.locked && !RESERVED_LANES.has(t.name)).sort((a, b) => a.order - b.order)[0]?.id
            : undefined
        const usable = project.tracks
          .filter((t) => t.kind === kind && !t.locked && t.id !== base && !RESERVED_LANES.has(t.name))
          .sort((a, b) => a.order - b.order)
        const laneEnd = (id: string) => (project.clips[id] ?? []).reduce((m, c) => Math.max(m, c.startFrame + c.durationFrames), 0)
        // Omitted `at` appends after the last clip of the lane this would go on.
        const start = op.at !== undefined ? f(op.at) : usable[0] ? laneEnd(usable[0].id) : 0
        const trackId = laneFor(engine, kind, start, dur, op.overlay ? 'Overlay' : kind === 'audio' ? 'Audio 1' : 'Video 1', base)
        // The wave-1 cut lands on a fresh lane. The magnetic insert (ripple) is
        // `moveForMode`'s job, and guessing it here would shuffle the user's clips.
        if (isMagneticMain(engine.getProject(), trackId) && (engine.getProject().clips[trackId] ?? []).length > 0) {
          skip('the main track is magnetic; insert there by hand')
        }
        const clip = engine.addClip({
          trackId,
          type: kind,
          name: asset.name,
          src: asset.src,
          assetId: asset.id,
          startFrame: start,
          durationFrames: dur,
        })
        const assetFrames = Number.isFinite(asset.durationSec) && asset.durationSec > 0 ? Math.max(1, Math.round(asset.durationSec * fps)) : undefined
        // One merged clip: the sound travels with the picture (AVM-P3), exactly
        // as the timeline's own drop does (insertAsset `addMediaClip`).
        engine.updateClip(clip.id, trackId, {
          sourceStartFrame: srcStart,
          sourceDurationFrames: srcDur,
          ...(assetFrames !== undefined ? { assetFrames } : {}),
          ...(kind === 'video' ? { embeddedAudio: true } : {}),
          ...(op.mute ? { volume: 0 } : {}),
          ...(speed !== 1 ? { speed } : {}),
          ...(asset.media ? { media: asset.media } : {}),
        })
        created(fresh(clip.id), op.ref)
        return
      }
      case 'addImage': {
        const asset = ctx.assets?.get(op.asset) ?? skip('that media is not in the library')
        if (asset.kind !== 'image') skip(`“${asset.name}” is ${asset.kind === 'video' ? 'a video' : 'audio'}, not an image`)
        if (asset.animated === true) skip(`“${asset.name}” is an animated image; place it from the Media panel`)
        const under = op.under !== undefined ? find(op.under) : undefined
        const span = under ? underSpan(under, op.at !== undefined ? f(op.at) : undefined, op.duration !== undefined ? d(op.duration) : undefined) : undefined
        const dur = span ? span.dur : d(op.duration ?? IMAGE_DEFAULT_SECONDS)
        const project = engine.getProject()
        // An overlay keeps off the base lane, exactly as an overlay insertSourceRange does.
        const base = op.overlay
          ? project.tracks.filter((t) => t.kind === 'video' && !t.locked && !RESERVED_LANES.has(t.name)).sort((a, b) => a.order - b.order)[0]?.id
          : undefined
        const usable = project.tracks.filter((t) => t.kind === 'video' && !t.locked && t.id !== base && !RESERVED_LANES.has(t.name)).sort((a, b) => a.order - b.order)
        const laneEnd = (id: string) => (project.clips[id] ?? []).reduce((m, c) => Math.max(m, c.startFrame + c.durationFrames), 0)
        const start = span ? span.start : op.at !== undefined ? f(op.at) : usable[0] ? laneEnd(usable[0].id) : 0
        const trackId = under ? laneUnder(engine, under, 'Background') : laneFor(engine, 'video', start, dur, op.overlay ? 'Overlay' : 'Video 1', base)
        if (!under && isMagneticMain(engine.getProject(), trackId) && (engine.getProject().clips[trackId] ?? []).length > 0) {
          skip('the main track is magnetic; insert there by hand')
        }
        const clip = engine.addClip({ trackId, type: 'image', name: asset.name, src: asset.src, assetId: asset.id, startFrame: start, durationFrames: dur })
        created(fresh(clip.id), op.ref)
        return
      }
      case 'insertVector': {
        // AGN-P23: `clip` is the SVG's own shapes, built by the web layer's resolver. None = never resolved: skip.
        // Never fall back to the asset as a flat picture; the resolver decides that, and says so.
        const vec = op.clip ?? skip('this vector was never read from its SVG, so there are no shapes to place')
        if (vec.type !== 'shape' && vec.type !== 'compound') skip('the resolved vector is not a shape')
        const dur = Math.max(1, vec.durationFrames)
        const start = op.at !== undefined ? f(op.at) : Math.max(0, ctx.playheadFrame ?? 0)
        const trackId = laneFor(engine, 'elements', start, dur, VECTOR_TRACK)
        let added: Clip
        if (vec.type === 'compound') {
          if (!vec.compound) skip('the resolved vector has no shapes')
          added = engine.addClip({ trackId, type: 'compound', name: vec.name, startFrame: start, durationFrames: dur, compound: vec.compound! })
        } else {
          added = engine.addClip({
            trackId,
            type: 'shape',
            name: vec.name,
            startFrame: start,
            durationFrames: dur,
            opacity: vec.opacity,
            ...(vec.transform !== undefined ? { transform: vec.transform } : {}),
            shape: {
              shapeKind: vec.shapeKind!,
              ...(vec.shapeFill !== undefined ? { shapeFill: vec.shapeFill } : {}),
              ...(vec.shapeStroke !== undefined ? { shapeStroke: vec.shapeStroke } : {}),
              ...(vec.shapeStrokeWidth !== undefined ? { shapeStrokeWidth: vec.shapeStrokeWidth } : {}),
              ...(vec.cornerRadius !== undefined ? { cornerRadius: vec.cornerRadius } : {}),
              ...(vec.shapeSides !== undefined ? { shapeSides: vec.shapeSides } : {}),
              ...(vec.shapeInnerRatio !== undefined ? { shapeInnerRatio: vec.shapeInnerRatio } : {}),
              ...(vec.shapeArrowHead !== undefined ? { shapeArrowHead: vec.shapeArrowHead } : {}),
              ...(vec.shapePath !== undefined ? { shapePath: vec.shapePath } : {}),
              ...(vec.shapeViewBox !== undefined ? { shapeViewBox: vec.shapeViewBox } : {}),
              ...(vec.shapeFillRule !== undefined ? { shapeFillRule: vec.shapeFillRule } : {}),
              ...(vec.shapeFillPaint !== undefined ? { shapeFillPaint: vec.shapeFillPaint } : {}),
              ...(vec.shapeStrokePaint !== undefined ? { shapeStrokePaint: vec.shapeStrokePaint } : {}),
              ...(vec.shapeStrokeDash !== undefined ? { shapeStrokeDash: vec.shapeStrokeDash } : {}),
              ...(vec.shapeStrokeDashOffset !== undefined ? { shapeStrokeDashOffset: vec.shapeStrokeDashOffset } : {}),
              ...(vec.shapeStrokeCap !== undefined ? { shapeStrokeCap: vec.shapeStrokeCap } : {}),
              ...(vec.shapeStrokeJoin !== undefined ? { shapeStrokeJoin: vec.shapeStrokeJoin } : {}),
              ...(vec.shapeStrokeAlign !== undefined ? { shapeStrokeAlign: vec.shapeStrokeAlign } : {}),
            },
          })
        }
        const patch: Partial<Clip> = {}
        if (vec.type === 'compound') {
          if (vec.transform !== undefined) patch.transform = vec.transform
          if (vec.opacity !== undefined) patch.opacity = vec.opacity
        }
        if (vec.sourceStartFrame !== undefined) patch.sourceStartFrame = vec.sourceStartFrame
        if (vec.sourceDurationFrames !== undefined) patch.sourceDurationFrames = vec.sourceDurationFrames
        if (vec.keyframes !== undefined) patch.keyframes = vec.keyframes
        if (vec.blend !== undefined) patch.blend = vec.blend
        if (Object.keys(patch).length > 0) engine.updateClip(added.id, trackId, patch)
        created(fresh(added.id), op.ref)
        return
      }
      case 'insertScene': {
        // MC-2a: `clip` is the converted scene (one compound), built by the web layer's `write_scene`. None = skip.
        const scene = op.clip ?? skip('this scene was never converted, so there is nothing to place')
        if (scene.type !== 'compound' || !scene.compound) skip('the converted scene is not a compound')
        const dur = Math.max(1, scene.durationFrames)
        const start = op.at !== undefined ? f(op.at) : Math.max(0, ctx.playheadFrame ?? 0)
        const trackId = laneFor(engine, 'elements', start, dur, SCENE_TRACK)
        const added = engine.addClip({ trackId, type: 'compound', name: scene.name, startFrame: start, durationFrames: dur, compound: scene.compound! })
        const patch: Partial<Clip> = {}
        if (scene.transform !== undefined) patch.transform = scene.transform
        if (scene.opacity !== undefined) patch.opacity = scene.opacity
        if (scene.keyframes !== undefined) patch.keyframes = scene.keyframes
        if (scene.blend !== undefined) patch.blend = scene.blend
        if (scene.scene !== undefined) patch.scene = scene.scene
        if (Object.keys(patch).length > 0) engine.updateClip(added.id, trackId, patch)
        created(fresh(added.id), op.ref)
        return
      }
      // --- Generation -------------------------------------------------------
      case 'generateMedia': {
        const start = f(op.at)
        const dur = d(op.duration)
        const trackId = laneFor(engine, 'video', start, dur, ASSISTANT_MEDIA_TRACK)
        const placeholder = engine.addClip({
          trackId,
          type: 'generator',
          name: `Generating ${op.media}: ${op.prompt.slice(0, 40)}${ctx.placeholderTag ? ` ${ctx.placeholderTag(op)}` : ''}`,
          startFrame: start,
          durationFrames: dur,
          generator: createGenerator('gradientBackground', { colorA: '#20242c', colorB: '#3a4150', angle: 90, spin: 20 }),
        })
        created(fresh(placeholder.id), op.ref)
        result.deferred.push({ index: -1, op, placeholderClipId: placeholder.id, trackId, startFrame: start, durationFrames: dur })
        return
      }
    }
  }

  engine.batch(() => {
    ops.forEach((op, index) => {
      try {
        run(op)
        result.applied.push(index)
        const last = result.deferred[result.deferred.length - 1]
        if (last && last.index === -1) last.index = index
        const regen = result.regenerations?.[result.regenerations.length - 1]
        if (regen && regen.index === -1) regen.index = index
        const bgRemoval = result.backgroundRemovals?.[result.backgroundRemovals.length - 1]
        if (bgRemoval && bgRemoval.index === -1) bgRemoval.index = index
      } catch (err) {
        const reason = err instanceof Skip ? err.message : err instanceof Error ? err.message : 'could not apply'
        result.skipped.push({ index, reason })
      }
    })
  }, ctx.description ?? 'Assistant edit')

  result.touched.added = [...added].filter((id) => engine.findClip(id))
  result.touched.changed = [...changed].filter((id) => engine.findClip(id) && !added.has(id))
  return result
}
