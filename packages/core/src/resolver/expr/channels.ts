/**
 * Expressions, wired to clips and channels (PV-P5b-2).
 *
 * PV-P5b-1 built a language; this is the one place that knows a document can
 * contain one. The resolver asks for a hook per clip and calls it per channel;
 * everything about parsing, evaluating and reporting lives here so no other
 * module has to know expressions exist.
 *
 * Two decisions shape the whole file:
 *
 *  - **One context per resolve, one env per clip.** `createExpressionContext` is
 *    called once per `resolveTimeline`, not once per channel, because the error
 *    list has to be deduplicated across the whole frame and `clipView` memoises
 *    against it.
 *  - **A clip view never sees expressions.** `clip("other")` is sampled with the
 *    hook omitted, so an expression cannot read another clip's expression. That
 *    is what makes chains and cycles structurally impossible rather than
 *    merely unlikely.
 *
 * DOM-free, like the rest of `resolver/`: the export worker reaches this through
 * `resolveTimeline`.
 */

import { propReaderFor } from '../../composition'
import { audioValueAt } from '../../audio/markers'
import { getEffectDefinition } from '../../effects/registry'
import {
  isExpressionChannel,
  normalizeKeys,
  parseEffectChannel,
  parseGeneratorChannel,
  sampleChannel,
  sampleKeyframes,
  typeDefaultTransform,
  type ChannelExpression,
} from '../keyframes'
import { evaluateExpression } from './evaluate'
import { parseExpression } from './parse'
import type { ExprClipView, ExprEnv, ExpressionError } from './scope'
import { seedFor } from './scope'
import type { AnyKeyframeChannel, Clip, KeyframeChannelTrack, Project, Transform } from '../../types'

/** `prop()` / `audio()` data, supplied by whoever can answer them (P7a, P10b). */
export interface ExpressionHooks {
  prop?(name: string): number | string | undefined
  audio?(name: string): number | undefined
}

export interface ExpressionContext {
  /** Problems found during this resolve, in the order found; one per clip + channel + code. */
  readonly errors: ExpressionError[]
  /**
   * The hook for sampleKeyframes/sampleExtendedChannels, or `undefined` when the
   * clip has no expression channel. Returning undefined for that case is the
   * whole fast path: a project with no expressions pays one `Object.keys` scan
   * per clip and nothing else.
   */
  evaluatorFor(clip: Clip, localFrame: number, base: Transform): ChannelExpression | undefined
  /** `clip("ref")` — by id first, then the first clip with that exact name in
   *  `project.tracks` order. */
  clipView(ref: string): ExprClipView | undefined
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

export function createExpressionContext(
  project: Project,
  frame: number,
  hooks: ExpressionHooks = {},
): ExpressionContext {
  const fps = project.fps > 0 ? project.fps : 30
  const errors: ExpressionError[] = []
  // One error per clip + channel + code. A bad expression is reported once for
  // the frame, not once per sampler that happens to read the channel — the
  // generator branch and the visual branch both sample, and a user must not see
  // the same message twice.
  const seen = new Set<string>()
  // PV-P7a-2: an explicit hook always wins. Absent one, a project's own
  // composition (if it has one) answers prop(); computed once per resolve, not
  // once per clip, and memoised across resolves by propReaderFor itself.
  const prop = hooks.prop ?? propReaderFor(project)
  // PV-P10b-3: same precedence for audio() — an explicit hook always wins;
  // absent one, a project with audioMarkers answers from its own analysis.
  // `audioValueAt` memoises its own per-project index, so this costs nothing
  // extra per clip.
  const audio = hooks.audio ?? (project.audioMarkers?.length ? (name: string) => audioValueAt(project, frame, name) : undefined)

  const report = (clipId: string, channel: string, code: ExpressionError['code'], message: string, pos?: number) => {
    const key = `${clipId}|${channel}|${code}`
    if (seen.has(key)) return
    seen.add(key)
    errors.push({ clipId, channel, code, message, ...(pos !== undefined && { pos }) })
  }

  // --- clip(...) views -------------------------------------------------------

  let byId: Map<string, Clip> | undefined
  let byName: Map<string, Clip> | undefined
  const views = new Map<string, ExprClipView | null>()

  const index = (): void => {
    if (byId) return
    byId = new Map()
    byName = new Map()
    for (const track of project.tracks) {
      for (const clip of project.clips[track.id] ?? []) {
        if (!byId.has(clip.id)) byId.set(clip.id, clip)
        // First clip wins, in tracks order: two clips may share a name, and
        // "the first one" is a rule a reader can predict.
        if (!byName.has(clip.name)) byName.set(clip.name, clip)
      }
    }
  }

  const clipView = (ref: string): ExprClipView | undefined => {
    const memo = views.get(ref)
    if (memo !== undefined) return memo ?? undefined
    index()
    const c = byId!.get(ref) ?? byName!.get(ref)
    if (!c) {
      views.set(ref, null)
      return undefined
    }
    const local = Math.min(Math.max(0, frame - c.startFrame), Math.max(0, c.durationFrames - 1))
    const b = c.transform ?? typeDefaultTransform(c.type)
    // No `expr` hook: a view is the clip's KEYED rest. Chaining expressions
    // would make evaluation order observable and could recurse.
    const s = sampleKeyframes(c.keyframes, local, b)
    const tr = s.transform ?? b
    const view: ExprClipView = {
      x: tr.x,
      y: tr.y,
      scale: tr.scale,
      scaleX: tr.scaleX ?? 1,
      scaleY: tr.scaleY ?? 1,
      rotation: tr.rotation,
      opacity: s.opacity ?? c.opacity ?? 1,
      start: c.startFrame / fps,
      duration: c.durationFrames / fps,
    }
    views.set(ref, view)
    return view
  }

  // --- the per-clip hook -----------------------------------------------------

  const evaluatorFor = (clip: Clip, localFrame: number, base: Transform): ChannelExpression | undefined => {
    const channels = clip.keyframes?.channels
    if (!channels) return undefined

    // 1. Which channels are expressions? Built once per clip per resolve, and
    //    reused by every call to the returned hook.
    const sources = new Map<AnyKeyframeChannel, string>()
    for (const name of Object.keys(channels)) {
      const track = channels[name as AnyKeyframeChannel] as KeyframeChannelTrack | undefined
      const source = track?.source
      if (source?.kind !== 'expression') continue
      if (typeof source.source !== 'string') continue
      // 2. A stored expression on a channel that may not have one is a document
      //    defect, not a crash: report it once and skip the channel.
      if (!isExpressionChannel(name)) {
        report(clip.id, name, 'unsupported-channel', `Expressions cannot drive ${name}`)
        continue
      }
      sources.set(name, source.source)
    }
    if (sources.size === 0) return undefined

    // 3. ONE env for the clip. It is mutated per channel (`value`) rather than
    //    rebuilt, because a 200-clip frame allocates 200 envs and this is the
    //    hot path the cost measurement is about.
    const env: ExprEnv = {
      t: localFrame / fps,
      frame: localFrame,
      fps,
      duration: clip.durationFrames / fps,
      progress:
        clip.durationFrames > 1
          ? clamp01(localFrame / (clip.durationFrames - 1))
          : 0,
      value: 0,
      stage: project.stage,
      clip: clipView,
      ...(prop ? { prop } : {}),
      ...(audio ? { audio } : {}),
    }

    // One report closure per channel, created once: a fresh arrow per call would
    // allocate per channel per frame for no benefit.
    const reporters = new Map<AnyKeyframeChannel, (code: ExpressionError['code'], message: string) => void>()
    const reporterFor = (channel: AnyKeyframeChannel) => {
      let r = reporters.get(channel)
      if (!r) {
        r = (code, message) => report(clip.id, channel, code, message)
        reporters.set(channel, r)
      }
      return r
    }

    return (channel, keyed) => {
      const source = sources.get(channel)
      if (source === undefined) return undefined
      const parsed = parseExpression(source)
      if (!parsed.ok) {
        report(clip.id, channel, parsed.code, parsed.message, parsed.pos)
        return undefined
      }
      env.value = keyed ?? authoredChannelValue(clip, channel, base)
      const r = evaluateExpression(parsed.ast, {
        env,
        seed: seedFor(clip.id, channel),
        report: reporterFor(channel),
      })
      if (!r.ok) {
        report(clip.id, channel, r.code, r.message, r.pos)
        return undefined
      }
      return r.value
    }
  }

  return { errors, evaluatorFor, clipView }
}

/**
 * A channel's AUTHORED value — the writer's default, mirrored here so the
 * resolver never has to import `elements/` (which would be a cycle: the writers
 * call the samplers this file's callers use).
 *
 * This is what an expression's `value` reads on a channel with no keys, so it
 * has to agree with `currentChannelValue`/`currentExtendedValue` exactly. The
 * `channels.test.ts` case that compares them is what keeps it honest.
 */
export function authoredChannelValue(clip: Clip, channel: AnyKeyframeChannel, base: Transform): number {
  switch (channel) {
    case 'x':
    case 'y':
    case 'scale':
    case 'rotation':
      return base[channel]
    case 'scaleX':
    case 'scaleY':
      return base[channel] ?? 1
    case 'opacity':
      return clip.opacity ?? 1
    case 'volume':
      return clip.volume ?? 1
    case 'cornerRadius':
      return clip.cornerRadius ?? 0
  }

  const fx = parseEffectChannel(channel)
  if (fx) {
    const stored = clip.effects?.find((e) => e.id === fx.effectId)?.params[fx.param]
    if (typeof stored === 'number') return stored
    // The registry default, so an effect parameter with no stored value reads
    // the same before and after an expression is added.
    const def = getEffectDefinition(clip.effects?.find((e) => e.id === fx.effectId)?.kind ?? '')
    const fallback = def?.params[fx.param]?.default
    return typeof fallback === 'number' ? fallback : 0
  }

  if (channel.startsWith('mask.')) {
    const stored = (clip.mask as Record<string, unknown> | undefined)?.[channel.slice(5)]
    if (typeof stored === 'number') return stored
    // width/height default to 1 (a full-size mask); position, rotation and
    // feather default to 0.
    return channel === 'mask.width' || channel === 'mask.height' ? 1 : 0
  }

  // `gen.<param>` addresses a param of the clip's one generator; the resolver
  // treats the sampled extended channels as a params overlay over it
  // (`clampGeneratorParams`), so a clip contributes at most one recipe.
  const genParam = parseGeneratorChannel(channel)
  if (genParam !== undefined) {
    const stored = clip.generator?.params?.[genParam]
    return typeof stored === 'number' ? stored : 0
  }

  return 0
}

/**
 * One channel's expression output at a clip-local frame, for the UI (panel rows,
 * the drawer's expression curve). Returns `{}` when the channel has no
 * expression, so a caller can tell "not an expression channel" from "evaluated
 * to nothing".
 */
export function sampleChannelExpression(
  project: Project,
  clip: Clip,
  channel: AnyKeyframeChannel,
  localFrame: number,
): { value?: number; error?: ExpressionError } {
  const track = clip.keyframes?.channels?.[channel]
  if (track?.source?.kind !== 'expression') return {}
  const ctx = createExpressionContext(project, clip.startFrame + localFrame)
  const base = clip.transform ?? typeDefaultTransform(clip.type)
  const ev = ctx.evaluatorFor(clip, localFrame, base)
  const keyed = sampleChannel(normalizeKeys(track.keys), localFrame)
  const v = ev?.(channel, keyed)
  const error = ctx.errors.find((e) => e.channel === channel)
  return { ...(v !== undefined && { value: v }), ...(error && { error }) }
}
