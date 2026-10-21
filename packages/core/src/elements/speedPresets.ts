/**
 * Speed presets (EDX-P6): named speed changes that expand into real `time`
 * keys on a video clip — the same "presets write keys you can then edit"
 * contract as motion presets, so a ramp shows up in the curve editor and an
 * agent can ask for "slow-mo in the middle" by name.
 *
 * Every preset keeps the clip's timeline length and the source span it plays
 * today (`(duration − 1) × speed` frames from `sourceStartFrame`), so
 * applying one never overlaps a neighbour.
 */

import type { Clip, Keyframe } from '../types'
import { sourceWindowEnd } from '../resolver/sourceTime'
import { clearKeyframeChannel, setKeyframe, type BaselineContext } from './keyframes'

export type SpeedPresetName =
  | 'speed-ramp-in'
  | 'speed-ramp-out'
  | 'slow-mo-middle'
  | 'freeze-at-playhead'
  | 'reverse'
  | 'boomerang'

export interface SpeedPresetOption {
  name: SpeedPresetName
  label: string
  hint: string
}

export const SPEED_PRESETS: ReadonlyArray<SpeedPresetOption> = [
  { name: 'speed-ramp-in', label: 'Ramp up', hint: 'Starts slow, ends fast' },
  { name: 'speed-ramp-out', label: 'Ramp down', hint: 'Starts fast, ends slow' },
  { name: 'slow-mo-middle', label: 'Slow-mo middle', hint: 'Fast, slow in the middle, fast' },
  { name: 'freeze-at-playhead', label: 'Freeze frame', hint: 'Holds the frame at the playhead, then continues' },
  { name: 'reverse', label: 'Reverse', hint: 'Plays backwards' },
  { name: 'boomerang', label: 'Boomerang', hint: 'Forward, then back' },
]

export const SPEED_PRESET_NAMES: ReadonlyArray<SpeedPresetName> = SPEED_PRESETS.map((p) => p.name)

export interface SpeedPresetParams {
  /** Clip-local frame for `freeze-at-playhead`. Defaults to the middle. */
  atFrame?: number
  /** Freeze length in frames. Defaults to 1 second at 30 fps. */
  holdFrames?: number
}

type KeySpec = { frame: number; value: number; bezier?: [number, number, number, number]; hold?: true }

const EASE_IN: [number, number, number, number] = [0.55, 0, 1, 0.45]
const EASE_OUT: [number, number, number, number] = [0, 0.55, 0.45, 1]
const SMOOTH: [number, number, number, number] = [0.45, 0, 0.55, 1]

/** The `time` keys a preset writes, before they become a patch. Exported for tests and the agent's describer. */
export function speedPresetKeys(clip: Clip, name: SpeedPresetName, params: SpeedPresetParams = {}): KeySpec[] {
  const last = Math.max(1, clip.durationFrames - 1)
  const speed = clip.speed ?? 1
  const s0 = clip.sourceStartFrame
  // The real end of the media when the clip knows it (PV-T5-1), else the
  // window's own end — the same expression this used to inline.
  const windowEnd = sourceWindowEnd(clip)
  const span = Math.max(1, Math.min(windowEnd - s0, Math.round(last * speed)))
  const at = (f: number) => Math.min(last, Math.max(0, Math.round(f)))

  switch (name) {
    case 'speed-ramp-in':
      return [
        { frame: 0, value: s0 },
        { frame: last, value: s0 + span, bezier: EASE_IN },
      ]
    case 'speed-ramp-out':
      return [
        { frame: 0, value: s0 },
        { frame: last, value: s0 + span, bezier: EASE_OUT },
      ]
    case 'slow-mo-middle': {
      const a = at(last * 0.3)
      const b = at(last * 0.7)
      return [
        { frame: 0, value: s0 },
        { frame: a, value: s0 + Math.round(span * 0.42), bezier: SMOOTH },
        { frame: b, value: s0 + Math.round(span * 0.58), bezier: SMOOTH },
        { frame: last, value: s0 + span, bezier: SMOOTH },
      ]
    }
    case 'freeze-at-playhead': {
      const hold = Math.max(1, Math.round(params.holdFrames ?? 30))
      const f = at(params.atFrame ?? last / 2)
      const frozen = s0 + Math.round(f * speed)
      const resume = Math.min(last, f + hold)
      const keys: KeySpec[] = []
      if (f > 0) keys.push({ frame: 0, value: s0 })
      keys.push({ frame: f, value: frozen, hold: true })
      if (resume > f) keys.push({ frame: resume, value: frozen })
      if (last > resume) keys.push({ frame: last, value: Math.min(windowEnd, frozen + Math.round((last - resume) * speed)) })
      return keys
    }
    case 'reverse':
      return [
        { frame: 0, value: s0 + span },
        { frame: last, value: s0 },
      ]
    case 'boomerang': {
      const mid = at(last / 2)
      return [
        { frame: 0, value: s0 },
        { frame: mid, value: s0 + span, bezier: EASE_OUT },
        { frame: last, value: s0, bezier: EASE_IN },
      ]
    }
  }
}

const TIME_CTX: BaselineContext = { stage: { width: 1, height: 1 } }

/**
 * The patch that applies a speed preset to a VIDEO clip: replaces its `time`
 * channel. Any other clip type gets `{}`.
 */
export function applySpeedPreset(clip: Clip, name: SpeedPresetName, params: SpeedPresetParams = {}): Partial<Clip> {
  if (clip.type !== 'video') return {}
  let working: Clip = { ...clip, ...clearKeyframeChannel(clip, 'time') }
  for (const k of speedPresetKeys(clip, name, params)) {
    const patch = setKeyframe(working, 'time', k.frame, TIME_CTX, k.value, {
      easing: 'linear',
      ...(k.bezier ? { easingBezier: k.bezier } : {}),
      ...(k.hold ? { hold: true as const } : {}),
    })
    working = { ...working, ...patch }
  }
  return { keyframes: working.keyframes }
}

/** Remove a clip's time remap: back to constant speed. */
export function clearSpeedRemap(clip: Clip): Partial<Clip> {
  return clearKeyframeChannel(clip, 'time')
}

/** For display: which preset a clip's remap came from, if the keys still match. */
export function matchSpeedPreset(clip: Clip, keys: ReadonlyArray<Keyframe>): SpeedPresetName | undefined {
  for (const p of SPEED_PRESET_NAMES) {
    if (p === 'freeze-at-playhead') continue
    const want = speedPresetKeys(clip, p)
    if (
      want.length === keys.length &&
      want.every((w, i) => {
        const k = keys[i]!
        const bz = k.easingBezier
        const sameCurve = w.bezier ? !!bz && w.bezier.every((v, j) => Math.abs(v - bz[j]!) < 1e-6) : !bz
        return w.frame === k.frame && w.value === k.value && sameCurve && !!w.hold === !!k.hold
      })
    )
      return p
  }
  return undefined
}
