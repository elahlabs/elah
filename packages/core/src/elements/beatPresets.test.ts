import { describe, expect, it } from 'vitest'
import { applyBeatPreset, beatPresetKeys, BEAT_PRESET_NAMES, isBeatPreset } from './beatPresets'
import type { MotionRest } from './motionPresets'
import type { BaselineContext } from './keyframes'
import type { Clip } from '../types'

const REST: MotionRest = { x: 0.5, y: 0.5, scale: 1, opacity: 1 }
const CTX: BaselineContext = { stage: { width: 1920, height: 1080 } }

function textClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'text',
    name: 'Text',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    content: 'Hi',
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    ...overrides,
  } as Clip
}

describe('BEAT_PRESET_NAMES / isBeatPreset', () => {
  it('lists exactly the three beat presets', () => {
    expect(BEAT_PRESET_NAMES).toEqual(['beat-zoom', 'beat-shake', 'beat-flash'])
  })
  it('isBeatPreset accepts only those three', () => {
    expect(isBeatPreset('beat-zoom')).toBe(true)
    expect(isBeatPreset('fade-in')).toBe(false)
    expect(isBeatPreset('nonsense')).toBe(false)
  })
})

describe('beatPresetKeys — beat-zoom', () => {
  it('one hit per beat, values to 9 places, hits 3', () => {
    const { keys, hits } = beatPresetKeys('beat-zoom', REST, [0, 15, 30], 45)
    expect(hits).toBe(3)
    expect(keys.scale?.map((k) => [k.frame, Number(k.value.toFixed(9)), k.easing, !!k.hold])).toEqual([
      [0, 1.08, 'linear', false],
      [6, 1, 'quad-out', true],
      [15, 1.08, 'linear', false],
      [21, 1, 'quad-out', true],
      [30, 1.08, 'linear', false],
      [36, 1, 'quad-out', true],
    ])
  })

  it('a leading hold key when the first beat is after frame 0', () => {
    const { keys } = beatPresetKeys('beat-zoom', REST, [10], 30)
    expect(keys.scale?.map((k) => [k.frame, Number(k.value.toFixed(9)), k.easing, !!k.hold])).toEqual([
      [0, 1, 'linear', true],
      [10, 1.08, 'linear', false],
      [16, 1, 'quad-out', true],
    ])
  })

  it('drops a settle key that would land past the next beat', () => {
    const { keys } = beatPresetKeys('beat-zoom', REST, [0, 4], 20)
    expect(keys.scale?.map((k) => [k.frame, Number(k.value.toFixed(9)), !!k.hold])).toEqual([
      [0, 1.08, false],
      [4, 1.08, false],
      [10, 1, true],
    ])
  })

  it('amount scales the peak, clamped to 3', () => {
    const a2 = beatPresetKeys('beat-zoom', REST, [0], 30, { amount: 2 })
    expect(a2.keys.scale?.[0]?.value).toBeCloseTo(1.16, 9)
    const a5 = beatPresetKeys('beat-zoom', REST, [0], 30, { amount: 5 })
    expect(a5.keys.scale?.[0]?.value).toBeCloseTo(1.24, 9)
  })
})

describe('beatPresetKeys — beat-shake', () => {
  it('x/y hit at every beat, scale one key at frame 0', () => {
    const { keys } = beatPresetKeys('beat-shake', REST, [0, 15], 30)
    const xFrames = keys.x?.map((k) => k.frame)
    expect(xFrames).toEqual([0, 2, 4, 15, 17, 19])
    for (const k of keys.x ?? []) expect(Math.abs(k.value - 0.5)).toBeLessThanOrEqual(0.012 + 1e-9)
    for (const k of keys.y ?? []) expect(Math.abs(k.value - 0.5)).toBeLessThanOrEqual(0.012 + 1e-9)
    const f4 = keys.x?.find((k) => k.frame === 4)
    const f19 = keys.x?.find((k) => k.frame === 19)
    expect(f4?.value).toBeCloseTo(0.5, 9)
    expect(f4?.hold).toBe(true)
    expect(f19?.value).toBeCloseTo(0.5, 9)
    expect(f19?.hold).toBe(true)
    expect(keys.scale?.length).toBe(1)
    expect(keys.scale?.[0]?.frame).toBe(0)
    expect(keys.scale?.[0]?.value).toBeCloseTo(1 + 2.5 * 0.012, 9)
  })
})

describe('beatPresetKeys — beat-flash', () => {
  it('keys per hit: peak then settle', () => {
    const { keys } = beatPresetKeys('beat-flash', REST, [0], 30)
    expect(keys.amount?.map((k) => [k.frame, Number(k.value.toFixed(9)), k.easing, !!k.hold])).toEqual([
      [0, 0.8, 'linear', false],
      [4, 0, 'quad-out', true],
    ])
  })
})

describe('beatPresetKeys — cap', () => {
  it('caps at 128 hits', () => {
    const beats = Array.from({ length: 200 }, (_, i) => i * 2)
    const { hits } = beatPresetKeys('beat-zoom', REST, beats, 400)
    expect(hits).toBe(128)
  })
})

describe('applyBeatPreset', () => {
  it('an audio clip: no patch, no hits', () => {
    const clip = textClip({ type: 'audio', src: 'song.mp3', content: undefined } as Partial<Clip>)
    const r = applyBeatPreset(clip, 'beat-zoom', [0, 15], {}, CTX)
    expect(r).toEqual({ patch: {}, hits: 0 })
  })

  it('beat-flash on a clip without effects appends one flash effect', () => {
    const clip = textClip()
    const r = applyBeatPreset(clip, 'beat-flash', [0], {}, CTX)
    expect(r.hits).toBe(1)
    expect(r.patch.effects?.length).toBe(1)
    const effect = r.patch.effects![0]!
    expect(effect.kind).toBe('flash')
    const channel = `fx.${effect.id}.amount`
    const keys = r.patch.keyframes?.channels?.[channel as never]?.keys
    expect(keys?.map((k) => [k.frame, Number(k.value.toFixed(9)), !!k.hold])).toEqual([
      [0, 0.8, false],
      [4, 0, true],
    ])
  })

  it('beat-flash on a clip that already has a flash effect reuses its id', () => {
    const withFlash = textClip()
    const first = applyBeatPreset(withFlash, 'beat-flash', [0], {}, CTX)
    const applied: Clip = { ...withFlash, ...first.patch }
    const r2 = applyBeatPreset(applied, 'beat-flash', [0], {}, CTX)
    expect(r2.patch.effects).toBeUndefined()
    const effectId = applied.effects![0]!.id
    const channel = `fx.${effectId}.amount`
    expect(r2.patch.keyframes?.channels?.[channel as never]).toBeTruthy()
  })

  it('reapplying beat-zoom yields deep-equal keyframes', () => {
    const clip = textClip()
    const first = applyBeatPreset(clip, 'beat-zoom', [0, 15], {}, CTX)
    const applied: Clip = { ...clip, ...first.patch }
    const second = applyBeatPreset(applied, 'beat-zoom', [0, 15], {}, CTX)
    // Compare just the keys (ids are freshly minted per setKeyframe call, but
    // frame/value/easing/hold must match exactly).
    const strip = (p: Partial<Clip>) =>
      Object.fromEntries(
        Object.entries(p.keyframes?.channels ?? {}).map(([ch, track]) => [
          ch,
          (track?.keys ?? []).map((k) => ({ frame: k.frame, value: k.value, easing: k.easing, hold: k.hold })),
        ]),
      )
    expect(strip(second.patch)).toEqual(strip(first.patch))
  })
})
