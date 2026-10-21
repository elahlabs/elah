/**
 * Volume-key mixing helpers (CHAT-5a): the pure maths behind the `crossfadeCuts` and `duckUnder` ops. Like every
 * writer in `elements/` they return a `Partial<Clip>` patch of ordinary `volume` keyframes (no engine, no new
 * channel), so preview, export, undo and save already handle the result.
 *
 * Keys on `volume` REPLACE the clip's static volume wherever they apply, so every value written here is sampled
 * from the clip as it stands (its existing keys, else `clip.volume ?? 1`) and the new keys are added on top.
 */

import type { Clip } from '../types'
import { normalizeKeys, sampleChannel } from '../resolver/keyframes'
import { removeKeyframe, setKeyframe, type BaselineContext } from './keyframes'

export const DUCK_DEFAULT_DB = -12
export const DUCK_DEFAULT_ATTACK_SEC = 0.15
export const DUCK_DEFAULT_RELEASE_SEC = 0.4
export const CROSSFADE_DEFAULT_MS = 10
/** A join is two audio clips whose gap is at most this many frames. */
export const JOIN_MAX_GAP_FRAMES = 1

/** Linear gain for a level in decibels: -12 dB is about 0.25. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

/** A clip that makes sound: an audio clip, or a video clip carrying its own audio (merged A/V). */
export function isAudioBearing(clip: Pick<Clip, 'type' | 'embeddedAudio'>): boolean {
  return clip.type === 'audio' || (clip.type === 'video' && clip.embeddedAudio === true)
}

/** Whether the clip's volume is driven by an expression, which keys cannot sit on top of. */
export function hasVolumeExpression(clip: Clip): boolean {
  return clip.keyframes?.channels?.volume?.source?.kind === 'expression'
}

/** The clip's volume at clip-local `frame`: its keys when it has any, else `clip.volume ?? 1`. */
export function volumeAt(clip: Clip, frame: number): number {
  const keys = normalizeKeys(clip.keyframes?.channels?.volume?.keys)
  const keyed = keys.length > 0 ? sampleChannel(keys, frame) : undefined
  const v = keyed ?? clip.volume ?? 1
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

/** Write `volume` keys `[frame, value]` onto `clip`, replacing a key on the same frame. */
function writeKeys(clip: Clip, keys: ReadonlyArray<readonly [number, number]>, ctx: BaselineContext): Partial<Clip> {
  let working = clip
  let patch: Partial<Clip> = {}
  for (const [frame, value] of keys) {
    const p = setKeyframe(working, 'volume', frame, ctx, value, { easing: 'linear' })
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  return patch
}

export interface FadeRequest {
  /** Fade in over this many frames from the clip's first frame. */
  fadeIn?: number
  /** Fade out over this many frames ending on the clip's last frame. */
  fadeOut?: number
}

/**
 * Fade patch for one clip. A fade-in is a key at frame 0 of silence and a key `fadeIn` frames later at the
 * clip's own level there; a fade-out mirrors it ending on the last frame. Both levels are sampled from the clip
 * BEFORE either fade is written, so a fade-in never changes the level the fade-out returns to. A clip too short
 * to hold a fade (under 3 frames) gets none; a fade longer than half the clip is shortened to fit.
 */
export function fadePatch(clip: Clip, request: FadeRequest, ctx: BaselineContext): Partial<Clip> {
  const last = clip.durationFrames - 1
  const room = Math.floor(last / 2)
  const keys: Array<[number, number]> = []
  const inFrames = request.fadeIn ? Math.min(request.fadeIn, room) : 0
  const outFrames = request.fadeOut ? Math.min(request.fadeOut, room) : 0
  if (inFrames >= 1) keys.push([0, 0], [inFrames, volumeAt(clip, inFrames)])
  if (outFrames >= 1) keys.push([last - outFrames, volumeAt(clip, last - outFrames)], [last, 0])
  return keys.length ? writeKeys(clip, keys, ctx) : {}
}

export interface MixPatch {
  clipId: string
  trackId: string
  patch: Partial<Clip>
}

export interface CrossfadePlan {
  patches: MixPatch[]
  /** Joins found (a pair of adjacent audio clips on one track). */
  joins: number
}

/**
 * Crossfade the joins among `clips` (any order; only clips on the same track, back to back, count). The left clip
 * fades out and the right fades in over `ms`, at least one frame. A clip with an expression-driven volume is left
 * alone; its joins still count.
 */
export function planCrossfades(clips: ReadonlyArray<Clip>, fps: number, ms: number, ctx: BaselineContext): CrossfadePlan {
  const frames = Math.max(1, Math.round((ms / 1000) * fps))
  const byTrack = new Map<string, Clip[]>()
  for (const c of clips) {
    if (!isAudioBearing(c)) continue
    const list = byTrack.get(c.trackId) ?? []
    list.push(c)
    byTrack.set(c.trackId, list)
  }
  const request = new Map<string, FadeRequest>()
  let joins = 0
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.startFrame - b.startFrame)
    for (let i = 0; i + 1 < list.length; i++) {
      const left = list[i]!
      const right = list[i + 1]!
      const gap = right.startFrame - (left.startFrame + left.durationFrames)
      if (gap < 0 || gap > JOIN_MAX_GAP_FRAMES) continue
      joins++
      request.set(left.id, { ...request.get(left.id), fadeOut: frames })
      request.set(right.id, { ...request.get(right.id), fadeIn: frames })
    }
  }
  const patches: MixPatch[] = []
  for (const c of clips) {
    const req = request.get(c.id)
    if (!req || hasVolumeExpression(c)) continue
    const patch = fadePatch(c, req, ctx)
    if (Object.keys(patch).length) patches.push({ clipId: c.id, trackId: c.trackId, patch })
  }
  return { patches, joins }
}

/** Speech `[from, to)` spans (frames), sorted, with spans whose gap is at most `minGap` merged so the music does not pump. */
export function mergeSpans(spans: ReadonlyArray<readonly [number, number]>, minGap: number): Array<[number, number]> {
  const sorted = spans
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .map(([a, b]) => [a, b] as [number, number])
    .sort((x, y) => x[0] - y[0])
  const out: Array<[number, number]> = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s[0] - last[1] <= minGap) last[1] = Math.max(last[1], s[1])
    else out.push(s)
  }
  return out
}

export interface DuckOptions {
  fps: number
  amountDb: number
  attackSec: number
  releaseSec: number
}

export interface DuckPlan {
  patch: Partial<Clip>
  /** Speech spans (after merging) that overlap the music clip. */
  spans: number
}

/**
 * Volume keys that lower `music` under `speech` (absolute timeline frames).
 *
 * For each speech span the music is back at its own level `attack` before the speech starts, at
 * `gain = 10^(dB/20)` of that level on the span's first frame and held to its last frame, and back at its own
 * level `release` after the speech ends. Spans closer together than attack + release are one span. Existing keys
 * inside a ducked window are replaced by the duck; keys outside it are kept.
 */
export function planDuck(music: Clip, speech: ReadonlyArray<readonly [number, number]>, opts: DuckOptions, ctx: BaselineContext): DuckPlan {
  const attack = Math.max(1, Math.round(opts.attackSec * opts.fps))
  const release = Math.max(1, Math.round(opts.releaseSec * opts.fps))
  const gain = dbToGain(opts.amountDb)
  const last = music.durationFrames - 1
  const spans = mergeSpans(speech, attack + release)
    .map(([a, b]) => [a - music.startFrame, b - music.startFrame] as [number, number])
    .filter(([a, b]) => b > 0 && a <= last)

  const keys: Array<[number, number]> = []
  const windows: Array<[number, number]> = []
  for (const [a, b] of spans) {
    const from = Math.max(0, a)
    const to = Math.min(last, b - 1)
    const pre = Math.max(0, from - attack)
    const post = Math.min(last, to + release)
    windows.push([pre, post])
    if (pre < from) keys.push([pre, volumeAt(music, pre)])
    keys.push([from, volumeAt(music, from) * gain])
    if (to > from) keys.push([to, volumeAt(music, to) * gain])
    if (post > to) keys.push([post, volumeAt(music, post)])
  }
  if (keys.length === 0) return { patch: {}, spans: 0 }

  let working = music
  let patch: Partial<Clip> = {}
  const apply = (p: Partial<Clip>) => {
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  for (const k of normalizeKeys(music.keyframes?.channels?.volume?.keys)) {
    if (windows.some(([a, b]) => k.frame >= a && k.frame <= b)) apply(removeKeyframe(working, 'volume', k.id))
  }
  // `keys` were sampled from the original clip above, so the order they are written in cannot change them.
  for (const [frame, value] of keys) apply(setKeyframe(working, 'volume', frame, ctx, value, { easing: 'linear' }))
  return { patch, spans: spans.length }
}
