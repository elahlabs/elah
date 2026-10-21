/**
 * Tests for the layered `MotionSpec` path and the easing library.
 *
 * The enum path is covered separately and exhaustively by
 * `legacyAnimationParity.test.ts`; this file covers what the enum could never
 * express — several channels at once, scale, and non-monotonic curves.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TEXT_TRANSFORM,
  TEXT_ANIMATION_EASINGS,
  motionForKind,
  sampleTextAnimation,
} from './textAnimation'
import type { MotionSpec, TextAnimationEasing, Transform } from '../types'

function sampleAt(
  animation: Parameters<typeof sampleTextAnimation>[0]['animation'],
  localFrame: number,
  clipDurationFrames = 60,
  transform?: Transform,
) {
  return sampleTextAnimation({
    animation,
    localFrame,
    clipDurationFrames,
    transform,
    defaultTransform: DEFAULT_TEXT_TRANSFORM,
  })
}

describe('easing library', () => {
  it('exposes every curve the type allows', () => {
    // 31 curves are declared (linear + ten families x in/out/in-out) on TextAnimationEasing; the map is keyed by that
    // union, so a missing one is a compile error and this pins the count.
    expect(TEXT_ANIMATION_EASINGS.length).toBe(31)
  })

  it('starts at 0 and ends at 1 for every curve', () => {
    // A curve that does not land exactly on 1 leaves the clip permanently short
    // of its authored resting state — the defect `expo-out` is special-cased for.
    for (const name of TEXT_ANIMATION_EASINGS) {
      const spec: MotionSpec = { offsetY: 0.1, ease: name }
      const atStart = sampleAt({ inMotion: spec, durationFrames: 10 }, 0)
      const atEnd = sampleAt({ inMotion: spec, durationFrames: 10 }, 10)
      expect(atStart.transform?.y).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.y + 0.1, 10)
      expect(atEnd.transform?.y).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.y, 10)
    }
  })

  it('stays finite across the whole ramp for every curve', () => {
    for (const name of TEXT_ANIMATION_EASINGS) {
      for (let f = 0; f <= 20; f++) {
        const s = sampleAt(
          { inMotion: { offsetY: 0.1, scale: 0.5, rotation: 0.3, ease: name }, durationFrames: 20 },
          f,
        )
        expect(Number.isFinite(s.transform!.x)).toBe(true)
        expect(Number.isFinite(s.transform!.y)).toBe(true)
        expect(Number.isFinite(s.transform!.rotation)).toBe(true)
        expect(Number.isFinite(s.transform!.scale)).toBe(true)
      }
    }
  })

  it('overshoots past rest on back-out, which is the point of it', () => {
    // Entering from BELOW rest (positive offsetY), a curve that overshoots must
    // carry the block past rest to negative offset partway through.
    const spec: MotionSpec = { offsetY: 0.1, ease: 'back-out' }
    let sawOvershoot = false
    for (let f = 0; f <= 20; f++) {
      const y = sampleAt({ inMotion: spec, durationFrames: 20 }, f).transform!.y
      if (y < DEFAULT_TEXT_TRANSFORM.y - 1e-9) sawOvershoot = true
    }
    expect(sawOvershoot).toBe(true)
  })

  it('does not overshoot on a monotonic curve', () => {
    const spec: MotionSpec = { offsetY: 0.1, ease: 'cubic-out' }
    for (let f = 0; f <= 20; f++) {
      const y = sampleAt({ inMotion: spec, durationFrames: 20 }, f).transform!.y
      expect(y).toBeGreaterThanOrEqual(DEFAULT_TEXT_TRANSFORM.y - 1e-9)
    }
  })

  it('falls back to the end’s default curve for an easing name not in the library', () => {
    // A corrupt stored document must not throw inside the resolver — it should
    // behave as though `ease` had simply been omitted.
    const unknown = { offsetY: 0.1, ease: 'not-a-curve' as TextAnimationEasing }
    const omitted = { offsetY: 0.1 }
    for (let f = 0; f <= 10; f++) {
      const a = sampleAt({ inMotion: unknown, durationFrames: 10 }, f)
      const b = sampleAt({ inMotion: omitted, durationFrames: 10 }, f)
      expect(a.transform!.y).toBe(b.transform!.y)
    }
  })
})

describe('layered channels', () => {
  it('drives opacity, offset, scale and rotation from one spec', () => {
    const spec: MotionSpec = {
      opacity: 0,
      offsetX: 0.1,
      offsetY: 0.2,
      scale: 0.5,
      rotation: 0.4,
      ease: 'linear',
      opacityEase: 'linear',
    }
    const start = sampleAt({ inMotion: spec, durationFrames: 10 }, 0)
    expect(start.opacity).toBe(0)
    expect(start.transform!.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x + 0.1, 10)
    expect(start.transform!.y).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.y + 0.2, 10)
    expect(start.transform!.scale).toBeCloseTo(0.5, 10)
    expect(start.transform!.rotation).toBeCloseTo(0.4, 10)

    const rest = sampleAt({ inMotion: spec, durationFrames: 10 }, 10)
    expect(rest.opacity).toBe(1)
    expect(rest.transform!.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x, 10)
    expect(rest.transform!.scale).toBeCloseTo(1, 10)
    expect(rest.transform!.rotation).toBeCloseTo(0, 10)
  })

  it('treats scale as a multiplier on the author’s own scale, not an absolute', () => {
    const authored: Transform = { ...DEFAULT_TEXT_TRANSFORM, scale: 2 }
    const start = sampleAt(
      { inMotion: { scale: 0.5, ease: 'linear' }, durationFrames: 10 },
      0,
      60,
      authored,
    )
    // 2 (authored) * 0.5 (multiplier) — an absolute would have given 0.5 and
    // silently discarded the scale slider.
    expect(start.transform!.scale).toBeCloseTo(1, 10)

    const rest = sampleAt(
      { inMotion: { scale: 0.5, ease: 'linear' }, durationFrames: 10 },
      10,
      60,
      authored,
    )
    expect(rest.transform!.scale).toBeCloseTo(2, 10)
  })

  // A clip whose ramp equals its whole length has both ends active at every
  // interior frame. Frame 5 of 10 is genuinely inside both ramps — frame 0 is
  // not, because the exit has not opened yet.
  const OVERLAP = { total: 10, ramp: 10, frame: 5 }

  it('multiplies overlapping scale ramps rather than adding them', () => {
    const inOnly = sampleAt(
      { inMotion: { scale: 0.5, ease: 'linear' }, durationFrames: OVERLAP.ramp },
      OVERLAP.frame,
      OVERLAP.total,
    )
    const outOnly = sampleAt(
      { outMotion: { scale: 0.5, ease: 'linear' }, durationFrames: OVERLAP.ramp },
      OVERLAP.frame,
      OVERLAP.total,
    )
    const both = sampleAt(
      {
        inMotion: { scale: 0.5, ease: 'linear' },
        outMotion: { scale: 0.5, ease: 'linear' },
        durationFrames: OVERLAP.ramp,
      },
      OVERLAP.frame,
      OVERLAP.total,
    )

    // Both ends must actually be doing something, or this proves nothing.
    expect(inOnly.transform!.scale).not.toBeCloseTo(1, 6)
    expect(outOnly.transform!.scale).not.toBeCloseTo(1, 6)
    // Compounding, not summing: two 0.75 factors give 0.5625, not 0.5.
    expect(both.transform!.scale).toBeCloseTo(
      inOnly.transform!.scale * outOnly.transform!.scale,
      10,
    )
  })

  it('sums overlapping offsets', () => {
    const inDelta =
      sampleAt(
        { inMotion: { offsetX: 0.1, ease: 'linear' }, durationFrames: OVERLAP.ramp },
        OVERLAP.frame,
        OVERLAP.total,
      ).transform!.x - DEFAULT_TEXT_TRANSFORM.x
    const outDelta =
      sampleAt(
        { outMotion: { offsetX: 0.1, ease: 'linear' }, durationFrames: OVERLAP.ramp },
        OVERLAP.frame,
        OVERLAP.total,
      ).transform!.x - DEFAULT_TEXT_TRANSFORM.x
    const both = sampleAt(
      {
        inMotion: { offsetX: 0.1, ease: 'linear' },
        outMotion: { offsetX: 0.1, ease: 'linear' },
        durationFrames: OVERLAP.ramp,
      },
      OVERLAP.frame,
      OVERLAP.total,
    )

    expect(inDelta).not.toBeCloseTo(0, 6)
    expect(outDelta).not.toBeCloseTo(0, 6)
    expect(both.transform!.x - DEFAULT_TEXT_TRANSFORM.x).toBeCloseTo(inDelta + outDelta, 10)
  })

  it('never lets an animated scale reach zero', () => {
    // Zero scale collapses the block AND makes it un-hittable in the editor
    // overlay, which reads as the clip having disappeared from the project.
    const s = sampleAt({ inMotion: { scale: 0, ease: 'linear' }, durationFrames: 10 }, 0)
    expect(s.transform!.scale).toBeGreaterThan(0)
  })

  it('clamps opacity even when the curve overshoots', () => {
    for (let f = 0; f <= 20; f++) {
      const s = sampleAt(
        { inMotion: { opacity: 0, opacityEase: 'back-out' }, durationFrames: 20 },
        f,
      )
      expect(s.opacity).toBeGreaterThanOrEqual(0)
      expect(s.opacity).toBeLessThanOrEqual(1)
    }
  })

  it('emits no transform for a pure-opacity spec', () => {
    // The transform-or-nothing rule: a clip that never had a transform must keep
    // getting the renderer's own default.
    const s = sampleAt({ inMotion: { opacity: 0 }, durationFrames: 10 }, 3)
    expect(s.transform).toBeUndefined()
  })

  it('emits a transform for a scale-only spec', () => {
    const s = sampleAt({ inMotion: { scale: 0.5 }, durationFrames: 10 }, 3)
    expect(s.transform).toBeDefined()
  })

  it('is a no-op when neither end is set', () => {
    const s = sampleAt({ durationFrames: 10 }, 5)
    expect(s.opacity).toBe(1)
    expect(s.transform).toBeUndefined()
  })
})

describe('layered specs take precedence over the enum', () => {
  it('uses inMotion and ignores in when both are present', () => {
    // 'fade' would leave the block at rest position; the spec moves it.
    const s = sampleAt(
      { in: 'fade', inMotion: { offsetX: 0.2, ease: 'linear' }, durationFrames: 10 },
      0,
    )
    expect(s.transform!.x).toBeCloseTo(DEFAULT_TEXT_TRANSFORM.x + 0.2, 10)
    // The enum's fade is not applied on top.
    expect(s.opacity).toBe(1)
  })

  it('resolves each end independently', () => {
    const s = sampleAt(
      { in: 'fade', outMotion: { offsetX: 0.2, ease: 'linear' }, durationFrames: 10 },
      0,
      60,
    )
    // Entry is still the enum fade.
    expect(s.opacity).toBe(0)
  })
})

describe('motionForKind', () => {
  it('negates the travel vector on an entry and not on an exit', () => {
    // A kind names a direction of travel: an entry starts one vector away from
    // rest and moves along it; an exit departs along it.
    const inSpec = motionForKind('slide-up', 'in')
    const outSpec = motionForKind('slide-up', 'out')
    expect(inSpec.offsetY).toBeGreaterThan(0) // starts below, moves up
    expect(outSpec.offsetY).toBeLessThan(0) // departs upward
  })

  it('maps fade to an opacity channel and no geometry', () => {
    const spec = motionForKind('fade', 'in')
    expect(spec.opacity).toBe(0)
    expect(spec.offsetX).toBeUndefined()
    expect(spec.offsetY).toBeUndefined()
    expect(spec.rotation).toBeUndefined()
    expect(spec.scale).toBeUndefined()
  })

  it('defaults to the curves the enum path has always used', () => {
    expect(motionForKind('slide-up', 'in').ease).toBe('quad-out')
    expect(motionForKind('slide-up', 'out').ease).toBe('quad-in')
    expect(motionForKind('fade', 'in').opacityEase).toBe('linear')
  })

  it('never sets a scale channel, since no enum kind resizes a clip', () => {
    for (const kind of ['fade', 'spin', 'slide-up', 'slide-down', 'slide-left', 'slide-right'] as const) {
      expect(motionForKind(kind, 'in').scale).toBeUndefined()
      expect(motionForKind(kind, 'out').scale).toBeUndefined()
    }
  })
})
