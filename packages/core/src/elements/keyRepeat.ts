/**
 * Repeat and yoyo (MOT-7): copy the keys of a span of one channel N more times as ordinary keys a person can
 * see and drag. Nothing is stored but keys. A yoyo plays every odd cycle backwards: the span's values run in
 * reverse (frames mirrored inside the cycle) and each arriving segment takes the time-reverse of the ease of
 * the segment it mirrors, so a yoyo of an ease-out is an exact mirror. A spring or staircase keeps its own
 * curve (a spring has no time-reverse).
 *
 * A plain repeat snaps back: the last key of every cycle that a later cycle follows holds its value until that
 * cycle's first key, and the rest between cycles is at least one frame. Keys that would pass the clip's last
 * frame are dropped (whole keys only) and `cut` says so. Keys already on a frame a new key lands on are
 * replaced. Pure; only the ids of the new keys are random.
 */

import type { AnyKeyframeChannel, Clip, Keyframe, TextAnimationEasing } from '../types'
import { normalizeKeys } from '../resolver/keyframes'
import { generateId } from '../utils/id'
import { reverseBezier, reverseEase } from './easingPresets'

export interface RepeatKeysOptions {
  /** First frame of the span (clip-local). The span is the keys from `from` to `to`, both inclusive. */
  from: number
  to: number
  /** Extra plays after the first (GSAP semantics). `Infinity` fills to the clip end. */
  count: number
  yoyo?: boolean
  /** Frames of rest between cycles. */
  gapFrames?: number
  /** Stop before the cycle that would take the keys written past this. Default: no limit. */
  maxKeys?: number
}

export interface RepeatKeysResult {
  patch: Partial<Clip>
  /** Whole cycles written. */
  cycles: number
  /** Keys added. */
  added: number
  /** The clip's end stopped the repeat before `count` cycles were done (never set for `Infinity`). */
  cut: boolean
  /** `maxKeys` stopped it. */
  capped: boolean
}

const NONE: RepeatKeysResult = { patch: {}, cycles: 0, added: 0, cut: false, capped: false }

/** The curve fields of the segment `k` arrives by, played backwards. */
function reversedCurve(k: Keyframe): Pick<Keyframe, 'easing' | 'easingBezier' | 'spring' | 'steps'> {
  return {
    easing: reverseEase(k.easing) as TextAnimationEasing,
    ...(k.easingBezier ? { easingBezier: [...reverseBezier(k.easingBezier)] as [number, number, number, number] } : {}),
    ...(k.spring ? { spring: { ...k.spring } } : {}),
    ...(k.steps !== undefined ? { steps: k.steps } : {}),
  }
}

const valueFields = (k: Keyframe): Pick<Keyframe, 'value' | 'vec' | 'path'> => ({
  value: k.value,
  ...(k.vec ? { vec: [...k.vec] } : {}),
  ...(k.path !== undefined ? { path: k.path } : {}),
})

export function repeatKeysPatch(clip: Clip, channel: AnyKeyframeChannel, opts: RepeatKeysOptions): RepeatKeysResult {
  const track = clip.keyframes?.channels?.[channel]
  if (!track) return NONE
  const all = normalizeKeys(track.keys)
  const lo = Math.floor(Math.min(opts.from, opts.to))
  const hi = Math.floor(Math.max(opts.from, opts.to))
  const span = all.filter((k) => k.frame >= lo && k.frame <= hi)
  if (span.length < 2) return NONE
  const from = span[0]!.frame
  const to = span[span.length - 1]!.frame
  const length = to - from
  const count = opts.count === Infinity ? Infinity : Math.floor(opts.count)
  if (!(count > 0)) return NONE

  const yoyo = opts.yoyo === true
  const gap = Math.max(0, Math.floor(opts.gapFrames ?? 0))
  // A plain repeat needs one frame to snap back; a yoyo shares its turning key.
  const period = length + (yoyo ? gap : Math.max(gap, 1))
  const clipLast = Math.max(0, clip.durationFrames - 1)
  const maxKeys = opts.maxKeys ?? Infinity

  const added: Keyframe[] = []
  const holdFrames = new Set<number>()
  let cycles = 0
  let cut = false
  let capped = false

  for (let c = 1; c <= count; c++) {
    const offset = c * period
    const cycle: Keyframe[] = []
    if (yoyo && c % 2 === 1) {
      span.forEach((_, j) => {
        const src = span[span.length - 1 - j]!
        const arrive = span[span.length - j] // the original key whose segment this one mirrors
        // A held segment in the original (src.hold) is held from the mirrored key before it.
        if (j > 0 && src.hold) cycle[j - 1] = { ...cycle[j - 1]!, hold: true }
        cycle.push({
          id: generateId(),
          frame: from + (to - src.frame) + offset,
          ...valueFields(src),
          ...(arrive ? reversedCurve(arrive) : { easing: 'linear' as const }),
        })
      })
    } else {
      span.forEach((src, j) => {
        const { hold: _hold, ...rest } = src
        const key: Keyframe = { ...rest, id: generateId(), frame: src.frame + offset, ...(src.hold && j < span.length - 1 ? { hold: true as const } : {}) }
        if (j === 0) {
          const { easingBezier: _b, spring: _s, steps: _st, ...plain } = key
          cycle.push({ ...plain, easing: 'linear' })
        } else cycle.push(key)
      })
    }
    // The turning key of a yoyo is the previous cycle's last key: skip it when there is no rest.
    const fresh = yoyo && gap === 0 ? cycle.slice(1) : cycle
    if (added.length + fresh.length > maxKeys) {
      capped = true
      break
    }
    const fits = fresh.filter((k) => k.frame <= clipLast)
    if (fits.length < fresh.length) cut = true
    if (fits.length === 0) break
    if (!yoyo) holdFrames.add(to + (c - 1) * period)
    added.push(...fits)
    if (fits.length < fresh.length) break
    cycles++
  }
  if (added.length === 0) return NONE
  if (count !== Infinity && cycles < count && !capped) cut = true
  if (count === Infinity) cut = false

  const stamp = (k: Keyframe): Keyframe => (holdFrames.has(k.frame) ? { ...k, hold: true as const } : k)
  return {
    patch: {
      keyframes: {
        ...clip.keyframes!,
        channels: { ...clip.keyframes!.channels, [channel]: { ...track, keys: normalizeKeys([...all.map(stamp), ...added.map(stamp)]) } },
      },
    },
    cycles,
    added: added.length,
    cut,
    capped,
  }
}
