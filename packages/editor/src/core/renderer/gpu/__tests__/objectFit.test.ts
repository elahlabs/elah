import { describe, expect, it } from 'vitest'
import type { Transform } from '../../../types'
import { computeContainRect } from '../layers/objectFit'
import { resolveDrawRect } from '../layers/drawRect'

describe('computeContainRect', () => {
  it('pillarboxes a portrait clip inside a landscape stage (bars left/right)', () => {
    // 9:16 content (1080×1920) inside 16:9 stage (1280×720).
    const r = computeContainRect(1080, 1920, 1280, 720)
    expect(r.height).toBeCloseTo(720) // height-bound
    expect(r.width).toBeCloseTo(720 * (1080 / 1920)) // 405
    expect(r.y).toBeCloseTo(0)
    expect(r.x).toBeCloseTo((1280 - 405) / 2)
  })

  it('letterboxes a landscape clip inside a portrait stage (bars top/bottom)', () => {
    // 16:9 content (1920×1080) inside 9:16 stage (1080×1920).
    const r = computeContainRect(1920, 1080, 1080, 1920)
    expect(r.width).toBeCloseTo(1080) // width-bound
    expect(r.height).toBeCloseTo(1080 / (1920 / 1080)) // 607.5
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo((1920 - 607.5) / 2)
  })

  it('fills the stage exactly when aspects match', () => {
    const r = computeContainRect(640, 360, 1280, 720)
    expect(r).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
  })

  it('falls back to filling the stage on degenerate input', () => {
    expect(computeContainRect(0, 0, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    })
  })
})

describe('resolveDrawRect — no-transform default', () => {
  it('contains the content within the stage when content size is known', () => {
    const r = resolveDrawRect(undefined, 1280, 720, 1080, 1920)
    expect(r.rotation).toBe(0)
    expect(r.height).toBeCloseTo(720)
    expect(r.width).toBeCloseTo(405)
  })

  it('fills the stage when content size is not yet known (first frame)', () => {
    expect(resolveDrawRect(undefined, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      rotation: 0,
    })
  })

  it('applies an explicit transform verbatim (unchanged behaviour)', () => {
    const transform: Transform = {
      x: 0.5,
      y: 0.5,
      scale: 0.5,
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    }
    const r = resolveDrawRect(transform, 1280, 720, 640, 360)
    // 640×360 at scale 0.5 = 320×180, centred via anchor at (0.5,0.5).
    expect(r.width).toBeCloseTo(320)
    expect(r.height).toBeCloseTo(180)
    expect(r.x).toBeCloseTo(0.5 * 1280 - 0.5 * 320)
    expect(r.y).toBeCloseTo(0.5 * 720 - 0.5 * 180)
  })
})
