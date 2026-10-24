/**
 * ShapePaint — the shape rasterizer's contract, asserted at the 2D-op level.
 *
 * Shapes have no pixel-level parity harness (there is no GPU in Node and the
 * export worker needs an OffscreenCanvas), so the guard is the *call log*: both
 * renderers now funnel through `paintShape`, and this file pins what that
 * function emits. Two things are being protected.
 *
 *  1. BYTE IDENTITY for existing documents. A rect/circle/triangle with none of
 *     the v2 fields must emit the same ops, in the same order, with the same
 *     numbers, that the pre-v2 painter did. Those sequences are written out
 *     literally below rather than derived, so a refactor that "looks
 *     equivalent" still has to prove it.
 *  2. The signature covers every field the painter reads. A field that is read
 *     but missing from the signature shows up as a stale preview texture next
 *     to a correct export — the worst failure mode this module has.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  paintShape,
  resolveShapeRect,
  shapePaintSignature,
  SHAPE_LIMITS,
  type Shape2DContext,
} from '../layers/shapePaint'
import type { ActiveShapeClip } from '../../../resolver/scene'
import type { Transform } from '../../../types'

const STAGE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }

// ---------------------------------------------------------------------------
// A 2D context that records instead of painting
// ---------------------------------------------------------------------------

interface Op {
  op: string
  args: unknown[]
}

class Recording2D {
  readonly ops: Op[] = []
  private _fillStyle = ''
  private _strokeStyle = ''
  private _lineWidth = 0
  private _lineCap = 'butt'

  private push(op: string, ...args: unknown[]): void {
    this.ops.push({ op, args })
  }

  set fillStyle(v: string) {
    this._fillStyle = v
    this.push('fillStyle', v)
  }
  get fillStyle(): string {
    return this._fillStyle
  }
  set strokeStyle(v: string) {
    this._strokeStyle = v
    this.push('strokeStyle', v)
  }
  get strokeStyle(): string {
    return this._strokeStyle
  }
  set lineWidth(v: number) {
    this._lineWidth = v
    this.push('lineWidth', v)
  }
  get lineWidth(): number {
    return this._lineWidth
  }
  set lineCap(v: string) {
    this._lineCap = v
    this.push('lineCap', v)
  }
  get lineCap(): string {
    return this._lineCap
  }

  save(): void { this.push('save') }
  restore(): void { this.push('restore') }
  translate(x: number, y: number): void { this.push('translate', x, y) }
  rotate(a: number): void { this.push('rotate', a) }
  scale(x: number, y: number): void { this.push('scale', x, y) }
  beginPath(): void { this.push('beginPath') }
  closePath(): void { this.push('closePath') }
  moveTo(x: number, y: number): void { this.push('moveTo', x, y) }
  lineTo(x: number, y: number): void { this.push('lineTo', x, y) }
  rect(x: number, y: number, w: number, h: number): void { this.push('rect', x, y, w, h) }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.push('arcTo', x1, y1, x2, y2, r)
  }
  ellipse(
    x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number,
  ): void {
    this.push('ellipse', x, y, rx, ry, rot, s, e)
  }
  fill(...args: unknown[]): void { this.push('fill', ...args) }
  stroke(...args: unknown[]): void { this.push('stroke', ...args) }
}

function record(item: ActiveShapeClip, stage = STAGE): Recording2D {
  const ctx = new Recording2D()
  paintShape(ctx as unknown as Shape2DContext, item, stage)
  return ctx
}

/** Just the op names, for asserting a sequence without drowning in numbers. */
function names(ctx: Recording2D): string[] {
  return ctx.ops.map((o) => o.op)
}

function opArgs(ctx: Recording2D, name: string): unknown[] {
  const found = ctx.ops.find((o) => o.op === name)
  if (!found) throw new Error(`no "${name}" op recorded; got ${names(ctx).join(', ')}`)
  return found.args
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE: ActiveShapeClip = {
  type: 'shape',
  id: 'c1',
  trackId: 't1',
  name: 'Shape 1',
  shapeKind: 'rect',
  shapeFill: '#ff0000',
  shapeStroke: '#00ff00',
  shapeStrokeWidth: 4,
  sourceFrame: 0,
  opacity: 1,
  zIndex: 0,
}

function shape(overrides: Partial<ActiveShapeClip>): ActiveShapeClip {
  return { ...BASE, ...overrides }
}

function transform(overrides: Partial<Transform> = {}): Transform {
  return { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...overrides }
}

// A `path` shape needs a Path2D, which Node does not have. Stub it so the
// painter's transform math is observable; the stub records nothing itself.
class FakePath2D {
  constructor(public readonly d: string) {
    if (d.includes('!')) throw new Error('invalid path data')
  }
}

beforeAll(() => {
  ;(globalThis as unknown as { Path2D: unknown }).Path2D = FakePath2D
})
afterAll(() => {
  delete (globalThis as unknown as { Path2D?: unknown }).Path2D
})

// ---------------------------------------------------------------------------
// 1. Byte identity with the pre-v2 painter
// ---------------------------------------------------------------------------

describe('paintShape — legacy variants are unchanged', () => {
  it('rect at the default transform emits the exact pre-v2 sequence', () => {
    const ctx = record(shape({ shapeKind: 'rect' }))

    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth', 'beginPath', 'rect', 'fill', 'stroke',
    ])
    // side = 0.5 * min(1920, 1080) = 540; centred on a 1920×1080 stage.
    expect(opArgs(ctx, 'rect')).toEqual([690, 270, 540, 540])
    expect(opArgs(ctx, 'fillStyle')).toEqual(['#ff0000'])
    expect(opArgs(ctx, 'strokeStyle')).toEqual(['#00ff00'])
    expect(opArgs(ctx, 'lineWidth')).toEqual([4])
  })

  it('circle emits one ellipse with the box half-extents', () => {
    const ctx = record(shape({ shapeKind: 'circle' }))
    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth', 'beginPath', 'ellipse', 'fill', 'stroke',
    ])
    expect(opArgs(ctx, 'ellipse')).toEqual([960, 540, 270, 270, 0, 0, Math.PI * 2])
  })

  it('triangle keeps its apex-up, base-on-the-box-corners geometry', () => {
    const ctx = record(shape({ shapeKind: 'triangle' }))
    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth',
      'beginPath', 'moveTo', 'lineTo', 'lineTo', 'closePath', 'fill', 'stroke',
    ])
    expect(ctx.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').map((o) => o.args))
      .toEqual([[960, 270], [1230, 810], [690, 810]])
  })

  it('scaleX / scaleY stretch the box on each axis', () => {
    const ctx = record(shape({ transform: transform({ scaleX: 2, scaleY: 0.5 }) }))
    // 540 * 2 = 1080 wide, 540 * 0.5 = 270 tall, still centred.
    expect(opArgs(ctx, 'rect')).toEqual([420, 405, 1080, 270])
  })

  it('a zero stroke width paints no stroke', () => {
    const ctx = record(shape({ shapeStrokeWidth: 0 }))
    expect(names(ctx)).not.toContain('stroke')
    expect(names(ctx)).toContain('fill')
  })

  it('emits no rotation wrapper at rotation 0', () => {
    const ctx = record(shape({ transform: transform({ rotation: 0 }) }))
    expect(names(ctx)).not.toContain('save')
    expect(names(ctx)).not.toContain('rotate')
  })

  it('an unknown shapeKind paints nothing but the style preamble', () => {
    const ctx = record(shape({ shapeKind: 'not-a-shape' as ActiveShapeClip['shapeKind'] }))
    expect(names(ctx)).toEqual(['fillStyle', 'strokeStyle', 'lineWidth'])
  })
})

// ---------------------------------------------------------------------------
// 2. Rotation
// ---------------------------------------------------------------------------

describe('paintShape — rotation', () => {
  it('wraps the path in a save/rotate about the box centre and restores', () => {
    const ctx = record(shape({ transform: transform({ rotation: Math.PI / 4 }) }))
    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth',
      'save', 'translate', 'rotate', 'translate',
      'beginPath', 'rect', 'fill', 'stroke',
      'restore',
    ])
    const translates = ctx.ops.filter((o) => o.op === 'translate').map((o) => o.args)
    expect(translates).toEqual([[960, 540], [-960, -540]])
    expect(opArgs(ctx, 'rotate')).toEqual([Math.PI / 4])
  })

  it('rotates about the box centre, not the anchor, when the anchor is off-centre', () => {
    const ctx = record(
      shape({ transform: transform({ anchor: { x: 0, y: 0 }, rotation: Math.PI / 2 }) }),
    )
    // Box starts AT (x, y) = (960, 540), so its centre is (960+270, 540+270).
    expect(ctx.ops.filter((o) => o.op === 'translate').map((o) => o.args))
      .toEqual([[1230, 810], [-1230, -810]])
  })
})

// ---------------------------------------------------------------------------
// 3. Corner radius on rect
// ---------------------------------------------------------------------------

describe('paintShape — rect corner radius', () => {
  it('traces with arcTo instead of rect, never ctx.roundRect', () => {
    const ctx = record(shape({ cornerRadius: 0.25 }))
    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth',
      'beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'arcTo', 'closePath',
      'fill', 'stroke',
    ])
    expect(names(ctx)).not.toContain('rect')
    expect(names(ctx)).not.toContain('roundRect')
  })

  it('radius is the fraction times the SHORTER box side', () => {
    // 1080 × 270 box, cornerRadius 0.25 → 0.25 * 270 = 67.5
    const ctx = record(shape({ cornerRadius: 0.25, transform: transform({ scaleX: 2, scaleY: 0.5 }) }))
    expect(opArgs(ctx, 'arcTo')[4]).toBeCloseTo(67.5, 6)
  })

  it('clamps at half the shorter side, so 0.5 is a stadium not an overshoot', () => {
    const ctx = record(shape({ cornerRadius: 0.5 }))
    // 0.5 * 540 = 270, which is exactly half of 540 — the clamp's boundary.
    expect(opArgs(ctx, 'arcTo')[4]).toBeCloseTo(270, 6)
  })

  it('cornerRadius 0 keeps the legacy rect op', () => {
    expect(names(record(shape({ cornerRadius: 0 })))).toContain('rect')
  })
})

// ---------------------------------------------------------------------------
// 4. Polygon and star
// ---------------------------------------------------------------------------

describe('paintShape — polygon', () => {
  function vertices(ctx: Recording2D): Array<[number, number]> {
    return ctx.ops
      .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
      .map((o) => [o.args[0] as number, o.args[1] as number])
  }

  it('emits N vertices starting straight up', () => {
    for (const sides of [3, 4, 5, 6]) {
      const ctx = record(shape({ shapeKind: 'polygon', shapeSides: sides }))
      const v = vertices(ctx)
      expect(v).toHaveLength(sides)
      // Vertex 0 is directly above the centre.
      expect(v[0][0]).toBeCloseTo(960, 6)
      expect(v[0][1]).toBeCloseTo(270, 6)
      expect(names(ctx)).toContain('closePath')
    }
  })

  it('places every vertex on the box ellipse', () => {
    const ctx = record(shape({ shapeKind: 'polygon', shapeSides: 6 }))
    for (const [x, y] of vertices(ctx)) {
      const u = (x - 960) / 270
      const v = (y - 540) / 270
      expect(Math.hypot(u, v)).toBeCloseTo(1, 6)
    }
  })

  it('an inner ratio doubles the vertex count and alternates the radius', () => {
    const ctx = record(shape({ shapeKind: 'polygon', shapeSides: 5, shapeInnerRatio: 0.5 }))
    const v = vertices(ctx)
    expect(v).toHaveLength(10)
    const radii = v.map(([x, y]) => Math.hypot((x - 960) / 270, (y - 540) / 270))
    radii.forEach((r, i) => expect(r).toBeCloseTo(i % 2 === 0 ? 1 : 0.5, 6))
  })

  it('clamps the side count into the supported range', () => {
    expect(vertices(record(shape({ shapeKind: 'polygon', shapeSides: 2 })))).toHaveLength(SHAPE_LIMITS.minSides)
    expect(vertices(record(shape({ shapeKind: 'polygon', shapeSides: 99 })))).toHaveLength(SHAPE_LIMITS.maxSides)
  })

  it('defaults to a pentagon when no side count is stored', () => {
    expect(vertices(record(shape({ shapeKind: 'polygon' })))).toHaveLength(SHAPE_LIMITS.defaultSides)
  })
})

// ---------------------------------------------------------------------------
// 5. Line and arrow
// ---------------------------------------------------------------------------

describe('paintShape — line', () => {
  it('draws a horizontal rule across the box with round caps, inside save/restore', () => {
    const ctx = record(shape({ shapeKind: 'line' }))
    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth',
      'save', 'lineCap', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'restore',
    ])
    expect(opArgs(ctx, 'lineCap')).toEqual(['round'])
    expect(opArgs(ctx, 'moveTo')).toEqual([690, 540])
    expect(opArgs(ctx, 'lineTo')).toEqual([1230, 540])
  })

  it('paints nothing at all when the stroke width is zero', () => {
    const ctx = record(shape({ shapeKind: 'line', shapeStrokeWidth: 0 }))
    expect(names(ctx)).toEqual(['fillStyle', 'strokeStyle', 'lineWidth'])
  })

  it('an end arrowhead is a filled triangle in the STROKE colour', () => {
    const ctx = record(shape({ shapeKind: 'line', shapeArrowHead: 'end' }))
    // The head's fillStyle write comes after the line is stroked.
    const fillStyleWrites = ctx.ops.filter((o) => o.op === 'fillStyle').map((o) => o.args[0])
    expect(fillStyleWrites).toEqual(['#ff0000', '#00ff00'])
    expect(names(ctx).filter((n) => n === 'fill')).toHaveLength(1)
  })

  it('"both" paints two heads', () => {
    const ctx = record(shape({ shapeKind: 'line', shapeArrowHead: 'both' }))
    expect(names(ctx).filter((n) => n === 'fill')).toHaveLength(2)
  })

  it('caps the head length so it can never exceed half the line', () => {
    // strokeWidth 400 would want a 1600px head on a 540px line.
    const ctx = record(shape({ shapeKind: 'line', shapeArrowHead: 'end', shapeStrokeWidth: 400 }))
    const head = ctx.ops.filter((o) => o.op === 'lineTo').slice(1)
    // Base of the head sits at tip - length; length is clamped to width / 2 = 270.
    expect(head[0].args[0]).toBeCloseTo(1230 - 270, 6)
  })
})

// ---------------------------------------------------------------------------
// 6. Path
// ---------------------------------------------------------------------------

describe('paintShape — path', () => {
  const PATH = shape({
    shapeKind: 'path',
    shapePath: 'M0 0 L100 0 L100 100 Z',
    shapeViewBox: { x: 0, y: 0, width: 100, height: 100 },
  })

  it('contains the viewBox in the box and keeps the stroke in stage pixels', () => {
    const ctx = record(PATH)
    expect(names(ctx)).toEqual([
      'fillStyle', 'strokeStyle', 'lineWidth',
      'save', 'translate', 'scale', 'translate', 'lineWidth', 'fill', 'stroke', 'restore',
    ])
    // Square viewBox in a square 540 box → scale 5.4, no letterbox offset.
    expect(opArgs(ctx, 'scale')).toEqual([5.4, 5.4])
    const lineWidths = ctx.ops.filter((o) => o.op === 'lineWidth').map((o) => o.args[0])
    expect(lineWidths[1]).toBeCloseTo(4 / 5.4, 10)
  })

  it('letterboxes rather than skewing when the box is not the viewBox aspect', () => {
    const ctx = record({ ...PATH, transform: transform({ scaleX: 2 }) })
    // Box 1080 × 540, viewBox square → scale = min(1080/100, 540/100) = 5.4,
    // art is 540 wide inside a 1080 box, so it is inset by 270.
    expect(opArgs(ctx, 'scale')).toEqual([5.4, 5.4])
    const first = ctx.ops.filter((o) => o.op === 'translate')[0].args
    expect(first[0]).toBeCloseTo(420 + 270, 6)
    expect(first[1]).toBeCloseTo(270, 6)
  })

  it('offsets a viewBox whose origin is not zero', () => {
    const ctx = record({ ...PATH, shapeViewBox: { x: 10, y: 20, width: 100, height: 100 } })
    expect(ctx.ops.filter((o) => o.op === 'translate')[1].args).toEqual([-10, -20])
  })

  it('passes the fill rule through', () => {
    expect(opArgs(record({ ...PATH, shapeFillRule: 'evenodd' }), 'fill')[1]).toBe('evenodd')
    expect(opArgs(record(PATH), 'fill')[1]).toBe('nonzero')
  })

  it('renders nothing for invalid path data instead of throwing', () => {
    const ctx = record({ ...PATH, shapePath: 'M0 0 !!!' })
    expect(names(ctx)).not.toContain('fill')
    expect(names(ctx)).toContain('restore')
  })

  it('renders nothing when the viewBox has no extent', () => {
    const ctx = record({ ...PATH, shapeViewBox: { x: 0, y: 0, width: 0, height: 100 } })
    expect(names(ctx)).toEqual(['fillStyle', 'strokeStyle', 'lineWidth'])
  })

  it('renders nothing when there is no path data', () => {
    const ctx = record({ ...PATH, shapePath: undefined })
    expect(names(ctx)).toEqual(['fillStyle', 'strokeStyle', 'lineWidth'])
  })
})

// ---------------------------------------------------------------------------
// 7. The signature covers every field the painter reads
// ---------------------------------------------------------------------------

describe('shapePaintSignature', () => {
  const FIELD_CHANGES: Array<[string, Partial<ActiveShapeClip>]> = [
    ['shapeKind', { shapeKind: 'circle' }],
    ['shapeFill', { shapeFill: '#123456' }],
    ['shapeStroke', { shapeStroke: '#654321' }],
    ['shapeStrokeWidth', { shapeStrokeWidth: 9 }],
    ['cornerRadius', { cornerRadius: 0.3 }],
    ['shapeSides', { shapeSides: 7 }],
    ['shapeInnerRatio', { shapeInnerRatio: 0.4 }],
    ['shapeArrowHead', { shapeArrowHead: 'both' }],
    ['shapePath', { shapePath: 'M0 0 L1 1' }],
    ['shapeFillRule', { shapeFillRule: 'evenodd' }],
    ['shapeViewBox', { shapeViewBox: { x: 1, y: 2, width: 3, height: 4 } }],
    ['transform.x', { transform: transform({ x: 0.1 }) }],
    ['transform.y', { transform: transform({ y: 0.1 }) }],
    ['transform.scale', { transform: transform({ scale: 0.9 }) }],
    ['transform.scaleX', { transform: transform({ scaleX: 1.5 }) }],
    ['transform.scaleY', { transform: transform({ scaleY: 1.5 }) }],
    ['transform.rotation', { transform: transform({ rotation: 0.3 }) }],
    ['transform.anchor', { transform: transform({ anchor: { x: 0, y: 1 } }) }],
  ]

  const base = shape({ transform: transform() })

  it.each(FIELD_CHANGES)('changing %s changes the signature', (_field, patch) => {
    expect(shapePaintSignature({ ...base, ...patch }, STAGE)).not.toBe(
      shapePaintSignature(base, STAGE),
    )
  })

  it('opacity does NOT change the signature (it is a uniform, not pixels)', () => {
    expect(shapePaintSignature({ ...base, opacity: 0.3 }, STAGE)).toBe(
      shapePaintSignature(base, STAGE),
    )
  })

  it('a stage resize changes the signature', () => {
    expect(shapePaintSignature(base, PORTRAIT)).not.toBe(shapePaintSignature(base, STAGE))
  })
})

// ---------------------------------------------------------------------------
// 8. Unvalidated input
// ---------------------------------------------------------------------------

describe('paintShape — hostile input', () => {
  it('falls back to the renderer defaults for a non-finite transform', () => {
    const rect = resolveShapeRect(
      { x: NaN, y: Infinity, scale: NaN, rotation: NaN, anchor: { x: NaN, y: NaN } },
      STAGE,
    )
    expect(rect).toEqual({ x: 690, y: 270, width: 540, height: 540, rotation: 0 })
  })

  it('treats a non-finite stroke width as no stroke', () => {
    const ctx = record(shape({ shapeStrokeWidth: NaN }))
    expect(names(ctx)).not.toContain('stroke')
  })
})
