/**
 * Beat presets (PV-P10b-3): motion presets that key on every detected beat
 * inside a clip, rather than spanning the whole clip once. Same contract as
 * `motionPresets.ts` — a preset expands into real keyframes through
 * `setKeyframe`, so the result is visible in the properties panel, draggable
 * on the timeline, undoable in one step, and identical in preview and
 * export. Kept in their own module and their own name list (never merged
 * into `MOTION_PRESET_NAMES`/`MOTION_PRESETS`/`MOTION_PRESET_GROUPS`) because
 * they need beats to apply at all, which the whole-clip presets never do.
 */

import type { AnyKeyframeChannel, Clip } from '../types'
import { clearKeyframeChannel, setKeyframe, type BaselineContext } from './keyframes'
import { motionRest, type MotionRest, type PresetKey } from './motionPresets'
import { SHAKE_MOTION } from './motionPresets'
import { noise1 } from './noise'
import { createEffect } from '../effects/registry'
import { effectChannel } from '../resolver/keyframes'

export const BEAT_PRESET_NAMES = ['beat-zoom', 'beat-shake', 'beat-flash'] as const
export type BeatPresetName = (typeof BEAT_PRESET_NAMES)[number]

export const BEAT_PRESETS: ReadonlyArray<{ name: BeatPresetName; label: string; hint: string }> = [
  { name: 'beat-zoom', label: 'Beat zoom', hint: 'punches in on every beat' },
  { name: 'beat-shake', label: 'Beat shake', hint: 'a short shake on every beat' },
  { name: 'beat-flash', label: 'Beat flash', hint: 'a white flash on every beat' },
]

export const BEAT_MOTION = {
  zoom: 0.08,
  zoomFrames: 6,
  shake: 0.012,
  shakeFrames: 4,
  flash: 0.8,
  flashFrames: 4,
  /** Most beats a preset expands: longer clips key fewer of their beats. */
  maxHits: 128,
} as const

export function isBeatPreset(name: string): name is BeatPresetName {
  return (BEAT_PRESET_NAMES as ReadonlyArray<string>).includes(name)
}

export interface BeatPresetParams {
  /** Scales the preset's magnitude. 1 = the defaults above; clamped to 0..3. */
  amount?: number
  /** The noise seed for beat-shake. Same seed, same keys. Default 1. */
  seed?: number
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampAmount(a: number | undefined): number {
  const v = finiteOr(a, 1)
  return v < 0 ? 0 : v > 3 ? 3 : v
}

/** The next beat's frame (exclusive bound for this hit), or `duration` after the last one. */
function nextBoundAt(beats: ReadonlyArray<number>, k: number, duration: number): number {
  return k + 1 < beats.length ? beats[k + 1]! : duration
}

export type BeatPresetChannel = 'x' | 'y' | 'scale' | 'amount'
export type BeatPresetKeys = Partial<Record<BeatPresetChannel, PresetKey[]>>

function beatZoomKeys(rest: MotionRest, beats: ReadonlyArray<number>, duration: number, last: number, a: number): BeatPresetKeys {
  const peak = rest.scale * (1 + BEAT_MOTION.zoom * a)
  const scale: PresetKey[] = []
  if (beats.length && beats[0]! > 0) scale.push({ frame: 0, value: rest.scale, easing: 'linear', hold: true })
  for (let k = 0; k < beats.length; k++) {
    const b = beats[k]!
    const next = nextBoundAt(beats, k, duration)
    if (b < next && b <= last) scale.push({ frame: b, value: peak, easing: 'linear' })
    const settle = b + BEAT_MOTION.zoomFrames
    if (settle < next && settle <= last) scale.push({ frame: settle, value: rest.scale, easing: 'quad-out', hold: true })
  }
  return { scale }
}

function beatShakeKeys(
  rest: MotionRest,
  beats: ReadonlyArray<number>,
  duration: number,
  last: number,
  a: number,
  seed: number,
): BeatPresetKeys {
  const amp = BEAT_MOTION.shake * a
  const x: PresetKey[] = []
  const y: PresetKey[] = []
  if (beats.length && beats[0]! > 0) {
    x.push({ frame: 0, value: rest.x, easing: 'linear', hold: true })
    y.push({ frame: 0, value: rest.y, easing: 'linear', hold: true })
  }
  for (let k = 0; k < beats.length; k++) {
    const b = beats[k]!
    const next = nextBoundAt(beats, k, duration)
    const dx = amp * noise1(seed * 31, k * 0.7 + 0.35)
    const dy = amp * noise1(seed * 31 + 7919, k * 0.7 + 0.35)
    const f0 = b
    const f1 = b + 2
    const f2 = b + 4
    if (f0 < next && f0 <= last) {
      x.push({ frame: f0, value: rest.x + dx, easing: 'linear' })
      y.push({ frame: f0, value: rest.y + dy, easing: 'linear' })
    }
    if (f1 < next && f1 <= last) {
      x.push({ frame: f1, value: rest.x - dx, easing: 'linear' })
      y.push({ frame: f1, value: rest.y - dy, easing: 'linear' })
    }
    if (f2 < next && f2 <= last) {
      x.push({ frame: f2, value: rest.x, easing: 'linear', hold: true })
      y.push({ frame: f2, value: rest.y, easing: 'linear', hold: true })
    }
  }
  // Always present, regardless of the first beat's position: the headroom has
  // to exist before the first shake key ever fires.
  const scale: PresetKey[] = [{ frame: 0, value: rest.scale * (1 + SHAKE_MOTION.cover * amp), easing: 'linear' }]
  return { x, y, scale }
}

function beatFlashKeys(beats: ReadonlyArray<number>, duration: number, last: number, a: number): PresetKey[] {
  const peak = Math.min(1, BEAT_MOTION.flash * a)
  const out: PresetKey[] = []
  if (beats.length && beats[0]! > 0) out.push({ frame: 0, value: 0, easing: 'linear', hold: true })
  for (let k = 0; k < beats.length; k++) {
    const b = beats[k]!
    const next = nextBoundAt(beats, k, duration)
    if (b < next && b <= last) out.push({ frame: b, value: peak, easing: 'linear' })
    const settle = b + BEAT_MOTION.flashFrames
    if (settle < next && settle <= last) out.push({ frame: settle, value: 0, easing: 'quad-out', hold: true })
  }
  return out
}

/**
 * The keys a beat preset expands into, as pure data — one hit per beat inside
 * the clip (first {@link BEAT_MOTION.maxHits} beats, sorted).
 */
export function beatPresetKeys(
  name: BeatPresetName,
  rest: MotionRest,
  beats: ReadonlyArray<number>,
  durationFrames: number,
  params: BeatPresetParams = {},
): { keys: BeatPresetKeys; hits: number } {
  const duration = Math.max(1, Math.floor(finiteOr(durationFrames, 1)))
  const last = duration - 1
  const a = clampAmount(params.amount)
  const seed = Math.floor(finiteOr(params.seed, 1))
  const sorted = beats
    .filter((b) => Number.isFinite(b))
    .slice()
    .sort((x, y) => x - y)
    .slice(0, BEAT_MOTION.maxHits)
  const hits = sorted.length

  switch (name) {
    case 'beat-zoom':
      return { keys: beatZoomKeys(rest, sorted, duration, last, a), hits }
    case 'beat-shake':
      return { keys: beatShakeKeys(rest, sorted, duration, last, a, seed), hits }
    case 'beat-flash':
      return { keys: { amount: beatFlashKeys(sorted, duration, last, a) }, hits }
  }
}

function writeKey(clip: Clip, channel: AnyKeyframeChannel, key: PresetKey, ctx: BaselineContext): Partial<Clip> {
  return setKeyframe(clip, channel, key.frame, ctx, key.value, {
    easing: key.easing,
    ...(key.hold ? { hold: true as const } : {}),
  })
}

/**
 * The patch that applies a beat preset to `clip`: clears the channels it
 * writes, then writes the keys through `setKeyframe`. `hits` is the number of
 * beats the preset expanded (0 for a clip type the preset never touches, or
 * when `beats` is empty).
 *
 * `beat-flash` reuses the clip's first `flash` effect when it has one, so
 * reapplying — or applying after the panel already added one by hand — never
 * duplicates the effect stack.
 */
export function applyBeatPreset(
  clip: Clip,
  name: BeatPresetName,
  beats: ReadonlyArray<number>,
  params: BeatPresetParams,
  ctx: BaselineContext,
): { patch: Partial<Clip>; hits: number } {
  if (clip.type === 'audio') return { patch: {}, hits: 0 }

  const rest = motionRest(clip, ctx)
  const { keys, hits } = beatPresetKeys(name, rest, beats, clip.durationFrames, params)

  let working: Clip = clip
  let patch: Partial<Clip> = {}
  const merge = (p: Partial<Clip>) => {
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }

  if (name === 'beat-flash') {
    const existing = clip.effects?.find((e) => e.kind === 'flash')
    const effect = existing ?? createEffect('flash')
    if (!existing) merge({ effects: [...(clip.effects ?? []), effect] })
    const channel = effectChannel(effect.id, 'amount')
    merge(clearKeyframeChannel(working, channel))
    for (const key of keys.amount ?? []) merge(writeKey(working, channel, key, ctx))
    return { patch, hits }
  }

  const channels = (Object.keys(keys) as BeatPresetChannel[]).filter((c) => c !== 'amount')
  for (const channel of channels) merge(clearKeyframeChannel(working, channel))
  for (const channel of channels) {
    for (const key of keys[channel] ?? []) merge(writeKey(working, channel, key, ctx))
  }
  return { patch, hits }
}
