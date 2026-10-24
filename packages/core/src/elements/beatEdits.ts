/**
 * Beat cuts and silence freeze (PV-P10b-3): pure helpers turning detected
 * beats/silences into edits. `beatCutFrames` is consumed by the `beatCuts` op
 * (splits a clip); `silenceFreezeKeys`/`silenceFreezePatch` are consumed by
 * `silenceFreeze` (holds a video's picture through the silences of the audio
 * under it) and, directly, by nothing else — same "preset writes real keys"
 * contract as every other writer in `elements/`.
 */

import type { Clip } from '../types'
import { sourceWindowEnd } from '../resolver/sourceTime'
import { clearKeyframeChannel, setKeyframe, type BaselineContext } from './keyframes'

export const MAX_BEAT_CUTS = 200
export const MAX_FREEZES = 64

/**
 * Local cut frames: beats greater than 0 (a cut at the clip's own start is a
 * no-op), every `every`-th of those starting with the first, at most
 * {@link MAX_BEAT_CUTS}.
 */
export function beatCutFrames(localBeats: ReadonlyArray<number>, every: number): number[] {
  const step = Math.max(1, Math.round(Number.isFinite(every) ? every : 1))
  const positive = localBeats.filter((b) => Number.isFinite(b) && b > 0)
  const out: number[] = []
  for (let i = 0; i < positive.length; i++) {
    if (i % step === 0) out.push(positive[i]!)
  }
  return out.slice(0, MAX_BEAT_CUTS)
}

export interface FreezeKey {
  frame: number
  value: number
  hold?: true
}

/**
 * `time` keys that hold the picture through each local range `[a, b)` and
 * continue from the frozen frame. `ranges` need not be sorted; at most
 * {@link MAX_FREEZES} are used.
 */
export function silenceFreezeKeys(clip: Clip, ranges: ReadonlyArray<[number, number]>): FreezeKey[] {
  const last = Math.max(0, clip.durationFrames - 1)
  const speed = clip.speed ?? 1
  const s0 = clip.sourceStartFrame
  // PV-T5-1's existing helper: the real end of the media when the clip knows
  // it (assetFrames), else the legacy fallback (the trim window's own end).
  const windowEnd = sourceWindowEnd(clip)
  let shift = 0
  const value = (localFrame: number) => Math.min(windowEnd, s0 + Math.round((localFrame - shift) * speed))

  const sorted = [...ranges].sort((r1, r2) => r1[0] - r2[0]).slice(0, MAX_FREEZES)
  const out: FreezeKey[] = []

  if (sorted.length && sorted[0]![0] > 0) out.push({ frame: 0, value: s0 })

  for (const [a, b] of sorted) {
    if (a > last) continue
    const frozen = value(a)
    out.push({ frame: a, value: frozen, hold: true })
    shift += Math.min(b, last + 1) - a
    if (b <= last) out.push({ frame: b, value: frozen })
  }

  const lastKey = out[out.length - 1]
  if (!lastKey || (!lastKey.hold && lastKey.frame < last)) {
    out.push({ frame: last, value: value(last) })
  }
  return out
}

/** The patch that applies {@link silenceFreezeKeys} to `clip`'s `time` channel. */
export function silenceFreezePatch(
  clip: Clip,
  ranges: ReadonlyArray<[number, number]>,
  ctx: BaselineContext,
): Partial<Clip> {
  let working: Clip = clip
  let patch: Partial<Clip> = {}
  const merge = (p: Partial<Clip>) => {
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  merge(clearKeyframeChannel(working, 'time'))
  for (const k of silenceFreezeKeys(clip, ranges)) {
    merge(
      setKeyframe(working, 'time', k.frame, ctx, k.value, {
        easing: 'linear',
        ...(k.hold ? { hold: true as const } : {}),
      }),
    )
  }
  return patch
}
