import { describe, expect, it } from 'vitest'
import { fitModeOf, fitPlan, isFitBackdrop } from '../layers/fitCrop'
import { resolveDrawRect } from '../layers/drawRect'

const wide = { width: 1920, height: 1080 }
const portraitStage = { width: 1080, height: 1920 }

describe('fitPlan', () => {
  it('contain clears crop and transform', () => {
    expect(fitPlan(wide, portraitStage, 'contain')).toEqual({})
  })

  it('cover on a 9:16 stage windows the 16:9 frame around the focus and clamps at both ends', () => {
    const centre = fitPlan(wide, portraitStage, 'cover', { x: 0.5, y: 0.5 })
    expect(centre.crop!.width).toBeCloseTo(0.3164, 4)
    expect(centre.crop!.height).toBe(1)
    expect(centre.crop!.x).toBeCloseTo(0.5 - 0.3164 / 2, 4)
    expect(fitPlan(wide, portraitStage, 'cover', { x: 0, y: 0.5 }).crop!.x).toBe(0)
    expect(fitPlan(wide, portraitStage, 'cover', { x: 1, y: 0.5 }).crop!.x).toBeCloseTo(1 - 0.3164, 4)
  })

  it('cover of a portrait frame on a landscape stage windows the height', () => {
    const p = fitPlan({ width: 1080, height: 1920 }, { width: 1920, height: 1080 }, 'cover', { x: 0.5, y: 1 })
    expect(p.crop!.width).toBe(1)
    expect(p.crop!.height).toBeCloseTo(0.3164, 4)
    expect(p.crop!.y).toBeCloseTo(1 - 0.3164, 4)
  })

  it('equal aspect returns nothing to do', () => {
    expect(fitPlan(wide, { width: 1280, height: 720 }, 'cover')).toEqual({})
  })

  it('blur-fill foreground equals contain', () => {
    expect(fitPlan(wide, portraitStage, 'blur-fill')).toEqual({})
  })

  it('degenerate sizes and non-finite focus fall back safely', () => {
    expect(fitPlan({ width: 0, height: 1080 }, portraitStage, 'cover')).toEqual({})
    const p = fitPlan(wide, portraitStage, 'cover', { x: Number.NaN, y: 5 })
    expect(p.crop!.x).toBeCloseTo(0.5 - 0.3164 / 2, 4)
  })

  it.each([0.5, 0, 1])('fills the stage exactly through resolveDrawRect (focus %s)', (fx) => {
    const cases = [
      [wide, portraitStage],
      [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }],
      [{ width: 1000, height: 1000 }, portraitStage],
    ]
    for (const [content, stage] of cases) {
      const p = fitPlan(content!, stage!, 'cover', { x: fx, y: fx })
      expect(p.crop!.x).toBeGreaterThanOrEqual(0)
      expect(p.crop!.y).toBeGreaterThanOrEqual(0)
      expect(p.crop!.x + p.crop!.width).toBeLessThanOrEqual(1 + 1e-9)
      expect(p.crop!.y + p.crop!.height).toBeLessThanOrEqual(1 + 1e-9)
      const r = resolveDrawRect(p.transform, stage!.width, stage!.height, content!.width, content!.height, p.crop)
      expect(r.x).toBeCloseTo(0, 3)
      expect(r.y).toBeCloseTo(0, 3)
      expect(r.x + r.width).toBeCloseTo(stage!.width, 3)
      expect(r.y + r.height).toBeCloseTo(stage!.height, 3)
    }
  })
})

describe('fitModeOf / isFitBackdrop', () => {
  it('reads the mode off the clip', () => {
    expect(fitModeOf({}, false)).toBe('contain')
    expect(fitModeOf({ crop: { x: 0, y: 0, width: 0.5, height: 1 } }, false)).toBe('cover')
    expect(fitModeOf({ crop: undefined }, true)).toBe('blur-fill')
  })

  it('recognises only the muted, blurred, linked copy of the same media', () => {
    const clip = { id: 'a', linkId: 'L', assetId: 'x' }
    const back = { id: 'b', linkId: 'L', assetId: 'x', volume: 0, effects: [{ kind: 'gaussianBlur' }] }
    expect(isFitBackdrop(back, clip)).toBe(true)
    expect(isFitBackdrop({ ...back, volume: 1 }, clip)).toBe(false)
    expect(isFitBackdrop({ ...back, effects: [] }, clip)).toBe(false)
    expect(isFitBackdrop({ ...back, assetId: 'y' }, clip)).toBe(false)
    expect(isFitBackdrop({ ...back, linkId: 'M' }, clip)).toBe(false)
    expect(isFitBackdrop(clip, clip)).toBe(false)
  })
})
