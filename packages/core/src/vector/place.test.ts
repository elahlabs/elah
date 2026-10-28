import { describe, expect, it } from 'vitest'
import { resolveTransformRect } from '../renderer/gpu/layers/drawRect'
import { resolveShapeRect } from '../renderer/gpu/layers/shapePaint'
import { IDENTITY, scaling } from './pathOps'
import { fitTransform, transformForBox, VECTOR_IMPORT_FIT } from './place'

describe('transformForBox', () => {
  it('reproduces resolveShapeRect exactly for the identity matrix', () => {
    const { transform, exact } = transformForBox(IDENTITY, { x: 0, y: 0, width: 100, height: 50 }, { width: 200, height: 200 }, 'shape')
    expect(transform.x).toBeCloseTo(0.25, 6)
    expect(transform.y).toBeCloseTo(0.125, 6)
    expect(transform.scale).toBeCloseTo(0.5, 6)
    expect(transform.scaleX).toBeCloseTo(1, 6)
    expect(transform.scaleY).toBeCloseTo(0.5, 6)
    expect(transform.rotation).toBeCloseTo(0, 6)
    expect(exact).toBe(true)

    const rect = resolveShapeRect(transform, { width: 200, height: 200 })
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 50, rotation: 0 })
  })

  it('carries rotation and centre through a rotate+translate matrix', () => {
    const m = [0, 1, -1, 0, 100, 100] as const
    const { transform, exact } = transformForBox(m, { x: 0, y: 0, width: 20, height: 10 }, { width: 200, height: 200 }, 'shape')
    expect(transform.x * 200).toBeCloseTo(95, 6)
    expect(transform.y * 200).toBeCloseTo(110, 6)
    expect(transform.rotation).toBeCloseTo(Math.PI / 2, 6)
    expect(exact).toBe(true)
  })

  it('uses the box\'s longer side as the scale reference, not always width', () => {
    // height (100) is the longer side here, unlike the two cases above where
    // width happened to be longest — this is what tells `ref` apart from
    // `box.width` in the shape scale formula.
    const { transform } = transformForBox(IDENTITY, { x: 0, y: 0, width: 50, height: 100 }, { width: 200, height: 200 }, 'shape')
    expect(transform.scale).toBeCloseTo(0.5, 6)
    expect(transform.scaleX).toBeCloseTo(0.5, 6)
    expect(transform.scaleY).toBeCloseTo(1, 6)
  })

  it('resolves a compound placement exactly for a uniform scale', () => {
    const { transform } = transformForBox(scaling(2), { x: 0, y: 0, width: 50, height: 50 }, { width: 100, height: 100 }, 'compound')
    expect(transform.x).toBeCloseTo(0.5, 6)
    expect(transform.y).toBeCloseTo(0.5, 6)
    expect(transform.scale).toBeCloseTo(2, 6)
    expect(transform.scaleX).toBeUndefined()

    const rect = resolveTransformRect(transform, 100, 100, 50, 50)
    expect(rect.x).toBeCloseTo(0, 6)
    expect(rect.y).toBeCloseTo(0, 6)
    expect(rect.width).toBeCloseTo(100, 6)
    expect(rect.height).toBeCloseTo(100, 6)
  })

  it('reports exact:false and uses uniformScale for an anisotropic matrix', () => {
    const { transform, exact } = transformForBox(scaling(2, 1), { x: 0, y: 0, width: 50, height: 50 }, { width: 100, height: 100 }, 'compound')
    expect(exact).toBe(false)
    expect(transform.scale).toBeCloseTo(Math.sqrt(2), 6)
  })
})

describe('fitTransform', () => {
  it('matches the worked example', () => {
    const t = fitTransform({ width: 1024, height: 1024 }, { width: 1080, height: 1920 })
    expect(t.scale).toBeCloseTo(0.52734375, 8)
    expect(t.x).toBe(0.5)
    expect(t.y).toBe(0.5)
    expect(t.rotation).toBe(0)
    expect(t.anchor).toEqual({ x: 0.5, y: 0.5 })
  })

  it('defaults fit to VECTOR_IMPORT_FIT', () => {
    const a = fitTransform({ width: 100, height: 100 }, { width: 200, height: 200 })
    const b = fitTransform({ width: 100, height: 100 }, { width: 200, height: 200 }, VECTOR_IMPORT_FIT)
    expect(a.scale).toBeCloseTo(b.scale, 9)
  })
})
