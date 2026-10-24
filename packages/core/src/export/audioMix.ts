/**
 * The export audio mix's pure math (PV-P10a).
 *
 * Everything here is deterministic and Web-Audio-free: no `OfflineAudioContext`,
 * no `AudioBuffer`. `exportVideo.ts`'s `renderAudioMix` is the one caller that
 * turns this into real graph nodes; a test can assert the numbers directly.
 *
 * `scheduleAudioClip` answers "when, from where, for how long" a source plays
 * (`AudioBufferSourceNode.start(when, offset, duration)`'s three arguments,
 * plus `playbackRate`). `gainAutomation` answers "how loud, over time" as a
 * list of `AudioParam` calls: the clip's volume keyframes (or its static
 * `clip.volume`) sampled once per timeline frame with the SAME sampler the
 * preview uses (`resolver/keyframes.ts`'s `sampleKeyframes`), multiplied by
 * every ancestor compound's already-folded gain and this clip's own track
 * volume — never the master gain, which `renderAudioMix` applies once, on one
 * shared node, outside any single clip's automation.
 *
 * A project that uses none of this — no keys, no track volume, no master
 * volume, no solo, the whole timeline as the range — produces exactly one
 * `set` event per clip at its unchanged `clip.volume ?? 1`, and the same
 * `start()` arguments export always used. That is the identity invariant
 * every test in this file that doesn't touch keys/volume/solo is pinned to.
 */

import type { Clip, Project, Track } from '../types'
import { getTotalFrames } from '../utils/frames'
import { normalizeKeys, sampleKeyframes, typeDefaultTransform } from '../resolver/keyframes'
import { createExpressionContext } from '../resolver/expr/channels'
import type { ExpressionError } from '../resolver/expr/scope'
import { clipAudioGain, hasAudioEnvelopeShape } from '../audio/clipAudio'

/** Absolute timeline frames the mix covers; `endFrame` exclusive. Context time 0 = `startFrame`. */
export interface AudioMixRange {
  startFrame: number
  endFrame: number
}

/** One automation call on a GainNode's `gain`, in context seconds. */
export type GainEvent =
  | { kind: 'set'; time: number; value: number } // setValueAtTime(value, time)
  | { kind: 'ramp'; time: number; value: number } // linearRampToValueAtTime(value, time)

/** Arguments for `AudioBufferSourceNode.start(when, offset, duration)` plus its rate. */
export interface AudioClipSchedule {
  /** Context seconds the node starts. */
  when: number
  /** Buffer seconds to start from. */
  offset: number
  /** Buffer seconds to play. Web Audio counts this in buffer time, independent of playbackRate. */
  duration: number
  playbackRate: number
}

/** The part of AudioParam the applier calls, so tests can record calls. */
export interface GainParamLike {
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
}

/** Second-difference tolerance under which a sample lies on the line through its neighbours. */
export const GAIN_EPSILON = 1e-6

/** `{ startFrame: 0, endFrame: getTotalFrames(project.clips) }`. */
export function fullMixRange(project: Pick<Project, 'clips'>): AudioMixRange {
  return { startFrame: 0, endFrame: getTotalFrames(project.clips) }
}

/** Absolute frames of the clip that sound inside `range`; null when none. */
export function audibleSpan(clip: Clip, range: AudioMixRange, offsetFrames = 0): AudioMixRange | null {
  const clipStart = offsetFrames + clip.startFrame
  const clipEnd = clipStart + clip.durationFrames
  const startFrame = Math.max(clipStart, range.startFrame)
  const endFrame = Math.min(clipEnd, range.endFrame)
  if (endFrame <= startFrame) return null
  return { startFrame, endFrame }
}

export function scheduleAudioClip(
  clip: Clip,
  fps: number,
  range: AudioMixRange,
  offsetFrames = 0,
): AudioClipSchedule | null {
  const span = audibleSpan(clip, range, offsetFrames)
  if (!span) return null
  const clipStart = offsetFrames + clip.startFrame
  const playbackRate = clip.speed ?? 1
  // Timeline frames trimmed from the clip's own front by the range/window.
  const head = span.startFrame - clipStart
  const overlapFrames = span.endFrame - span.startFrame
  return {
    when: (span.startFrame - range.startFrame) / fps,
    offset: (clip.sourceStartFrame + head * playbackRate) / fps,
    duration: (overlapFrames * playbackRate) / fps,
    playbackRate,
  }
}

/** Nested-entry metadata `flattenAudioClips` (PV-P1a) attaches to a cropped copy. */
export interface GainAutomationAncestry {
  /** The clip as authored, before the walker's crop/gain-fold. */
  originalClip: Clip
  /** Frames trimmed from the ORIGINAL clip's own front by the ancestor compound's window. */
  localFrameOffset: number
  /** Every ancestor compound's volume × its own track volume, already multiplied together. */
  ancestorGain: number
}

const volumeTrack = (clip: Clip) => clip.keyframes?.channels?.volume

function hasUsableVolumeKeys(clip: Clip): boolean {
  const track = volumeTrack(clip)
  return track ? normalizeKeys(track.keys).length > 0 : false
}

function isVolumeExpression(clip: Clip): boolean {
  return volumeTrack(clip)?.source?.kind === 'expression'
}

/**
 * The gain automation for one clip: keyed volume (or `clip.volume`) × every
 * ancestor's already-folded gain × this clip's own track gain, sampled at
 * every timeline frame the clip is actually audible in `range`.
 *
 * `automation` carries the metadata `flattenAudioClips` attaches to a nested
 * (cropped) entry: sampling reads `automation.originalClip`'s keys/expression
 * at the ORIGINAL clip's own local frame (`f - clipStart + localFrameOffset`),
 * never the cropped copy's frame 0 — a crop must not restart the animation —
 * and multiplies by `automation.ancestorGain` once, on top of this clip's own
 * `track` gain, never twice (the walker already folded ancestor gain into
 * nothing here; this function is the one place that applies it).
 *
 * `owningProject` is required only when the source clip's volume channel is an
 * expression (so `prop()`/`audio()` resolve against the right composition); a
 * caller that never passes an expression-driven clip may omit it.
 */
export function gainAutomation(
  clip: Clip,
  track: Track,
  fps: number,
  range: AudioMixRange,
  offsetFrames = 0,
  automation?: GainAutomationAncestry,
  owningProject?: Project,
  onExpressionIssue?: (issue: ExpressionError) => void,
): GainEvent[] {
  const span = audibleSpan(clip, range, offsetFrames)
  if (!span) return []

  const clipStart = offsetFrames + clip.startFrame
  const trackGain = track.muted ? 0 : (track.volume ?? 1)
  const source = automation?.originalClip ?? clip
  const ancestorGain = automation?.ancestorGain ?? 1
  const localFrameOffset = automation?.localFrameOffset ?? 0

  const hasKeys = hasUsableVolumeKeys(source)
  const hasExpr = isVolumeExpression(source)

  const timeOf = (f: number) => (f - range.startFrame) / fps

  // The clip's own mute/boost/fades (audio/clipAudio.ts), sampled at the
  // ORIGINAL clip's local frame like the keys; the preview applies the same.
  const envelopeAt = (local: number) => clipAudioGain(source, local, fps)
  const shaped = hasAudioEnvelopeShape(source, fps)

  if (!hasKeys && !hasExpr && !shaped) {
    const value = (source.volume ?? 1) * ancestorGain * trackGain * envelopeAt(0)
    return [{ kind: 'set', time: timeOf(span.startFrame), value }]
  }

  if (hasExpr && !owningProject) {
    throw new Error(
      'gainAutomation: the volume channel is an expression, which needs owningProject to resolve prop()/audio()',
    )
  }

  const base = source.transform ?? typeDefaultTransform(source.type)
  const seenIssues = new Set<string>()
  const n = span.endFrame - span.startFrame
  const values: number[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const f = span.startFrame + i
    const local = f - clipStart + localFrameOffset
    if (!hasKeys && !hasExpr) {
      values[i] = (source.volume ?? 1) * ancestorGain * trackGain * envelopeAt(local)
      continue
    }
    let expr
    let ctx: ReturnType<typeof createExpressionContext> | undefined
    if (hasExpr) {
      // One expression context PER FRAME — createExpressionContext's `frame`
      // argument is what a default audio() hook samples against, so it has to
      // be this frame's own absolute frame in the OWNING project, not the
      // clip's local frame or the leaf project's frame.
      ctx = createExpressionContext(owningProject!, source.startFrame + local)
      expr = ctx.evaluatorFor(source, local, base)
    }
    // `evaluatorFor` only BUILDS the evaluator closure; the actual parse/
    // evaluate — and any report() call — happens when `sampleKeyframes` below
    // invokes it per channel. Reading `ctx.errors` before that call would
    // always see an empty list.
    const sample = sampleKeyframes(source.keyframes, local, base, expr)
    if (ctx && onExpressionIssue) {
      for (const issue of ctx.errors) {
        const key = `${issue.clipId}|${issue.channel}|${issue.code}`
        if (seenIssues.has(key)) continue
        seenIssues.add(key)
        onExpressionIssue(issue)
      }
    }
    const raw = sample.volume ?? source.volume ?? 1
    values[i] = raw * ancestorGain * trackGain * envelopeAt(local)
  }

  return compressToEvents(values, span.startFrame, range.startFrame, fps)
}

/**
 * Per-frame samples → the fewest `set`/`ramp` calls that reproduce them: keep
 * the first and last sample and any sample whose second difference against its
 * neighbours exceeds `GAIN_EPSILON` (a "kink" — everything colinear between
 * kinks collapses to one ramp), then drop a trailing run of samples that all
 * equal the last kept value (a flat tail needs only its first point).
 */
function compressToEvents(values: number[], startFrame: number, rangeStart: number, fps: number): GainEvent[] {
  const n = values.length
  if (n === 0) return []
  const timeOf = (idx: number) => (startFrame + idx - rangeStart) / fps

  const keepIdx: number[] = [0]
  for (let i = 1; i < n - 1; i++) {
    const d = values[i + 1]! - 2 * values[i]! + values[i - 1]!
    if (Math.abs(d) > GAIN_EPSILON) keepIdx.push(i)
  }
  if (n > 1) keepIdx.push(n - 1)

  while (
    keepIdx.length > 1 &&
    values[keepIdx[keepIdx.length - 1]!] === values[keepIdx[keepIdx.length - 2]!]
  ) {
    keepIdx.pop()
  }

  return keepIdx.map((idx, order) => {
    const value = values[idx]!
    const time = timeOf(idx)
    return order === 0 ? { kind: 'set' as const, time, value } : { kind: 'ramp' as const, time, value }
  })
}

/** In order: `set` → `param.setValueAtTime(value, time)`; `ramp` → `param.linearRampToValueAtTime(value, time)`. */
export function applyGainEvents(param: GainParamLike, events: ReadonlyArray<GainEvent>): void {
  for (const e of events) {
    if (e.kind === 'set') param.setValueAtTime(e.value, e.time)
    else param.linearRampToValueAtTime(e.value, e.time)
  }
}

/**
 * `resolveTimeline`'s audio rule: disabled or muted → false; when any AUDIO
 * track in `tracks` is solo, only solo tracks → true.
 */
export function isAudioTrackAudible(track: Track, tracks: ReadonlyArray<Track>): boolean {
  return isClipAudioAudible(track, tracks)
}

/**
 * True when any solo'd track can make sound: an `audio` lane, or a `video`
 * lane (a merged clip's own sound lives on a video lane). Elements lanes never
 * count. Picture solo keeps its own per-kind rule in `resolveTimeline`, so
 * soloing an audio lane never blanks the stage.
 */
export function hasAudibleSolo(tracks: ReadonlyArray<Track>): boolean {
  return tracks.some((t) => t.solo === true && (t.kind === 'audio' || t.kind === 'video'))
}

/**
 * The solo half of "is this lane heard" (mute is separate: a muted lane still
 * emits into the scene, at volume 0). An `audio` lane keeps its historical
 * per-kind rule - only a solo'd AUDIO lane silences it, so soloing a video lane
 * never mutes a plain audio lane. Any other lane (a merged clip's sound lives
 * on a video lane) is silenced by a solo on an audio OR a video lane.
 */
export function passesAudioSolo(track: Track, tracks: ReadonlyArray<Track>): boolean {
  if (track.solo === true) return true
  if (track.kind === 'audio') return !tracks.some((t) => t.kind === 'audio' && t.solo)
  return !hasAudibleSolo(tracks)
}

/**
 * Whether a clip on `track` is heard: disabled or muted -> false, else
 * `passesAudioSolo`. The one rule behind both the preview scene
 * (`resolveTimeline`, which uses the solo half) and the export mix
 * (`exportVideo`), so they cannot drift.
 */
export function isClipAudioAudible(track: Track, tracks: ReadonlyArray<Track>): boolean {
  if (track.disabled || track.muted) return false
  return passesAudioSolo(track, tracks)
}

// --- REN-6: time-sliced offline rendering ------------------------------------

/** Web Audio renders in blocks of this many frames; `suspend()` times snap to it. */
export const AUDIO_RENDER_QUANTUM = 128
/** Seconds of audio rendered between two yields to the main thread. */
export const AUDIO_SLICE_SECONDS = 5

/**
 * Suspend points (context seconds) that split a render of `lengthFrames` into
 * slices of about `sliceSeconds`. Every point is a whole number of render
 * quanta (so `suspend()` does not round it, and two points never collide),
 * strictly inside `(0, lengthFrames)`, and strictly increasing. A render
 * shorter than one slice has none.
 */
export function planAudioSlices(
  lengthFrames: number,
  sampleRate: number,
  sliceSeconds = AUDIO_SLICE_SECONDS,
): number[] {
  const step = Math.max(1, Math.round((sliceSeconds * sampleRate) / AUDIO_RENDER_QUANTUM)) * AUDIO_RENDER_QUANTUM
  const points: number[] = []
  for (let f = step; f < lengthFrames; f += step) points.push(f / sampleRate)
  return points
}

/** The part of `OfflineAudioContext` slicing needs, so a test can fake it. */
export interface SliceableOfflineContext<R> {
  length: number
  sampleRate: number
  startRendering(): Promise<R>
  suspend?: (time: number) => Promise<void>
  resume?: () => Promise<void>
}

/** One macrotask turn, so input, paint and the export progress callbacks can run. */
export const yieldToMainThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * `ctx.startRendering()` in time slices. `suspend(t)` pauses the render at a
 * quantum boundary without altering any sample, so the output equals the
 * unsliced render exactly; between slices the main thread gets a turn.
 * A context without `suspend`/`resume` (or one that rejects them) renders in
 * one go, exactly as before.
 */
export async function renderInSlices<R>(
  ctx: SliceableOfflineContext<R>,
  options: { sliceSeconds?: number; yieldFn?: () => Promise<void> } = {},
): Promise<R> {
  const yieldFn = options.yieldFn ?? yieldToMainThread
  if (typeof ctx.suspend === 'function' && typeof ctx.resume === 'function') {
    for (const time of planAudioSlices(ctx.length, ctx.sampleRate, options.sliceSeconds)) {
      try {
        void ctx.suspend(time).then(async () => {
          await yieldFn()
          await ctx.resume!()
        }).catch(() => undefined)
      } catch {
        break // a legacy callback-style suspend: fall back to what is registered
      }
    }
  }
  return ctx.startRendering()
}
