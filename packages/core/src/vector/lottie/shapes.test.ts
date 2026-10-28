import { describe, expect, it } from 'vitest'
import { pathToD } from '../pathOps'
import { layerDrawables, lottieColor } from './shapes'
import type { LottieShapeItem } from './types'

function rc(p: number[], s: number[], r = 0): LottieShapeItem {
  return { ty: 'rc', p: { a: 0, k: p }, s: { a: 0, k: s }, r: { a: 0, k: r } }
}
function el(p: number[], s: number[]): LottieShapeItem {
  return { ty: 'el', p: { a: 0, k: p }, s: { a: 0, k: s } }
}
function fl(color: number[], opacity = 100, rule?: number): LottieShapeItem {
  return { ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: opacity }, ...(rule !== undefined ? { r: rule } : {}) }
}
function st(color: number[], w = 1, extra: Record<string, unknown> = {}): LottieShapeItem {
  return { ty: 'st', c: { a: 0, k: color }, w: { a: 0, k: w }, ...extra }
}
function gr(it: LottieShapeItem[]): LottieShapeItem {
  return { ty: 'gr', it }
}
function tr(p: number[] = [0, 0], s: number[] = [100, 100]): LottieShapeItem {
  return { ty: 'tr', p: { a: 0, k: p }, s: { a: 0, k: s }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, a: { a: 0, k: [0, 0] } }
}
function sh(v: number[][], iArr: number[][], oArr: number[][], c: boolean): LottieShapeItem {
  return { ty: 'sh', ks: { a: 0, k: { v, i: iArr, o: oArr, c } } }
}

function skipList(): { skip: (f: string) => void; skips: string[] } {
  const skips: string[] = []
  return { skip: (f: string) => skips.push(f), skips }
}

describe('layerDrawables — geometry', () => {
  it('a single rect + fill makes one drawable', () => {
    const { skip } = skipList()
    const drawables = layerDrawables([rc([0, 0], [40, 40], 0), fl([1, 0, 0])], 0, skip)
    expect(drawables).toHaveLength(1)
    const d = drawables[0]!
    expect(pathToD(d.geom)).toBe('M-20 -20L20 -20L20 20L-20 20Z')
    expect(d.fill).toEqual({ color: '#ff0000', rule: 'nonzero' })
    expect(d.chain).toEqual([])
    expect(d.opacity).toBe(1)
  })

  it('a stroke and a fill on the same ellipse merge into one drawable', () => {
    const { skip } = skipList()
    const drawables = layerDrawables([el([0, 0], [10, 10]), st([1, 1, 1], 2, { lc: 2, lj: 2 }), fl([0, 0.5, 1, 1], 50)], 0, skip)
    expect(drawables).toHaveLength(1)
    const d = drawables[0]!
    expect((d.fill as { color: string }).color).toBe('rgba(0, 128, 255, 0.5)')
    expect(d.stroke).toMatchObject({ color: '#ffffff', width: 2, cap: 'round', join: 'round' })
  })

  it('a fill-then-stroke pair from DIFFERENT groups (different chain/geometry/opacity) does not merge, even though it is adjacent back-to-front', () => {
    const { skip } = skipList()
    // Item order: group B (stroke, opacity 50) THEN group A (fill) — so the walk pushes
    // [strokeB, fillA], and reversing to back-to-front gives the adjacent pair [fillA, strokeB]
    // that WOULD satisfy the fill-then-stroke shape of the merge rule.
    const groupB = gr([rc([20, 0], [10, 10]), st([0, 0, 1]), { ty: 'tr', o: { a: 0, k: 50 }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0] } }])
    const groupA = gr([el([0, 0], [10, 10]), fl([1, 0, 0])])
    const drawables = layerDrawables([groupB, groupA], 0, skip)
    expect(drawables).toHaveLength(2)
    const strokeOnly = drawables.find((d) => d.stroke && !d.fill)
    const fillOnly = drawables.find((d) => d.fill && !d.stroke)
    expect(strokeOnly).toBeDefined()
    expect(fillOnly).toBeDefined()
  })

  it('fill before stroke in the item list does NOT merge (back-to-front is stroke then fill)', () => {
    const { skip } = skipList()
    const drawables = layerDrawables([el([0, 0], [10, 10]), fl([0, 0, 1, 1]), st([1, 1, 1, 1])], 0, skip)
    expect(drawables).toHaveLength(2)
    expect(drawables[0]!.stroke).toBeDefined()
    expect(drawables[0]!.fill).toBeUndefined()
    expect(drawables[1]!.fill).toBeDefined()
    expect(drawables[1]!.stroke).toBeUndefined()
  })

  it('a style paints geometry from an earlier sub-group too, moved by the group matrix', () => {
    const { skip } = skipList()
    const shapeA = sh([[0, 0], [1, 0]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false)
    const shapeB = sh([[0, 0], [2, 0]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false)
    const group = gr([shapeA, fl([1, 0, 0]), tr([10, 0], [200, 200])])
    const drawables = layerDrawables([group, shapeB, fl([0, 0, 1])], 0, skip)
    expect(drawables).toHaveLength(2)

    const blue = drawables[0]!
    expect((blue.fill as { color: string }).color).toBe('#0000ff')
    expect(blue.chain).toEqual([])
    // Geometry A moved by the group's matrix (scale 2, translate 10,0): (0,0)->(10,0), (1,0)->(12,0). Then B: (0,0),(2,0).
    expect(pathToD(blue.geom)).toBe('M10 0L12 0M0 0L2 0')

    const red = drawables[1]!
    expect((red.fill as { color: string }).color).toBe('#ff0000')
    expect(red.chain).toHaveLength(1)
    // Geometry A in the group's own (untransformed) space.
    expect(pathToD(red.geom)).toBe('M0 0L1 0')
  })

  it('sh geometry: straight edges when tangents are zero, a curve when they are not', () => {
    const straight = sh([[0, 0], [10, 0], [10, 10]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], true)
    const { skip } = skipList()
    const d1 = layerDrawables([straight, fl([0, 0, 0])], 0, skip)
    expect(pathToD(d1[0]!.geom)).toBe('M0 0L10 0L10 10L0 0Z')

    const curved = sh([[0, 0], [10, 0]], [[0, 0], [0, 5]], [[0, 5], [0, 0]], false)
    const d2 = layerDrawables([curved, fl([0, 0, 0])], 0, skip)
    expect(pathToD(d2[0]!.geom)).toBe('M0 0C0 5 10 5 10 0')
  })
})

describe('layerDrawables — gradients', () => {
  it('gf builds colour stops from the packed array (p colour stops, then opacity pairs)', () => {
    const { skip } = skipList()
    const gf: LottieShapeItem = {
      ty: 'gf',
      t: 1,
      s: { a: 0, k: [0, 0] },
      e: { a: 0, k: [100, 0] },
      g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
    }
    const d = layerDrawables([rc([0, 0], [10, 10]), gf], 0, skip)
    const gradient = (d[0]!.fill as { gradient: { stops: Array<{ offset: number; color: string }> } }).gradient
    expect(gradient.stops).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ])
  })

  it('opacity stops appended after the colour stops modulate alpha', () => {
    const { skip } = skipList()
    const gf: LottieShapeItem = {
      ty: 'gf',
      t: 1,
      s: { a: 0, k: [0, 0] },
      e: { a: 0, k: [100, 0] },
      g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0] } },
    }
    const d = layerDrawables([rc([0, 0], [10, 10]), gf], 0, skip)
    const gradient = (d[0]!.fill as { gradient: { stops: Array<{ offset: number; color: string }> } }).gradient
    expect(gradient.stops[1]).toEqual({ offset: 1, color: 'rgba(0, 0, 255, 0)' })
  })
})

describe('layerDrawables — skips', () => {
  it('reports every unsupported shape feature by name, and ignores hidden items silently', () => {
    const { skip, skips } = skipList()
    layerDrawables(
      [{ ty: 'gs' }, { ty: 'tm', m: 2 }, { ty: 'rp' }, { ty: 'sr' }, { ty: 'xx' }, { ty: 'rc', hd: true, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [1, 1] } }],
      0,
      skip,
    )
    // A group's trim is read before the walk, so its skip comes first.
    expect(skips).toEqual(['trim-paths', 'gradient-stroke', 'repeater', 'polystar', 'shape:xx'])
  })
})

describe('layerDrawables — group opacity', () => {
  it('a group tr.o multiplies into the drawable opacity', () => {
    const { skip } = skipList()
    const group = gr([rc([0, 0], [10, 10]), fl([1, 0, 0]), { ty: 'tr', o: { a: 0, k: 50 }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0] } }])
    const d = layerDrawables([group], 0, skip)
    expect(d[0]!.opacity).toBeCloseTo(0.5, 6)
  })
})

describe('lottieColor', () => {
  it('scales 0..1 channels to 0..255 and formats with formatCssColor', () => {
    expect(lottieColor([255, 0, 0], 1)).toBe('#ff0000')
    expect(lottieColor([1, 0, 0, 1], 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })
})
