import { describe, it, expect } from 'vitest'
import {
  sampleTextAnimation,
  resolveRampFrames,
  TEXT_ANIMATION_KINDS,
  DEFAULT_TEXT_TRANSFORM,
  DEFAULT_SHAPE_TRANSFORM,
  SLIDE_TRAVEL_NORMALIZED,
  SPIN_TRAVEL_RADIANS,
} from './textAnimation'
import type { SampleTextAnimationArgs } from './textAnimation'
import type { TextAnimation, TextAnimationKind, Transform } from '../types'

function makeTransform(overrides?: Partial<Transform>): Transform {
  return {
    x: 0.25,
    y: 0.75,
    scale: 2,
    rotation: 0.5,
    anchor: { x: 0.5, y: 0.5 },
    ...overrides,
  }
}

function sample(overrides: Partial<SampleTextAnimationArgs> & { animation: TextAnimation | undefined }) {
  return sampleTextAnimation({
    localFrame: 0,
    clipDurationFrames: 60,
    transform: undefined,
    defaultTransform: DEFAULT_TEXT_TRANSFORM,
    ...overrides,
  })
}

/** Every kind in the union — kept honest by TEXT_ANIMATION_KINDS below. */
const ALL_KINDS: TextAnimationKind[] = [
  'fade',
  'spin',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
]

describe('resolveRampFrames', () => {
  it('passes whole positive durations through', () => {
    expect(resolveRampFrames(15)).toBe(15)
    expect(resolveRampFrames(1)).toBe(1)
  })

  it('floors a fractional duration to whole frames, never below 1', () => {
    expect(resolveRampFrames(7.9)).toBe(7)
    expect(resolveRampFrames(0.5)).toBe(1)
  })

  it('clamps 0 and negatives to a single frame', () => {
    expect(resolveRampFrames(0)).toBe(1)
    expect(resolveRampFrames(-30)).toBe(1)
  })

  it('clamps non-finite durations to a single frame', () => {
    expect(resolveRampFrames(Number.NaN)).toBe(1)
    expect(resolveRampFrames(Number.POSITIVE_INFINITY)).toBe(1)
    expect(resolveRampFrames(Number.NEGATIVE_INFINITY)).toBe(1)
  })
})

describe('TEXT_ANIMATION_KINDS', () => {
  it('lists every kind in the union exactly once', () => {
    const listed = TEXT_ANIMATION_KINDS.map((o) => o.kind)
    expect([...listed].sort()).toEqual([...ALL_KINDS].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('gives every kind a human-readable label and an applicability', () => {
    for (const option of TEXT_ANIMATION_KINDS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.label).not.toBe(option.kind)
      expect(['both', 'text-only']).toContain(option.appliesTo)
    }
  })

  it('offers every kind to shapes, now that shape rotation renders', () => {
    // `spin` was text-only while neither shape painter read
    // `transform.rotation`: ShapeLayer uploaded FULL_STAGE_MAT3 and
    // ExportWorker.drawShape had no ctx.rotate, so offering it would have been
    // a control that silently did nothing. Both now rasterize through
    // `shapePaint.paintShape`, which rotates about the box centre, so nothing
    // is text-only any more. The field stays for a future kind that genuinely
    // depends on glyph layout.
    const textOnly = TEXT_ANIMATION_KINDS.filter((o) => o.appliesTo === 'text-only')
    expect(textOnly.map((o) => o.kind)).toEqual([])
  })

  it('leads with fade, the kind that existed before the union widened', () => {
    expect(TEXT_ANIMATION_KINDS[0].kind).toBe('fade')
  })
})

describe('sampleTextAnimation — no-op cases', () => {
  it('returns full opacity and no transform when there is no animation', () => {
    const result = sample({ animation: undefined })
    expect(result.opacity).toBe(1)
    expect(result.transform).toBeUndefined()
  })

  it('returns full opacity and no transform when neither direction is set', () => {
    const result = sample({ animation: { durationFrames: 15 } })
    expect(result.opacity).toBe(1)
    expect(result.transform).toBeUndefined()
  })
})

describe('sampleTextAnimation — fade (opacity only)', () => {
  const anim: TextAnimation = { in: 'fade', out: 'fade', durationFrames: 10 }

  it('reproduces the linear in-ramp the resolver already shipped', () => {
    expect(sample({ animation: anim, localFrame: 0 }).opacity).toBe(0)
    expect(sample({ animation: anim, localFrame: 5 }).opacity).toBeCloseTo(0.5, 10)
    expect(sample({ animation: anim, localFrame: 10 }).opacity).toBe(1)
  })

  it('reproduces the linear out-ramp the resolver already shipped', () => {
    // clip is 60 frames, so the out ramp opens at localFrame 50.
    expect(sample({ animation: anim, localFrame: 50 }).opacity).toBe(1)
    expect(sample({ animation: anim, localFrame: 55 }).opacity).toBeCloseTo(0.5, 10)
    expect(sample({ animation: anim, localFrame: 60 }).opacity).toBe(0)
  })

  it('sits at full opacity between the two ramps', () => {
    expect(sample({ animation: anim, localFrame: 30 }).opacity).toBe(1)
  })

  it('never emits a transform, so a clip without one keeps the renderer default', () => {
    for (const localFrame of [0, 5, 30, 55, 60]) {
      expect(sample({ animation: anim, localFrame }).transform).toBeUndefined()
    }
  })

  it('leaves an authored transform alone', () => {
    const transform = makeTransform()
    const result = sample({ animation: anim, localFrame: 5, transform })
    expect(result.transform).toBeUndefined()
  })

  it('fades in only when out is unset', () => {
    const inOnly: TextAnimation = { in: 'fade', durationFrames: 10 }
    expect(sample({ animation: inOnly, localFrame: 0 }).opacity).toBe(0)
    expect(sample({ animation: inOnly, localFrame: 10 }).opacity).toBe(1)
    expect(sample({ animation: inOnly, localFrame: 60 }).opacity).toBe(1)
  })

  it('fades out only when in is unset', () => {
    const outOnly: TextAnimation = { out: 'fade', durationFrames: 10 }
    expect(sample({ animation: outOnly, localFrame: 0 }).opacity).toBe(1)
    expect(sample({ animation: outOnly, localFrame: 50 }).opacity).toBe(1)
    expect(sample({ animation: outOnly, localFrame: 60 }).opacity).toBe(0)
  })
})

describe('sampleTextAnimation — slide entry direction', () => {
  const cases: Array<{
    kind: TextAnimationKind
    axis: 'x' | 'y'
    /** Sign of the clip's offset from rest on the FIRST frame of the entry. */
    startSign: 1 | -1
  }> = [
    // travels up into rest, so it starts below (y grows downward)
    { kind: 'slide-up', axis: 'y', startSign: 1 },
    { kind: 'slide-down', axis: 'y', startSign: -1 },
    { kind: 'slide-left', axis: 'x', startSign: 1 },
    { kind: 'slide-right', axis: 'x', startSign: -1 },
  ]

  for (const { kind, axis, startSign } of cases) {
    it(`${kind} starts one travel vector off rest on the ${axis} axis and arrives at rest`, () => {
      const anim: TextAnimation = { in: kind, durationFrames: 10 }
      const rest = DEFAULT_TEXT_TRANSFORM

      const first = sample({ animation: anim, localFrame: 0 }).transform
      expect(first).toBeDefined()
      expect(first![axis]).toBeCloseTo(
        rest[axis] + startSign * SLIDE_TRAVEL_NORMALIZED,
        10,
      )
      // the other axis never moves
      const other = axis === 'x' ? 'y' : 'x'
      expect(first![other]).toBeCloseTo(rest[other], 10)
      // a slide never rotates
      expect(first!.rotation).toBe(0)

      const landed = sample({ animation: anim, localFrame: 10 }).transform
      expect(landed![axis]).toBeCloseTo(rest[axis], 10)

      // still exactly at rest well past the ramp
      const after = sample({ animation: anim, localFrame: 40 }).transform
      expect(after![axis]).toBeCloseTo(rest[axis], 10)
    })

    it(`${kind} moves monotonically toward rest across the entry ramp`, () => {
      const anim: TextAnimation = { in: kind, durationFrames: 10 }
      const rest = DEFAULT_TEXT_TRANSFORM
      let previous = Number.POSITIVE_INFINITY
      for (let f = 0; f <= 10; f++) {
        const t = sample({ animation: anim, localFrame: f }).transform!
        const distance = Math.abs(t[axis] - rest[axis])
        expect(distance).toBeLessThanOrEqual(previous + 1e-12)
        previous = distance
      }
      expect(previous).toBeCloseTo(0, 10)
    })
  }
})

describe('sampleTextAnimation — slide exit direction', () => {
  it('slide-up departs upward (decreasing y), the same direction it means on entry', () => {
    const anim: TextAnimation = { out: 'slide-up', durationFrames: 10 }
    const rest = DEFAULT_TEXT_TRANSFORM

    // at rest until the out ramp opens (clip is 60 frames, ramp is 10)
    expect(sample({ animation: anim, localFrame: 0 }).transform!.y).toBeCloseTo(rest.y, 10)
    expect(sample({ animation: anim, localFrame: 50 }).transform!.y).toBeCloseTo(rest.y, 10)

    const mid = sample({ animation: anim, localFrame: 55 }).transform!
    expect(mid.y).toBeLessThan(rest.y)

    const end = sample({ animation: anim, localFrame: 60 }).transform!
    expect(end.y).toBeCloseTo(rest.y - SLIDE_TRAVEL_NORMALIZED, 10)
  })

  it('slide-down departs downward', () => {
    const anim: TextAnimation = { out: 'slide-down', durationFrames: 10 }
    const end = sample({ animation: anim, localFrame: 60 }).transform!
    expect(end.y).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.y + SLIDE_TRAVEL_NORMALIZED, 10)
  })

  it('slide-left departs leftward', () => {
    const anim: TextAnimation = { out: 'slide-left', durationFrames: 10 }
    const end = sample({ animation: anim, localFrame: 60 }).transform!
    expect(end.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x - SLIDE_TRAVEL_NORMALIZED, 10)
  })

  it('slide-right departs rightward', () => {
    const anim: TextAnimation = { out: 'slide-right', durationFrames: 10 }
    const end = sample({ animation: anim, localFrame: 60 }).transform!
    expect(end.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x + SLIDE_TRAVEL_NORMALIZED, 10)
  })

  it('in slide-up + out slide-down returns the way it came', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'slide-down', durationFrames: 10 }
    const rest = DEFAULT_TEXT_TRANSFORM
    const entry = sample({ animation: anim, localFrame: 0 }).transform!
    const exit = sample({ animation: anim, localFrame: 60 }).transform!
    expect(entry.y).toBeCloseTo(rest.y + SLIDE_TRAVEL_NORMALIZED, 10)
    expect(exit.y).toBeCloseTo(rest.y + SLIDE_TRAVEL_NORMALIZED, 10)
  })

  it('does not touch opacity', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'slide-down', durationFrames: 10 }
    for (const localFrame of [0, 5, 30, 55, 60]) {
      expect(sample({ animation: anim, localFrame }).opacity).toBe(1)
    }
  })
})

describe('sampleTextAnimation — spin', () => {
  it('enters from a quarter turn counter-clockwise and lands on the authored rotation', () => {
    const anim: TextAnimation = { in: 'spin', durationFrames: 10 }
    const transform = makeTransform({ rotation: 0.5 })

    const first = sample({ animation: anim, localFrame: 0, transform }).transform!
    expect(first.rotation).toBeCloseTo(0.5 - SPIN_TRAVEL_RADIANS, 10)

    const landed = sample({ animation: anim, localFrame: 10, transform }).transform!
    expect(landed.rotation).toBeCloseTo(0.5, 10)
  })

  it('exits by carrying a further quarter turn clockwise', () => {
    const anim: TextAnimation = { out: 'spin', durationFrames: 10 }
    const transform = makeTransform({ rotation: 0.5 })

    expect(sample({ animation: anim, localFrame: 50, transform }).transform!.rotation).toBeCloseTo(0.5, 10)
    expect(sample({ animation: anim, localFrame: 60, transform }).transform!.rotation).toBeCloseTo(
      0.5 + SPIN_TRAVEL_RADIANS,
      10,
    )
  })

  it('does not move the clip or change its opacity', () => {
    const anim: TextAnimation = { in: 'spin', out: 'spin', durationFrames: 10 }
    const transform = makeTransform()
    for (const localFrame of [0, 5, 30, 55, 60]) {
      const result = sample({ animation: anim, localFrame, transform })
      expect(result.opacity).toBe(1)
      expect(result.transform!.x).toBe(transform.x)
      expect(result.transform!.y).toBe(transform.y)
    }
  })
})

describe('sampleTextAnimation — mixed kinds across the two directions', () => {
  it('fades in and slides out, emitting a transform for the whole clip', () => {
    const anim: TextAnimation = { in: 'fade', out: 'slide-up', durationFrames: 10 }
    const rest = DEFAULT_TEXT_TRANSFORM

    const entry = sample({ animation: anim, localFrame: 0 })
    expect(entry.opacity).toBe(0)
    // the fade contributes no travel, so the clip sits at rest while it fades in
    expect(entry.transform!.y).toBeCloseTo(rest.y, 10)

    const exit = sample({ animation: anim, localFrame: 60 })
    expect(exit.opacity).toBe(1)
    expect(exit.transform!.y).toBeCloseTo(rest.y - SLIDE_TRAVEL_NORMALIZED, 10)
  })

  it('slides in and fades out', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'fade', durationFrames: 10 }
    const entry = sample({ animation: anim, localFrame: 0 })
    expect(entry.opacity).toBe(1)
    expect(entry.transform!.y).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.y + SLIDE_TRAVEL_NORMALIZED, 10)

    const exit = sample({ animation: anim, localFrame: 60 })
    expect(exit.opacity).toBe(0)
  })

  it('combines a spin entry with a slide exit on both channels', () => {
    const anim: TextAnimation = { in: 'spin', out: 'slide-left', durationFrames: 10 }
    const entry = sample({ animation: anim, localFrame: 0 }).transform!
    expect(entry.rotation).toBeCloseTo(-SPIN_TRAVEL_RADIANS, 10)
    expect(entry.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x, 10)

    const exit = sample({ animation: anim, localFrame: 60 }).transform!
    expect(exit.rotation).toBeCloseTo(0, 10)
    expect(exit.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x - SLIDE_TRAVEL_NORMALIZED, 10)
  })
})

describe('sampleTextAnimation — easing', () => {
  it('decelerates into rest on entry (ease-out covers more than half the travel by the midpoint)', () => {
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }
    const rest = DEFAULT_TEXT_TRANSFORM
    const mid = sample({ animation: anim, localFrame: 5 }).transform!
    const covered = (rest.y + SLIDE_TRAVEL_NORMALIZED - mid.y) / SLIDE_TRAVEL_NORMALIZED
    // easeOut(0.5) = 0.75
    expect(covered).toBeCloseTo(0.75, 10)
  })

  it('accelerates away on exit (ease-in covers less than half the travel by the midpoint)', () => {
    const anim: TextAnimation = { out: 'slide-up', durationFrames: 10 }
    const rest = DEFAULT_TEXT_TRANSFORM
    const mid = sample({ animation: anim, localFrame: 55 }).transform!
    const covered = (rest.y - mid.y) / SLIDE_TRAVEL_NORMALIZED
    // easeIn(0.5) = 0.25
    expect(covered).toBeCloseTo(0.25, 10)
  })

  it('keeps opacity linear so existing fade projects are unchanged', () => {
    const anim: TextAnimation = { in: 'fade', durationFrames: 10 }
    expect(sample({ animation: anim, localFrame: 3 }).opacity).toBeCloseTo(0.3, 10)
    expect(sample({ animation: anim, localFrame: 7 }).opacity).toBeCloseTo(0.7, 10)
  })
})

describe('sampleTextAnimation — authored transform is preserved', () => {
  it('carries scale, scaleX, scaleY and anchor through untouched', () => {
    const transform: Transform = {
      x: 0.25,
      y: 0.75,
      scale: 3,
      rotation: 0.2,
      anchor: { x: 0.1, y: 0.9 },
      scaleX: 1.5,
      scaleY: 0.5,
    }
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }
    const result = sample({ animation: anim, localFrame: 3, transform }).transform!

    expect(result.scale).toBe(3)
    expect(result.scaleX).toBe(1.5)
    expect(result.scaleY).toBe(0.5)
    expect(result.anchor).toEqual({ x: 0.1, y: 0.9 })
    expect(result.rotation).toBe(0.2)
    expect(result.x).toBe(0.25)
  })

  it('animates around the authored resting position, not the stage centre', () => {
    const transform = makeTransform({ x: 0.25, y: 0.75 })
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }

    expect(sample({ animation: anim, localFrame: 0, transform }).transform!.y).toBeCloseTo(
      0.75 + SLIDE_TRAVEL_NORMALIZED,
      10,
    )
    expect(sample({ animation: anim, localFrame: 10, transform }).transform!.y).toBeCloseTo(0.75, 10)
  })

  it('does not mutate the authored transform or share its anchor object', () => {
    const transform = makeTransform()
    const snapshot = JSON.parse(JSON.stringify(transform))
    const anim: TextAnimation = { in: 'slide-up', out: 'spin', durationFrames: 10 }
    const result = sample({ animation: anim, localFrame: 3, transform }).transform!

    expect(transform).toEqual(snapshot)
    expect(result.anchor).not.toBe(transform.anchor)
  })
})

describe('sampleTextAnimation — synthesized transform reproduces the renderer default', () => {
  it('rests a text clip at the text default when the ramp completes', () => {
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }
    const result = sample({
      animation: anim,
      localFrame: 30,
      transform: undefined,
      defaultTransform: DEFAULT_TEXT_TRANSFORM,
    }).transform!
    expect(result).toEqual(DEFAULT_TEXT_TRANSFORM)
  })

  it('rests a shape clip at the shape default (scale 0.5, not 1) when the ramp completes', () => {
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }
    const result = sampleTextAnimation({
      animation: anim,
      localFrame: 30,
      clipDurationFrames: 60,
      transform: undefined,
      defaultTransform: DEFAULT_SHAPE_TRANSFORM,
    }).transform!
    expect(result).toEqual(DEFAULT_SHAPE_TRANSFORM)
    expect(result.scale).toBe(0.5)
  })

  it('exposes the two renderer defaults as distinct values', () => {
    expect(DEFAULT_TEXT_TRANSFORM.scale).toBe(1)
    expect(DEFAULT_SHAPE_TRANSFORM.scale).toBe(0.5)
    expect(DEFAULT_TEXT_TRANSFORM.x).toBe(0.5)
    expect(DEFAULT_TEXT_TRANSFORM.y).toBe(0.5)
    expect(DEFAULT_TEXT_TRANSFORM.rotation).toBe(0)
  })

  it('never hands back the exported constant itself', () => {
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }
    const result = sample({ animation: anim, localFrame: 30 }).transform!
    expect(result).not.toBe(DEFAULT_TEXT_TRANSFORM)
    expect(result.anchor).not.toBe(DEFAULT_TEXT_TRANSFORM.anchor)
  })
})

describe('sampleTextAnimation — ramps longer than the clip', () => {
  it('never lets a fade exceed 1 when the ramp outlives the clip', () => {
    const anim: TextAnimation = { in: 'fade', out: 'fade', durationFrames: 120 }
    for (let f = 0; f <= 10; f++) {
      const opacity = sample({ animation: anim, localFrame: f, clipDurationFrames: 10 }).opacity
      expect(opacity).toBeGreaterThanOrEqual(0)
      expect(opacity).toBeLessThanOrEqual(1)
    }
  })

  it('leaves an overlapped clip short of full opacity throughout', () => {
    const anim: TextAnimation = { in: 'fade', out: 'fade', durationFrames: 20 }
    // 10-frame clip: the two 20-frame ramps overlap for its whole life.
    const mid = sample({ animation: anim, localFrame: 5, clipDurationFrames: 10 }).opacity
    expect(mid).toBeCloseTo(0.25, 10)
  })

  it('sums the travel of overlapping ramps so the motion stays continuous', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'slide-up', durationFrames: 20 }
    const rest = DEFAULT_TEXT_TRANSFORM
    let previous = Number.POSITIVE_INFINITY
    for (let f = 0; f <= 10; f++) {
      const y = sample({ animation: anim, localFrame: f, clipDurationFrames: 10 }).transform!.y
      // travels upward without ever reversing
      expect(y).toBeLessThanOrEqual(previous + 1e-12)
      previous = y
      expect(Number.isFinite(y)).toBe(true)
    }
    // starts below rest and ends above it
    const start = sample({ animation: anim, localFrame: 0, clipDurationFrames: 10 }).transform!.y
    const end = sample({ animation: anim, localFrame: 10, clipDurationFrames: 10 }).transform!.y
    expect(start).toBeGreaterThan(rest.y)
    expect(end).toBeLessThan(rest.y)
  })

  it('does not jump between frames when opposing ramps overlap', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'slide-down', durationFrames: 20 }
    let previous: number | null = null
    for (let f = 0; f <= 10; f++) {
      const y = sample({ animation: anim, localFrame: f, clipDurationFrames: 10 }).transform!.y
      if (previous !== null) {
        // no frame moves the clip more than a fraction of the travel
        expect(Math.abs(y - previous)).toBeLessThan(SLIDE_TRAVEL_NORMALIZED / 2)
      }
      previous = y
    }
  })
})

describe('sampleTextAnimation — degenerate inputs never produce NaN or Infinity', () => {
  const degenerateDurations = [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 0.4, 7.5]

  for (const durationFrames of degenerateDurations) {
    for (const kind of ALL_KINDS) {
      it(`stays finite for ${kind} with durationFrames=${String(durationFrames)}`, () => {
        for (const localFrame of [-5, 0, 1, 30, 59, 60, 120]) {
          const result = sample({
            animation: { in: kind, out: kind, durationFrames },
            localFrame,
            transform: makeTransform(),
          })
          expect(Number.isFinite(result.opacity)).toBe(true)
          expect(result.opacity).toBeGreaterThanOrEqual(0)
          expect(result.opacity).toBeLessThanOrEqual(1)
          if (result.transform) {
            expect(Number.isFinite(result.transform.x)).toBe(true)
            expect(Number.isFinite(result.transform.y)).toBe(true)
            expect(Number.isFinite(result.transform.rotation)).toBe(true)
          }
        }
      })
    }
  }

  it('treats a zero-length duration as a one-frame ramp', () => {
    const anim: TextAnimation = { in: 'fade', durationFrames: 0 }
    expect(sample({ animation: anim, localFrame: 0 }).opacity).toBe(0)
    expect(sample({ animation: anim, localFrame: 1 }).opacity).toBe(1)
  })

  it('survives a zero-length clip', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'slide-up', durationFrames: 10 }
    const result = sample({ animation: anim, localFrame: 0, clipDurationFrames: 0 })
    expect(Number.isFinite(result.transform!.x)).toBe(true)
    expect(Number.isFinite(result.transform!.y)).toBe(true)
  })

  it('survives non-finite frame counts', () => {
    const anim: TextAnimation = { in: 'slide-up', out: 'fade', durationFrames: 10 }
    const result = sample({
      animation: anim,
      localFrame: Number.NaN,
      clipDurationFrames: Number.NaN,
    })
    expect(Number.isFinite(result.opacity)).toBe(true)
    expect(Number.isFinite(result.transform!.y)).toBe(true)
  })

  it('falls back to neutral values when the stored transform holds non-finite numbers', () => {
    const corrupt: Transform = {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      scale: 1,
      rotation: Number.NaN,
      anchor: { x: 0.5, y: 0.5 },
    }
    const anim: TextAnimation = { in: 'slide-up', durationFrames: 10 }
    const result = sample({ animation: anim, localFrame: 10, transform: corrupt }).transform!
    expect(result.x).toBe(0.5)
    expect(result.y).toBe(0.5)
    expect(result.rotation).toBe(0)
  })

  it('clamps a negative localFrame to the start of the entry ramp', () => {
    const anim: TextAnimation = { in: 'fade', durationFrames: 10 }
    expect(sample({ animation: anim, localFrame: -20 }).opacity).toBe(0)
  })

  it('clamps a localFrame past the clip end to a fully departed exit', () => {
    const anim: TextAnimation = { out: 'fade', durationFrames: 10 }
    expect(sample({ animation: anim, localFrame: 500 }).opacity).toBe(0)
  })
})

describe('sampleTextAnimation — every kind is handled', () => {
  for (const kind of ALL_KINDS) {
    it(`${kind} produces a real effect on at least one channel`, () => {
      const anim: TextAnimation = { in: kind, out: kind, durationFrames: 10 }
      const rest = DEFAULT_TEXT_TRANSFORM
      const entry = sample({ animation: anim, localFrame: 0 })
      const midway = sample({ animation: anim, localFrame: 30 })

      const opacityMoved = entry.opacity !== midway.opacity
      const transformMoved =
        entry.transform !== undefined &&
        (entry.transform.x !== rest.x ||
          entry.transform.y !== rest.y ||
          entry.transform.rotation !== rest.rotation)

      expect(opacityMoved || transformMoved).toBe(true)
    })

    it(`${kind} is back to neutral between the two ramps`, () => {
      const anim: TextAnimation = { in: kind, out: kind, durationFrames: 10 }
      const result = sample({ animation: anim, localFrame: 30 })
      expect(result.opacity).toBe(1)
      if (result.transform) {
        expect(result.transform).toEqual(DEFAULT_TEXT_TRANSFORM)
      }
    })
  }
})
