/**
 * Motion presets — the invariants that make a preset safe to apply blindly.
 *
 * The two that matter most, because both were shipped wrong in hand-authored
 * work before this module existed:
 *   1. Every key lands inside `[0, durationFrames - 1]`. A key at
 *      `durationFrames` is one frame past anything that renders, so a fade-out
 *      never finishes and the clip pops at the cut.
 *   2. An `in` preset ENDS at rest and an `out` preset STARTS at rest, so the
 *      clip looks untouched for the part of its life it is not animating.
 */

import { describe, it, expect } from 'vitest'
import {
  MOTION_PRESETS,
  MOTION_PRESET_NAMES,
  BLUR_PRESET_MARK,
  applyMotionPreset,
  fadeChannelFor,
  motionPresetKeys,
  motionRest,
  presetSetup,
  presetsFor,
  staggerPresetPatches,
  CAMERA_MOTION,
  MOTION_PRESET_GROUPS,
  SHAKE_MOTION,
  type MotionPresetName,
  type MotionRest,
} from './motionPresets'
import { sampleChannel } from '../resolver/keyframes'
import { applyDrawOn } from './drawOn'
import { DEFAULT_SHAPE_TRANSFORM } from '../resolver/textAnimation'
import type { Clip, KeyframeChannel } from '../types'

const STAGE = { width: 1920, height: 1080 }
const CTX = { stage: STAGE }
const REST: MotionRest = { x: 0.5, y: 0.5, scale: 1, opacity: 1 }
/** The 17 PQ-2d presets, declared after the original 19. presetsFor hides them unless given a clipType. */
const PQ2D_NAMES: MotionPresetName[] = MOTION_PRESET_NAMES.slice(19) as MotionPresetName[]

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'shape',
    name: 'Shape',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    shapeKind: 'rect',
    ...overrides,
  }
}

function allKeys(name: MotionPresetName, duration = 60) {
  return Object.entries(motionPresetKeys(name, REST, { durationFrames: duration })) as Array<
    [KeyframeChannel, Array<{ frame: number; value: number }>]
  >
}

describe('motionPresetKeys — frame bounds', () => {
  it.each(MOTION_PRESET_NAMES)('%s keys every frame inside [0, duration-1]', (name) => {
    for (const [, keys] of allKeys(name)) {
      for (const key of keys) {
        expect(key.frame).toBeGreaterThanOrEqual(0)
        expect(key.frame).toBeLessThanOrEqual(59)
        expect(Number.isInteger(key.frame)).toBe(true)
      }
    }
  })

  it.each(MOTION_PRESET_NAMES)('%s still fits a 3-frame clip', (name) => {
    for (const [, keys] of allKeys(name, 3)) {
      for (const key of keys) {
        expect(key.frame).toBeGreaterThanOrEqual(0)
        expect(key.frame).toBeLessThanOrEqual(2)
      }
    }
  })

  it.each(MOTION_PRESET_NAMES)('%s survives a 1-frame clip without going negative', (name) => {
    for (const [, keys] of allKeys(name, 1)) {
      for (const key of keys) expect(key.frame).toBe(0)
    }
  })
})

/** The value a channel returns to: REST for the builtin four, 1 for scaleX / mask.width / draw, 0 for a blur radius. */
function restOf(channel: string): number {
  if (channel in REST) return REST[channel as keyof MotionRest] as number
  return channel.startsWith('fx.') ? 0 : 1
}

describe('motionPresetKeys — rest', () => {
  const ENTRIES = MOTION_PRESETS.filter((p) => p.end === 'in').map((p) => p.name)
  const EXITS = MOTION_PRESETS.filter((p) => p.end === 'out').map((p) => p.name)

  it.each(ENTRIES)('%s ends at rest and holds it for the rest of the clip', (name) => {
    for (const [channel, keys] of allKeys(name)) {
      const restValue = restOf(channel)
      expect(sampleChannel(keys.map(withId), 59)).toBeCloseTo(restValue, 9)
      // And it is NOT at rest on frame 0, or the preset does nothing.
      expect(sampleChannel(keys.map(withId), 0)).not.toBeCloseTo(restValue, 6)
    }
  })

  it.each(EXITS)('%s starts at rest on frame 0', (name) => {
    for (const [channel, keys] of allKeys(name)) {
      const restValue = restOf(channel)
      expect(sampleChannel(keys.map(withId), 0)).toBeCloseTo(restValue, 9)
    }
  })

  it('fade-out reaches exactly 0 on the last VISIBLE frame, not one past it', () => {
    const keys = motionPresetKeys('fade-out', REST, { durationFrames: 60 }).opacity!
    expect(keys[keys.length - 1].frame).toBe(59)
    expect(keys[keys.length - 1].value).toBe(0)
  })

  it('slides travel the normalized distance and come back to rest', () => {
    const left = motionPresetKeys('slide-in-left', REST, { durationFrames: 60 }).x!
    expect(left[0].value).toBeCloseTo(0.35, 9)
    expect(left[1].value).toBeCloseTo(0.5, 9)

    // Stage y grows downward, so "from below" starts at a LARGER y.
    const up = motionPresetKeys('slide-in-up', REST, { durationFrames: 60 }).y!
    expect(up[0].value).toBeGreaterThan(up[1].value)
    const down = motionPresetKeys('slide-in-down', REST, { durationFrames: 60 }).y!
    expect(down[0].value).toBeLessThan(down[1].value)
  })

  it('respects an explicit ramp and travel distance', () => {
    const keys = motionPresetKeys('slide-in-right', REST, {
      durationFrames: 60,
      rampFrames: 8,
      distance: 0.4,
    }).x!
    expect(keys[1].frame).toBe(8)
    expect(keys[0].value).toBeCloseTo(0.9, 9)
  })

  it('pop-in animates scale AND opacity, so it never reads as a glitch', () => {
    const keys = motionPresetKeys('pop-in', REST, { durationFrames: 60 })
    expect(Object.keys(keys).sort()).toEqual(['opacity', 'scale'])
    expect(keys.scale![1].easing).toBe('back-out')
  })
})

function withId(k: { frame: number; value: number }, i: number) {
  return { id: `k${i}`, easing: 'linear' as const, ...k }
}

describe('motionRest', () => {
  it('uses the renderer default for a shape that was never placed', () => {
    expect(motionRest(clip(), CTX)).toEqual({
      x: DEFAULT_SHAPE_TRANSFORM.x,
      y: DEFAULT_SHAPE_TRANSFORM.y,
      scale: DEFAULT_SHAPE_TRANSFORM.scale,
      opacity: 1,
    })
  })

  it('uses the contain placement for a media clip that was never placed', () => {
    const rest = motionRest(
      clip({ type: 'image', shapeKind: undefined, src: 'x.png' }),
      { stage: STAGE, content: { width: 960, height: 1080 } },
    )
    // Contained in a 1920×1080 stage the 960×1080 image is centred and unscaled.
    expect(rest.x).toBeCloseTo(0.5, 9)
    expect(rest.scale).toBeCloseTo(1, 9)
  })

  it('prefers the authored transform when there is one', () => {
    const rest = motionRest(
      clip({ transform: { x: 0.2, y: 0.8, scale: 2, rotation: 0, anchor: { x: 0.5, y: 0.5 } }, opacity: 0.5 }),
      CTX,
    )
    expect(rest).toEqual({ x: 0.2, y: 0.8, scale: 2, opacity: 0.5 })
  })
})

describe('applyMotionPreset', () => {
  it('returns a patch of real keyframes', () => {
    const patch = applyMotionPreset(clip(), 'fade-in', {}, CTX)
    const keys = patch.keyframes?.channels?.opacity?.keys
    expect(keys).toHaveLength(2)
    expect(keys![0]).toMatchObject({ frame: 0, value: 0 })
    expect(keys![1].frame).toBeGreaterThan(0)
    expect(keys!.every((k) => typeof k.id === 'string' && k.id.length > 0)).toBe(true)
  })

  it('bakes a baseline transform when the preset moves a clip that has none', () => {
    // A slide keys `x`, so the clip must come away with a concrete transform or
    // the resolver would have to guess what the other channels were.
    const patch = applyMotionPreset(clip(), 'slide-in-left', {}, CTX)
    expect(patch.transform).toEqual(DEFAULT_SHAPE_TRANSFORM)
  })

  it('does not invent a transform for an opacity-only preset', () => {
    expect(applyMotionPreset(clip(), 'fade-in', {}, CTX).transform).toBeUndefined()
  })

  it('merges into keys the clip already has instead of replacing them', () => {
    const withFade = applyMotionPreset(clip(), 'fade-in', {}, CTX)
    const both = applyMotionPreset({ ...clip(), ...withFade }, 'slide-in-left', {}, CTX)
    expect(Object.keys(both.keyframes!.channels).sort()).toEqual(['opacity', 'x'])
  })

  it('clears the matching end of the legacy ramp so motion cannot double up', () => {
    const c = clip({ shapeAnimation: { in: 'fade', out: 'fade', durationFrames: 15 } })
    const patch = applyMotionPreset(c, 'fade-in', {}, CTX)
    expect(patch.shapeAnimation).toEqual({ out: 'fade', durationFrames: 15 })
  })

  it('drops the legacy ramp entirely once its last end is cleared', () => {
    const c = clip({ shapeAnimation: { in: 'fade', durationFrames: 15 } })
    expect(applyMotionPreset(c, 'fade-in', {}, CTX)).toHaveProperty('shapeAnimation', undefined)
  })

  it('leaves the other end of the legacy ramp alone', () => {
    const c = clip({ shapeAnimation: { in: 'fade', out: 'fade', durationFrames: 15 } })
    expect(applyMotionPreset(c, 'fade-out', {}, CTX).shapeAnimation).toEqual({
      in: 'fade',
      durationFrames: 15,
    })
  })

  it('touches textAnimation for a text clip and shapeAnimation for a shape', () => {
    const text = clip({ type: 'text', shapeKind: undefined, content: 'Hi', textAnimation: { in: 'fade', durationFrames: 15 } })
    expect(applyMotionPreset(text, 'fade-in', {}, CTX)).toHaveProperty('textAnimation', undefined)
  })

  it('adds no animation field at all when the clip never had one', () => {
    expect('shapeAnimation' in applyMotionPreset(clip(), 'fade-in', {}, CTX)).toBe(false)
  })
})

/**
 * Audio has no opacity, so a fade that keyed one would be a control that does
 * nothing — the exact failure mode `spin`-on-shapes used to be.
 */
describe('fade channel', () => {
  const audio = clip({ type: 'audio', shapeKind: undefined, src: 'a.mp3', volume: 0.8 })

  it('fades audio on volume and everything else on opacity', () => {
    expect(fadeChannelFor('audio')).toBe('volume')
    for (const type of ['video', 'image', 'text', 'shape', 'freehand'] as const) {
      expect(fadeChannelFor(type)).toBe('opacity')
    }
  })

  it('applies an audio fade to the volume channel, returning to its own level', () => {
    const patch = applyMotionPreset(audio, 'fade-in', {}, CTX)
    const channels = patch.keyframes!.channels
    expect(channels.opacity).toBeUndefined()
    const keys = channels.volume!.keys
    expect(keys[0]).toMatchObject({ frame: 0, value: 0 })
    expect(keys[1].value).toBeCloseTo(0.8, 9)
  })

  it('offers only the presets a clip type can actually perform', () => {
    expect(presetsFor(['volume'], 'volume').map((p) => p.name)).toEqual(['fade-in', 'fade-out'])
    // Every enter/exit preset, in the catalogue's UI order (entries first, then exits).
    const ENTER_EXIT = MOTION_PRESETS.filter((p) => p.end !== 'whole' && !PQ2D_NAMES.includes(p.name)).map((p) => p.name)
    expect(
      presetsFor(['x', 'y', 'scale', 'opacity'])
        .filter((p) => p.end !== 'whole')
        .map((p) => p.name),
    ).toEqual(ENTER_EXIT)
    expect(ENTER_EXIT).toHaveLength(8)
    // With rotation too, every preset in the catalogue is offered.
    expect(presetsFor(['x', 'y', 'scale', 'rotation', 'opacity'])).toHaveLength(MOTION_PRESET_NAMES.length - PQ2D_NAMES.length)
    // No scale channel → no pop or zoom.
    expect(presetsFor(['x', 'opacity']).map((p) => p.name)).toEqual([
      'fade-in',
      'slide-in-left',
      'slide-in-right',
      'fade-out',
    ])
  })
})

// ---------------------------------------------------------------------------
// Whole-clip presets: camera, shake, impact (EDX-P4)
// ---------------------------------------------------------------------------

const WHOLE = MOTION_PRESETS.filter((p) => p.end === 'whole' && !PQ2D_NAMES.includes(p.name)).map((p) => p.name)
const ORIGINAL_EIGHT: MotionPresetName[] = [
  'fade-in',
  'fade-out',
  'pop-in',
  'scale-out',
  'slide-in-left',
  'slide-in-right',
  'slide-in-up',
  'slide-in-down',
]

/** The channels a preset needs, discovered through presetsFor: drop one, see if it vanishes. */
function declaredChannels(name: MotionPresetName): string[] {
  const all = ['x', 'y', 'scale', 'rotation', 'opacity'] as const
  return all.filter((c) => !presetsFor(all.filter((o) => o !== c)).some((p) => p.name === name))
}

describe('whole-clip presets — catalogue', () => {
  it('keeps the original eight names, order and groups', () => {
    expect(MOTION_PRESET_NAMES.slice(0, 8)).toEqual(ORIGINAL_EIGHT)
    for (const p of MOTION_PRESETS.filter((o) => o.end !== 'whole')) {
      expect(p.group).toBe(p.end === 'in' ? 'enter' : 'exit')
    }
  })

  it('declares eleven whole-clip presets in the camera, shake and impact groups', () => {
    expect(WHOLE).toHaveLength(11)
    for (const p of MOTION_PRESETS.filter((o) => o.end === 'whole')) {
      expect(['camera', 'shake', 'impact']).toContain(p.group)
    }
    expect(MOTION_PRESET_GROUPS.map((g) => g.id)).toEqual(['enter', 'exit', 'camera', 'shake', 'impact'])
  })

  it('hides every camera and shake preset from audio', () => {
    const audio = presetsFor(['volume'], 'volume').map((p) => p.name)
    for (const name of WHOLE) expect(audio).not.toContain(name)
  })
})

describe('whole-clip presets — keys', () => {
  it.each(WHOLE)('%s writes exactly the channels it declares', (name) => {
    const written = Object.keys(motionPresetKeys(name, REST, { durationFrames: 90 })).sort()
    expect(written).toEqual([...declaredChannels(name)].sort())
  })

  it.each(WHOLE)('%s spans the clip or holds a single value', (name) => {
    for (const [, keys] of allKeys(name, 90)) {
      const frames = keys.map((k) => k.frame)
      if (keys.length > 1 && name !== 'punch-in' && name !== 'impact') {
        expect(Math.max(...frames)).toBe(89)
      }
      for (const f of frames) expect(f).toBeLessThanOrEqual(89)
    }
  })

  it('zoom-in goes from rest to rest × (1 + zoom); zoom-out is the reverse', () => {
    const inKeys = motionPresetKeys('zoom-in', REST, { durationFrames: 60 }).scale!
    expect(inKeys[0].value).toBe(1)
    expect(inKeys[1].value).toBeCloseTo(1 + CAMERA_MOTION.zoom, 9)
    const outKeys = motionPresetKeys('zoom-out', REST, { durationFrames: 60 }).scale!
    expect(outKeys.map((k) => k.value)).toEqual([...inKeys.map((k) => k.value)].reverse())
  })

  it('amount scales the magnitude and is clamped to 0..3', () => {
    const at = (amount: number) =>
      motionPresetKeys('zoom-in', REST, { durationFrames: 60, amount }).scale![1].value - 1
    expect(at(2)).toBeCloseTo(2 * at(1), 9)
    expect(at(0)).toBe(0)
    expect(at(10)).toBeCloseTo(at(3), 9)
    expect(at(Number.NaN)).toBeCloseTo(at(1), 9)
  })

  it('spin turns one full revolution from the rest rotation', () => {
    const keys = motionPresetKeys('spin', { ...REST, rotation: 0.5 }, { durationFrames: 30 }).rotation!
    expect(keys[0].value).toBe(0.5)
    expect(keys[1].value).toBeCloseTo(0.5 + Math.PI * 2, 9)
  })

  it('punch-in lands inside its punch window and then holds', () => {
    const keys = motionPresetKeys('punch-in', REST, { durationFrames: 60 }).scale!
    expect(keys[1].frame).toBe(CAMERA_MOTION.punchFrames)
    expect(sampleChannel(keys.map(withId), 59)).toBeCloseTo(1 + CAMERA_MOTION.punch, 9)
  })
})

describe('shake presets', () => {
  it('is deterministic per seed and different across seeds', () => {
    const a = motionPresetKeys('shake-hard', REST, { durationFrames: 60, seed: 3 })
    const b = motionPresetKeys('shake-hard', REST, { durationFrames: 60, seed: 3 })
    const c = motionPresetKeys('shake-hard', REST, { durationFrames: 60, seed: 4 })
    expect(a).toEqual(b)
    expect(a.x!.map((k) => k.value)).not.toEqual(c.x!.map((k) => k.value))
  })

  it('stays within the amplitude and enlarges scale to cover it', () => {
    const keys = motionPresetKeys('shake-soft', REST, { durationFrames: 120 })
    const amp = SHAKE_MOTION.soft.amplitude
    for (const k of [...keys.x!, ...keys.y!]) {
      expect(Math.abs(k.value - 0.5)).toBeLessThanOrEqual(amp + 1e-12)
    }
    expect(keys.scale).toEqual([{ frame: 0, value: 1 + SHAKE_MOTION.cover * amp, easing: 'linear' }])
  })

  it('caps the key count on a long clip and always keys the last frame', () => {
    for (const name of ['shake-soft', 'shake-hard', 'handheld'] as const) {
      const keys = motionPresetKeys(name, REST, { durationFrames: 3000 })
      expect(keys.x!.length).toBeLessThanOrEqual(SHAKE_MOTION.maxKeys)
      expect(keys.x![keys.x!.length - 1].frame).toBe(2999)
    }
  })

  it('impact decays back to the rest position', () => {
    const keys = motionPresetKeys('impact', REST, { durationFrames: 60 })
    const lastX = keys.x![keys.x!.length - 1]
    expect(lastX.frame).toBe(SHAKE_MOTION.impact.frames)
    expect(lastX.value).toBeCloseTo(0.5, 12)
    expect(keys.scale![0].value).toBeGreaterThan(keys.scale![1].value)
  })
})

describe('applying whole-clip presets', () => {
  it('replaces keys on its channels, so reapplying does not stack', () => {
    const c = clip()
    const once = { ...c, ...applyMotionPreset(c, 'shake-hard', {}, CTX) }
    const twice = { ...once, ...applyMotionPreset(once, 'shake-hard', {}, CTX) }
    for (const ch of ['x', 'y', 'rotation', 'scale'] as const) {
      expect(twice.keyframes!.channels[ch]!.keys.map((k) => [k.frame, k.value])).toEqual(
        once.keyframes!.channels[ch]!.keys.map((k) => [k.frame, k.value]),
      )
    }
  })

  it('leaves other channels and the legacy ramp alone', () => {
    const c = clip({ shapeAnimation: { in: 'fade', durationFrames: 10 } })
    const faded = { ...c, ...applyMotionPreset(c, 'fade-out', {}, CTX) }
    const zoomed = { ...faded, ...applyMotionPreset(faded, 'zoom-in', {}, CTX) }
    expect(zoomed.keyframes!.channels.opacity!.keys).toEqual(faded.keyframes!.channels.opacity!.keys)
    expect(zoomed.shapeAnimation).toEqual(faded.shapeAnimation)
  })

  it('bakes a baseline transform on a clip that had none, like every preset', () => {
    const c = clip({ transform: undefined })
    expect(applyMotionPreset(c, 'ken-burns', {}, CTX).transform).toEqual(DEFAULT_SHAPE_TRANSFORM)
  })
})

describe('staggerPresetPatches', () => {
  const clips = [0, 1, 2].map((i) => clip({ id: `c${i}`, startFrame: i * 60 }))

  it('shifts each clip by index × offset, one patch per clip', () => {
    const patches = staggerPresetPatches(clips, 'fade-in', {}, 5, CTX)
    expect(patches.map((p) => p.clipId)).toEqual(['c0', 'c1', 'c2'])
    const firstFrames = patches.map((p) => p.patch.keyframes!.channels.opacity!.keys[0].frame)
    expect(firstFrames).toEqual([0, 5, 10])
  })

  it('never writes a key outside its clip', () => {
    const short = [0, 1, 2, 3].map((i) => clip({ id: `s${i}`, durationFrames: 20 }))
    for (const { patch } of staggerPresetPatches(short, 'pop-in', {}, 15, CTX)) {
      for (const track of Object.values(patch.keyframes!.channels)) {
        for (const k of track!.keys) {
          expect(k.frame).toBeGreaterThanOrEqual(0)
          expect(k.frame).toBeLessThanOrEqual(19)
        }
      }
    }
  })

  it('treats a non-finite offset as zero', () => {
    const [, second] = staggerPresetPatches(clips, 'fade-in', {}, Number.NaN, CTX)
    expect(second.patch.keyframes!.channels.opacity!.keys[0].frame).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PQ-2d: exits for every entrance, reveal pairs, tracking, overshoot, breathe
// ---------------------------------------------------------------------------

describe('PQ-2d presets', () => {
  const TEXT_ONLY: MotionPresetName[] = ['tracking-in', 'tracking-out']
  const SHAPE_ONLY: MotionPresetName[] = ['highlight-sweep', 'highlight-clear', 'underline-draw', 'underline-erase']

  /** A clip of the type each preset applies to, 60 frames. */
  function fixture(name: MotionPresetName): Clip {
    if (TEXT_ONLY.includes(name)) return clip({ type: 'text', name: 'Text', shapeKind: undefined, text: 'Hello' } as Partial<Clip>)
    if (SHAPE_ONLY.includes(name)) return clip()
    return clip({ type: 'video', name: 'Video', shapeKind: undefined } as Partial<Clip>)
  }

  function trackKeys(c: Clip, channel: string) {
    return (c.keyframes?.channels as Record<string, { keys: Array<{ frame: number; value: number }> }> | undefined)?.[channel]?.keys ?? []
  }

  const apply = (c: Clip, name: MotionPresetName, params: Parameters<typeof applyMotionPreset>[2] = {}) => ({
    ...c,
    ...applyMotionPreset(c, name, params, CTX),
  })

  it('declares 17 new names after the original 19 and keeps the old ones first', () => {
    expect(MOTION_PRESET_NAMES).toHaveLength(36)
    expect(PQ2D_NAMES).toHaveLength(17)
    expect(MOTION_PRESET_NAMES.slice(0, 19)[18]).toBe('impact')
    for (const name of PQ2D_NAMES) expect(MOTION_PRESETS.some((p) => p.name === name)).toBe(true)
  })

  it('leaves the keys of the original presets as they were', () => {
    const keys = (n: MotionPresetName) => JSON.stringify(motionPresetKeys(n, REST, { durationFrames: 60 }))
    expect(keys('fade-in')).toBe(
      '{"opacity":[{"frame":0,"value":0,"easing":"linear"},{"frame":15,"value":1,"easing":"linear"}]}',
    )
    expect(keys('slide-in-left')).toBe(
      '{"x":[{"frame":0,"value":0.35,"easing":"linear"},{"frame":15,"value":0.5,"easing":"quad-out"}]}',
    )
    for (const name of MOTION_PRESET_NAMES.slice(0, 19)) {
      for (const channel of Object.keys(motionPresetKeys(name, REST, { durationFrames: 60 }))) {
        expect(isBuiltin(channel)).toBe(true)
      }
    }
  })

  function isBuiltin(channel: string) {
    return !channel.includes('.') && channel !== 'draw' && channel !== 'time'
  }

  it('slide-out presets travel in the named direction and pop-out mirrors pop-in', () => {
    const k = (n: MotionPresetName) => motionPresetKeys(n, REST, { durationFrames: 60 })
    expect(k('slide-out-left').x!.at(-1)!.value).toBeCloseTo(0.5 - 0.15, 9)
    expect(k('slide-out-right').x!.at(-1)!.value).toBeCloseTo(0.5 + 0.15, 9)
    expect(k('slide-out-up').y!.at(-1)!.value).toBeCloseTo(0.5 - 0.15, 9)
    expect(k('slide-out-down').y!.at(-1)!.value).toBeCloseTo(0.5 + 0.15, 9)
    expect(k('pop-out').scale!.at(-1)!.value).toBeCloseTo(0.6, 9)
    expect(k('pop-out').opacity!.at(-1)!.value).toBe(0)
    // scale-out zooms UP; pop-out shrinks.
    expect(k('scale-out').scale!.at(-1)!.value).toBeGreaterThan(1)
  })

  const PAIRS: Array<[MotionPresetName, MotionPresetName]> = [
    ['slide-in-left', 'slide-out-left'],
    ['slide-in-right', 'slide-out-right'],
    ['slide-in-up', 'slide-out-down'],
    ['slide-in-down', 'slide-out-up'],
    ['pop-in', 'pop-out'],
    ['wipe-in', 'wipe-out'],
    ['blur-in', 'blur-out'],
    ['tracking-in', 'tracking-out'],
    ['highlight-sweep', 'highlight-clear'],
    ['underline-draw', 'underline-erase'],
  ]

  it.each(PAIRS)('%s has an exit partner %s whose end value is its start value', (inName, outName) => {
    const inKeys = motionPresetKeys(inName, REST, { durationFrames: 60, effectId: 'e1' })
    const outKeys = motionPresetKeys(outName, REST, { durationFrames: 60, effectId: 'e1' })
    expect(Object.keys(outKeys).sort()).toEqual(Object.keys(inKeys).sort())
    for (const channel of Object.keys(inKeys) as Array<keyof typeof inKeys>) {
      const entrance = sampleChannel(inKeys[channel]!.map(withId), 0)
      const exit = sampleChannel(outKeys[channel]!.map(withId), 59)
      expect(exit).toBeCloseTo(entrance!, 9)
    }
  })

  it('pop-overshoot starts small, peaks at least 6% over rest and settles on rest; pop-out is its exit', () => {
    const keys = motionPresetKeys('pop-overshoot', REST, { durationFrames: 60 })
    const scale = keys.scale!.map(withId)
    const samples = Array.from({ length: 60 }, (_, f) => sampleChannel(scale, f)!)
    expect(samples[0]).toBeCloseTo(0.4, 9)
    expect(Math.max(...samples)).toBeGreaterThanOrEqual(1.06)
    expect(samples[59]).toBeCloseTo(1, 9)
    // Its fade is shorter than the pop.
    expect(keys.opacity![1].frame).toBeLessThan(keys.scale![1].frame)
    expect(keys.opacity![0].value).toBe(0)
  })

  it('hold-breathe swells 3% on a 2 s period and returns to rest on the last frame', () => {
    const scale = motionPresetKeys('hold-breathe', REST, { durationFrames: 150 }).scale!
    expect(scale[0]).toMatchObject({ frame: 0, value: 1 })
    expect(scale[1]).toMatchObject({ frame: 30, value: 1.03 })
    expect(scale[2]).toMatchObject({ frame: 60, value: 1 })
    expect(scale.at(-1)).toMatchObject({ frame: 149, value: 1 })
    const big = motionPresetKeys('hold-breathe', REST, { durationFrames: 150, amount: 2 }).scale!
    expect(big[1].value).toBeCloseTo(1.06, 9)
    expect(motionPresetKeys('hold-breathe', REST, { durationFrames: 150, fps: 60 }).scale![1].frame).toBe(60)
    expect(motionPresetKeys('hold-breathe', REST, { durationFrames: 20000 }).scale!.length).toBeLessThanOrEqual(SHAKE_MOTION.maxKeys)
    expect(motionPresetKeys('hold-breathe', REST, { durationFrames: 1 }).scale).toEqual([{ frame: 0, value: 1, easing: 'quad-in-out' }])
  })

  it('hold-breathe replaces scale keys, so reapplying does not stack', () => {
    const once = apply(fixture('hold-breathe'), 'hold-breathe')
    const twice = apply(once, 'hold-breathe')
    expect(trackKeys(twice, 'scale')).toHaveLength(trackKeys(once, 'scale').length)
  })

  it.each(PQ2D_NAMES)('%s is idempotent: same effect, same key counts on reapplying', (name) => {
    const once = apply(fixture(name), name)
    expect(Object.keys(once.keyframes?.channels ?? {}).length).toBeGreaterThan(0)
    const twice = apply(once, name)
    expect(Object.keys(twice.keyframes!.channels).sort()).toEqual(Object.keys(once.keyframes!.channels).sort())
    for (const channel of Object.keys(once.keyframes!.channels)) {
      expect(trackKeys(twice, channel)).toHaveLength(trackKeys(once, channel).length)
    }
    expect(twice.effects?.map((e) => e.id)).toEqual(once.effects?.map((e) => e.id))
    expect(twice.mask).toEqual(once.mask)
  })

  it('blur-in and blur-out share ONE marked gaussianBlur and key its radius', () => {
    const inOnly = apply(fixture('blur-in'), 'blur-in')
    expect(inOnly.effects).toHaveLength(1)
    const effect = inOnly.effects![0]
    expect(effect.kind).toBe('gaussianBlur')
    expect(effect.preset).toBe(BLUR_PRESET_MARK)
    expect(effect.params.radius).toBe(0)
    const keys = trackKeys(inOnly, `fx.${effect.id}.radius`)
    expect(keys.map((k) => [k.frame, k.value])).toEqual([[0, 24], [15, 0]])
    const both = apply(inOnly, 'blur-out')
    expect(both.effects).toHaveLength(1)
    expect(both.effects![0].id).toBe(effect.id)
    expect(trackKeys(both, `fx.${effect.id}.radius`).map((k) => k.value)).toEqual([24, 0, 0, 24])
  })

  it('blur keeps a gaussianBlur the user added themselves', () => {
    const own = { id: 'mine', kind: 'gaussianBlur', params: { radius: 5 } }
    const out = apply(clip({ type: 'video', shapeKind: undefined, effects: [own] } as Partial<Clip>), 'blur-in')
    expect(out.effects).toHaveLength(2)
    expect(out.effects![0]).toEqual(own)
  })

  it('wipe sets a full-box rect mask and keys mask.width', () => {
    const wiped = apply(fixture('wipe-in'), 'wipe-in')
    expect(wiped.mask).toEqual({ kind: 'rect', x: 0, y: 0, width: 1, height: 1 })
    expect(trackKeys(wiped, 'mask.width').map((k) => [k.frame, k.value])).toEqual([[0, 0], [15, 1]])
    const out = apply(fixture('wipe-out'), 'wipe-out')
    expect(trackKeys(out, 'mask.width').map((k) => [k.frame, k.value])).toEqual([[44, 1], [59, 0]])
  })

  it('tracking stretches scaleX 1.12 to 1 with a fade, text only', () => {
    const t = apply(fixture('tracking-in'), 'tracking-in')
    expect(trackKeys(t, 'scaleX').map((k) => [k.frame, k.value])).toEqual([[0, 1.12], [15, 1]])
    expect(trackKeys(t, 'opacity')).toHaveLength(2)
    expect(MOTION_PRESETS.find((p) => p.name === 'tracking-in')!.label).toBe('Tracking in (stretch)')
  })

  it('highlight-sweep anchors the bar to its left edge without moving that edge', () => {
    const bar = fixture('highlight-sweep')
    const before = DEFAULT_SHAPE_TRANSFORM
    const leftBefore = before.x * STAGE.width - before.anchor.x * before.scale * STAGE.height
    const swept = apply(bar, 'highlight-sweep')
    expect(swept.transform!.anchor.x).toBe(0)
    expect(swept.transform!.x * STAGE.width).toBeCloseTo(leftBefore, 6)
    expect(trackKeys(swept, 'scaleX').map((k) => [k.frame, k.value])).toEqual([[0, 0], [15, 1]])
    const cleared = apply(swept, 'highlight-clear')
    expect(cleared.transform!.x).toBe(swept.transform!.x)
    expect(trackKeys(cleared, 'scaleX').map((k) => k.value)).toEqual([0, 1, 1, 0])
  })

  it('underline-draw / underline-erase write the keys the Draw-on button writes', () => {
    const shape = fixture('underline-draw')
    for (const [name, mode] of [['underline-draw', 'draw-on'], ['underline-erase', 'draw-off']] as const) {
      const viaPreset = apply(shape, name)
      const viaButton = applyDrawOn(shape, mode)
      const pick = (c: Partial<Clip>) =>
        (c.keyframes!.channels.draw!.keys as Array<{ frame: number; value: number; easingBezier?: number[] }>).map((k) => [k.frame, k.value, k.easingBezier])
      expect(pick(viaPreset)).toEqual(pick(viaButton))
      expect(viaPreset.shapeDraw).toEqual(viaButton.shapeDraw)
    }
  })

  it('applies to the clip types it names and returns {} for the rest', () => {
    const audio = clip({ type: 'audio', shapeKind: undefined } as Partial<Clip>)
    const text = clip({ type: 'text', shapeKind: undefined } as Partial<Clip>)
    for (const name of ['wipe-in', 'wipe-out', 'blur-in', 'blur-out', 'slide-out-left', 'pop-out', 'hold-breathe'] as const) {
      expect(applyMotionPreset(audio, name, {}, CTX)).toEqual({})
    }
    for (const name of ['underline-draw', 'highlight-sweep', 'highlight-clear', 'underline-erase'] as const) {
      expect(applyMotionPreset(text, name, {}, CTX)).toEqual({})
    }
    expect(applyMotionPreset(clip(), 'tracking-in', {}, CTX)).toEqual({})
  })

  const RAMPED: Array<[MotionPresetName, string]> = [
    ['slide-out-left', 'x'],
    ['pop-out', 'scale'],
    ['wipe-out', 'mask.width'],
    ['tracking-out', 'scaleX'],
    ['highlight-clear', 'scaleX'],
    ['underline-erase', 'draw'],
    ['wipe-in', 'mask.width'],
    ['tracking-in', 'scaleX'],
    ['highlight-sweep', 'scaleX'],
    ['underline-draw', 'draw'],
    ['pop-overshoot', 'scale'],
  ]

  it.each(RAMPED)('%s honours rampFrames on %s', (name, channel) => {
    const keys = motionPresetKeys(name, REST, { durationFrames: 60, rampFrames: 10 })[channel as 'x']!
    const end = MOTION_PRESETS.find((p) => p.name === name)!.end
    if (end === 'in') expect(keys.at(-1)!.frame).toBe(10)
    else expect(keys[0].frame).toBe(49)
  })

  it('blur honours rampFrames', () => {
    const keys = motionPresetKeys('blur-out', REST, { durationFrames: 60, rampFrames: 10, effectId: 'z' })['fx.z.radius']!
    expect(keys.map((k) => k.frame)).toEqual([49, 59])
  })

  it('staggers: each clip gets its own effect and its keys shift together inside the clip', () => {
    const clips = [1, 2, 3].map((i) => clip({ id: `c${i}`, type: 'video', shapeKind: undefined, durationFrames: 20 } as Partial<Clip>))
    const patches = staggerPresetPatches(clips, 'blur-in', {}, 8, CTX)
    const ids = new Set<string>()
    patches.forEach(({ patch }, i) => {
      const effect = patch.effects![0]
      ids.add(effect.id)
      const keys = trackKeys({ ...clips[i], ...patch } as Clip, `fx.${effect.id}.radius`)
      expect(keys[0].frame).toBe(Math.min(19, i * 8))
      for (const k of keys) expect(k.frame).toBeLessThanOrEqual(19)
    })
    expect(ids.size).toBe(3)
    const wipes = staggerPresetPatches(clips, 'wipe-in', {}, 8, CTX)
    expect(wipes[1].patch.mask).toBeDefined()
    expect(trackKeys({ ...clips[1], ...wipes[1].patch } as Clip, 'mask.width')[0].frame).toBe(8)
  })

  it('presetsFor hides every new preset unless given a clipType', () => {
    const all = ['x', 'y', 'scale', 'scaleX', 'rotation', 'opacity'] as const
    const plain = presetsFor(all).map((p) => p.name)
    for (const name of PQ2D_NAMES) expect(plain).not.toContain(name)
    const asText = presetsFor(all, 'opacity', 'text').map((p) => p.name)
    expect(asText).toEqual(expect.arrayContaining(['tracking-in', 'wipe-in', 'blur-out', 'slide-out-left', 'hold-breathe']))
    expect(asText).not.toContain('underline-draw')
    const asShape = presetsFor(all, 'opacity', 'shape').map((p) => p.name)
    expect(asShape).toEqual(expect.arrayContaining(['highlight-sweep', 'underline-erase']))
    expect(asShape).not.toContain('tracking-in')
    expect(presetsFor(['volume'], 'volume', 'audio').map((p) => p.name)).toEqual(['fade-in', 'fade-out'])
  })

  it('presetSetup is empty for every preset from before PQ-2d', () => {
    for (const name of MOTION_PRESET_NAMES.slice(0, 19)) expect(presetSetup(name, clip(), CTX)).toEqual({})
  })
})

describe('staggerPresetPatches offsets (MOT-2)', () => {
  const clips = [0, 1, 2].map((i) => clip({ id: `o${i}`, startFrame: i * 60 }))

  it('omitting offsets reproduces the old patches exactly (key ids are random, so compare without them)', () => {
    const flat = (o?: number[]) => JSON.stringify(staggerPresetPatches(clips, 'fade-in', {}, 5, CTX, o)).replace(/"id":"[^"]*"/g, '')
    expect(flat(undefined)).toBe(flat())
    expect(flat([0, 5, 10])).toBe(flat())
  })

  it('per-clip offsets move each clip independently', () => {
    const first = staggerPresetPatches(clips, 'fade-in', {}, 5, CTX, [8, 0, 4]).map((p) => p.patch.keyframes!.channels.opacity!.keys[0].frame)
    expect(first).toEqual([8, 0, 4])
  })
})
