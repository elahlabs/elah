/**
 * ShapeVectorPaint (PV-P6a) — the vector half of the shape painter: gradient
 * or solid paint on fill and stroke, dash, cap, join and stroke alignment.
 *
 * `ShapePaint.test.ts` pins byte identity for a clip that sets none of the
 * seven new fields and is never edited by this ticket. This file has its own
 * recording context and its own `Path2D` stub — deliberately not shared with
 * `ShapePaint.test.ts`'s `Recording2D`/`FakePath2D`, which record neither
 * gradients nor per-instance path ops and would need editing to add them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  paintShape,
  shapePaintSignature,
  hasVectorStyle,
  usableDash,
  SHAPE_LIMITS,
  type Shape2DContext,
} from '../layers/shapePaint'
import type { ActiveShapeClip } from '../../../resolver/scene'
import type { Transform } from '../../../types'

const STAGE = { width: 1920, height: 1080 }

// ---------------------------------------------------------------------------
// A 2D context that records instead of painting
// ---------------------------------------------------------------------------

interface Op {
  op: string
  args: unknown[]
}

class FakeGradient {
  readonly stops: Array<[number, string]> = []
  constructor(
    public readonly kind: 'linear' | 'radial',
    public readonly args: number[],
  ) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color])
  }
}

class Recording2D {
  readonly ops: Op[] = []
  private _fillStyle: unknown = ''
  private _strokeStyle: unknown = ''
  private _lineWidth = 0
  private _lineCap = 'butt'
  private _lineJoin = 'miter'
  private _lineDashOffset = 0

  private push(op: string, ...args: unknown[]): void {
    this.ops.push({ op, args })
  }

  set fillStyle(v: unknown) {
    this._fillStyle = v
    this.push('fillStyle', v)
  }
  get fillStyle(): unknown {
    return this._fillStyle
  }
  set strokeStyle(v: unknown) {
    this._strokeStyle = v
    this.push('strokeStyle', v)
  }
  get strokeStyle(): unknown {
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
  set lineJoin(v: string) {
    this._lineJoin = v
    this.push('lineJoin', v)
  }
  get lineJoin(): string {
    return this._lineJoin
  }
  set lineDashOffset(v: number) {
    this._lineDashOffset = v
    this.push('lineDashOffset', v)
  }
  get lineDashOffset(): number {
    return this._lineDashOffset
  }

  save(): void { this.push('save') }
  restore(): void { this.push('restore') }
  translate(x: number, y: number): void { this.push('translate', x, y) }
  rotate(a: number): void { this.push('rotate', a) }
  scale(x: number, y: number): void { this.push('scale', x, y) }
  // The LEGACY closed-variant path (no vector field) draws on the ctx's own
  // current path, never a standalone Path2D — these two are only exercised by
  // the "early branch is not taken" test below.
  beginPath(): void { this.push('beginPath') }
  rect(x: number, y: number, w: number, h: number): void { this.push('rect', x, y, w, h) }
  fill(...args: unknown[]): void { this.push('fill', ...args) }
  stroke(...args: unknown[]): void { this.push('stroke', ...args) }
  clip(...args: unknown[]): void { this.push('clip', ...args) }
  setLineDash(dash: number[]): void { this.push('setLineDash', dash) }
  createLinearGradient(...a: number[]): FakeGradient {
    this.push('createLinearGradient', ...a)
    return new FakeGradient('linear', a)
  }
  createRadialGradient(...a: number[]): FakeGradient {
    this.push('createRadialGradient', ...a)
    return new FakeGradient('radial', a)
  }
}

/** A standalone `Path2D`: every geometry builds one instead of drawing on the ctx's own path. */
class RecordingPath2D {
  readonly ops: Op[] = []
  constructor(public readonly ctorArg?: string) {
    if (ctorArg && ctorArg.includes('!')) throw new Error('invalid path data')
  }
  private push(op: string, ...args: unknown[]): void {
    this.ops.push({ op, args })
  }
  rect(x: number, y: number, w: number, h: number): void { this.push('rect', x, y, w, h) }
  moveTo(x: number, y: number): void { this.push('moveTo', x, y) }
  lineTo(x: number, y: number): void { this.push('lineTo', x, y) }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.push('arcTo', x1, y1, x2, y2, r)
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void {
    this.push('ellipse', x, y, rx, ry, rot, s, e)
  }
  closePath(): void { this.push('closePath') }
  addPath(other: unknown): void { this.push('addPath', other) }
}

beforeAll(() => {
  ;(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D
})
afterAll(() => {
  delete (globalThis as unknown as { Path2D?: unknown }).Path2D
})

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

function record(item: ActiveShapeClip, stage = STAGE): Recording2D {
  const ctx = new Recording2D()
  paintShape(ctx as unknown as Shape2DContext, item, stage)
  return ctx
}

function names(ctx: Recording2D): string[] {
  return ctx.ops.map((o) => o.op)
}

function opArgs(ctx: Recording2D, name: string): unknown[] {
  const found = ctx.ops.find((o) => o.op === name)
  if (!found) throw new Error(`no "${name}" op recorded; got ${names(ctx).join(', ')}`)
  return found.args
}

function allOpArgs(ctx: Recording2D, name: string): unknown[][] {
  return ctx.ops.filter((o) => o.op === name).map((o) => o.args)
}

const PATH_ITEM: ActiveShapeClip = shape({
  shapeKind: 'path',
  shapePath: 'M0 0 L100 0 L100 100 Z',
  shapeViewBox: { x: 0, y: 0, width: 100, height: 100 },
})

// ---------------------------------------------------------------------------
// Step 3: closed variants, centre stroke, cap/join/dash
// ---------------------------------------------------------------------------

describe('paintShape — the early branch', () => {
  it('a legacy clip (no PV-P6a field) never reaches the vector painter', () => {
    const ctx = record(shape({}))
    expect(names(ctx)).toEqual(['fillStyle', 'strokeStyle', 'lineWidth', 'beginPath', 'rect', 'fill', 'stroke'])
  })
})

describe('paintVectorShape — closed variants', () => {
  it('cap alone: save fillStyle strokeStyle lineCap fill lineWidth stroke restore', () => {
    const ctx = record(shape({ shapeStrokeCap: 'round' }))
    expect(names(ctx)).toEqual([
      'save', 'fillStyle', 'strokeStyle', 'lineCap', 'fill', 'lineWidth', 'stroke', 'restore',
    ])
    expect(opArgs(ctx, 'fill')).toEqual([expect.any(RecordingPath2D), 'nonzero'])
    const path = opArgs(ctx, 'fill')[0] as RecordingPath2D
    expect(path.ops).toEqual([{ op: 'rect', args: [690, 270, 540, 540] }])
  })

  it('dash and its offset both land before the stroke', () => {
    const ctx = record(shape({ shapeStrokeDash: [12, 6], shapeStrokeDashOffset: 3 }))
    expect(opArgs(ctx, 'setLineDash')).toEqual([[12, 6]])
    expect(opArgs(ctx, 'lineDashOffset')).toEqual([3])
    const dashAt = names(ctx).indexOf('setLineDash')
    const offsetAt = names(ctx).indexOf('lineDashOffset')
    const strokeAt = names(ctx).indexOf('stroke')
    expect(dashAt).toBeLessThan(strokeAt)
    expect(offsetAt).toBeLessThan(strokeAt)
  })

  it('usableDash: hostile input falls back to a solid stroke, well-formed input passes through', () => {
    expect(usableDash([-1, 5])).toBeUndefined()
    expect(usableDash([0, 0])).toBeUndefined()
    expect(usableDash([NaN])).toBeUndefined()
    expect(usableDash([])).toBeUndefined()
    expect(usableDash(Array.from({ length: 33 }, () => 1))).toBeUndefined()
    expect(usableDash('x')).toBeUndefined()
    expect(usableDash([0, 4])).toEqual([0, 4])
  })

  it('circle with a bevel join: an ellipse path and the join written', () => {
    const ctx = record(shape({ shapeKind: 'circle', shapeStrokeJoin: 'bevel' }))
    const path = opArgs(ctx, 'fill')[0] as RecordingPath2D
    expect(path.ops).toEqual([{ op: 'ellipse', args: [960, 540, 270, 270, 0, 0, Math.PI * 2] }])
    expect(opArgs(ctx, 'lineJoin')).toEqual(['bevel'])
  })

  it('a zero stroke width with a cap set paints no stroke and no lineWidth', () => {
    const ctx = record(shape({ shapeStrokeWidth: 0, shapeStrokeCap: 'round' }))
    expect(names(ctx)).not.toContain('stroke')
    expect(names(ctx)).not.toContain('lineWidth')
  })

  it('without Path2D the vector painter emits nothing at all', () => {
    const saved = (globalThis as unknown as { Path2D?: unknown }).Path2D
    delete (globalThis as unknown as { Path2D?: unknown }).Path2D
    try {
      const ctx = record(shape({ shapeStrokeCap: 'round' }))
      expect(ctx.ops).toEqual([])
    } finally {
      ;(globalThis as unknown as { Path2D: unknown }).Path2D = saved
    }
  })
})

// ---------------------------------------------------------------------------
// Step 4: stroke alignment
// ---------------------------------------------------------------------------

describe('paintVectorShape — stroke alignment', () => {
  it('inside: doubled stroke width, clipped to the fill path', () => {
    const ctx = record(shape({ shapeStrokeAlign: 'inside' }))
    expect(names(ctx)).toEqual([
      'save', 'fillStyle', 'strokeStyle', 'fill', 'save', 'clip', 'lineWidth', 'stroke', 'restore', 'restore',
    ])
    const path = opArgs(ctx, 'fill')[0]
    expect(opArgs(ctx, 'clip')).toEqual([path, 'nonzero'])
    expect(opArgs(ctx, 'lineWidth')).toEqual([8])
  })

  it('outside: clipped to a padded outer rect minus the shape, even-odd', () => {
    const ctx = record(shape({ shapeStrokeAlign: 'outside' }))
    const clipArgs = opArgs(ctx, 'clip')
    expect(clipArgs[1]).toBe('evenodd')
    const outer = clipArgs[0] as RecordingPath2D
    // pad = 12 * 4 + 2 = 50
    expect(outer.ops).toEqual([
      { op: 'rect', args: [640, 220, 640, 640] },
      { op: 'addPath', args: [expect.any(RecordingPath2D)] },
    ])
  })

  it('a line ignores stroke alignment entirely', () => {
    const ctx = record(shape({ shapeKind: 'line', shapeStrokeAlign: 'inside' }))
    expect(names(ctx)).not.toContain('clip')
  })
})

// ---------------------------------------------------------------------------
// Step 5: paint (gradient / solid fill and stroke)
// ---------------------------------------------------------------------------

describe('paintVectorShape — paint', () => {
  it('a linear fill creates exactly one gradient and assigns it as fillStyle', () => {
    const ctx = record(
      shape({ shapeFillPaint: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] } }),
    )
    expect(allOpArgs(ctx, 'createLinearGradient')).toHaveLength(1)
    expect(allOpArgs(ctx, 'createRadialGradient')).toHaveLength(0)
    const gradient = allOpArgs(ctx, 'createLinearGradient')
    const fillWrite = ctx.ops.find((o) => o.op === 'fillStyle')!
    expect(fillWrite.args[0]).toBeInstanceOf(FakeGradient)
    expect((fillWrite.args[0] as FakeGradient).args).toEqual(gradient[0])
  })

  it('a radial stroke creates a radial gradient and assigns it as strokeStyle', () => {
    const ctx = record(
      shape({ shapeStrokePaint: { type: 'radial', cx: 0.5, cy: 0.5, r: 1, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] } }),
    )
    expect(allOpArgs(ctx, 'createRadialGradient')).toHaveLength(1)
    const strokeWrite = ctx.ops.find((o) => o.op === 'strokeStyle')!
    expect(strokeWrite.args[0]).toBeInstanceOf(FakeGradient)
    expect((strokeWrite.args[0] as FakeGradient).kind).toBe('radial')
  })

  it('a solid Paint assigns its colour string, no gradient created', () => {
    const ctx = record(shape({ shapeFillPaint: { type: 'solid', color: '#123456' }, shapeStrokeCap: 'round' }))
    expect(opArgs(ctx, 'fillStyle')).toEqual(['#123456'])
    expect(names(ctx)).not.toContain('createLinearGradient')
    expect(names(ctx)).not.toContain('createRadialGradient')
  })
})

// ---------------------------------------------------------------------------
// Step 6: path and line
// ---------------------------------------------------------------------------

describe('paintVectorShape — path', () => {
  it('scales the dash and the stroke width into viewBox units', () => {
    const ctx = record({ ...PATH_ITEM, shapeStrokeDash: [12, 6] })
    expect(names(ctx).slice(0, 4)).toEqual(['save', 'translate', 'scale', 'translate'])
    expect(opArgs(ctx, 'scale')).toEqual([5.4, 5.4])
    const dash = opArgs(ctx, 'setLineDash')[0] as number[]
    expect(dash[0]).toBeCloseTo(12 / 5.4, 10)
    expect(dash[1]).toBeCloseTo(6 / 5.4, 10)
    const lineWidths = ctx.ops.filter((o) => o.op === 'lineWidth').map((o) => o.args[0] as number)
    expect(lineWidths[0]).toBeCloseTo(4 / 5.4, 10)
  })

  it('creates the gradient with the ctx already scaled', () => {
    const ctx = record({
      ...PATH_ITEM,
      shapeFillPaint: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] },
    })
    const scaleAt = names(ctx).indexOf('scale')
    const gradientAt = names(ctx).indexOf('createLinearGradient')
    expect(scaleAt).toBeGreaterThanOrEqual(0)
    expect(gradientAt).toBeGreaterThan(scaleAt)
  })

  it('passes the fill rule through', () => {
    const ctx = record({ ...PATH_ITEM, shapeFillRule: 'evenodd', shapeStrokeCap: 'round' })
    expect(opArgs(ctx, 'fill')[1]).toBe('evenodd')
  })
})

describe('paintVectorShape — line', () => {
  it('an explicit cap overrides the legacy round default', () => {
    const ctx = record(shape({ shapeKind: 'line', shapeStrokeCap: 'butt' }))
    expect(opArgs(ctx, 'lineCap')).toEqual(['butt'])
  })

  it('the cap is always written, and defaults to round with no cap field', () => {
    const ctx = record(shape({ shapeKind: 'line', shapeStrokeDash: [4, 2] }))
    expect(opArgs(ctx, 'lineCap')).toEqual(['round'])
  })

  it('both arrowheads paint in the stroke paint, by reference', () => {
    const ctx = record(
      shape({
        shapeKind: 'line',
        shapeArrowHead: 'both',
        shapeStrokePaint: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] },
      }),
    )
    expect(names(ctx).filter((n) => n === 'fill')).toHaveLength(2)
    const strokeWrite = ctx.ops.find((o) => o.op === 'strokeStyle')!.args[0]
    const fillWrites = ctx.ops.filter((o) => o.op === 'fillStyle').map((o) => o.args[0])
    expect(fillWrites).toEqual([strokeWrite])
  })
})

// ---------------------------------------------------------------------------
// Step 7: draw-on, rotation
// ---------------------------------------------------------------------------

describe('paintVectorShape — draw-on and rotation', () => {
  it('a draw-on owns the dash and disables alignment', () => {
    const ctx = record(
      shape({ shapeDraw: { start: 0, end: 0.5 }, shapeStrokeDash: [1, 1], shapeStrokeAlign: 'inside' }),
    )
    expect(names(ctx)).not.toContain('clip')
    const dashCalls = allOpArgs(ctx, 'setLineDash')
    expect(dashCalls).toHaveLength(1)
    const [visible, gap] = dashCalls[0]![0] as number[]
    // side 540, perimeter of a square rect = 4 * 540 = 2160.
    expect(gap).toBeCloseTo(2 * 2160, 6)
    expect(visible).toBeCloseTo(0.5 * 2160, 6)
  })

  it('rotation wraps the vector path the same way the legacy path does', () => {
    const ctx = record(shape({ shapeStrokeCap: 'round', transform: transform({ rotation: Math.PI / 4 }) }))
    expect(names(ctx).slice(0, 4)).toEqual(['save', 'translate', 'rotate', 'translate'])
    const translates = ctx.ops.filter((o) => o.op === 'translate').map((o) => o.args)
    expect(translates).toEqual([[960, 540], [-960, -540]])
  })
})

// ---------------------------------------------------------------------------
// Step 8: signature
// ---------------------------------------------------------------------------

describe('shapePaintSignature — PV-P6a', () => {
  const legacy = shape({ transform: transform() })

  function legacySignatureString(item: ActiveShapeClip, stage: { width: number; height: number }): string {
    return JSON.stringify([
      item.shapeKind,
      item.shapeFill,
      item.shapeStroke,
      item.shapeStrokeWidth,
      item.transform?.x,
      item.transform?.y,
      item.transform?.scale,
      item.transform?.scaleX,
      item.transform?.scaleY,
      item.transform?.rotation,
      item.transform?.anchor?.x,
      item.transform?.anchor?.y,
      item.cornerRadius,
      item.shapeSides,
      item.shapeInnerRatio,
      item.shapeArrowHead,
      item.shapePath,
      item.shapeViewBox?.x,
      item.shapeViewBox?.y,
      item.shapeViewBox?.width,
      item.shapeViewBox?.height,
      item.shapeFillRule,
      stage.width,
      stage.height,
      item.shapeDraw ? [item.shapeDraw.start, item.shapeDraw.end] : null,
    ])
  }

  it('a legacy item parses to 25 entries and matches the pre-P6a string exactly', () => {
    const sig = shapePaintSignature(legacy, STAGE)
    expect(JSON.parse(sig)).toHaveLength(25)
    expect(sig).toBe(legacySignatureString(legacy, STAGE))
  })

  it('hasVectorStyle is false for a clip with none of the seven fields', () => {
    expect(hasVectorStyle(legacy)).toBe(false)
  })

  const FIELD_CHANGES: Array<[string, Partial<ActiveShapeClip>]> = [
    ['shapeFillPaint', { shapeFillPaint: { type: 'solid', color: '#111' } }],
    ['shapeStrokePaint', { shapeStrokePaint: { type: 'solid', color: '#222' } }],
    ['shapeStrokeDash', { shapeStrokeDash: [1, 2] }],
    ['shapeStrokeDashOffset', { shapeStrokeDashOffset: 5 }],
    ['shapeStrokeCap', { shapeStrokeCap: 'round' }],
    ['shapeStrokeJoin', { shapeStrokeJoin: 'bevel' }],
    ['shapeStrokeAlign', { shapeStrokeAlign: 'inside' }],
  ]

  it.each(FIELD_CHANGES)('%s changes the signature', (_field, patch) => {
    const withField = { ...legacy, ...patch }
    expect(shapePaintSignature(withField, STAGE)).not.toBe(shapePaintSignature(legacy, STAGE))
  })

  it('a vector item"s signature array has length 26', () => {
    const vector = shape({ shapeStrokeCap: 'round' })
    expect(JSON.parse(shapePaintSignature(vector, STAGE))).toHaveLength(26)
  })

  it('opacity does not change a vector item"s signature', () => {
    const vector = shape({ shapeStrokeCap: 'round' })
    expect(shapePaintSignature({ ...vector, opacity: 0.2 }, STAGE)).toBe(shapePaintSignature(vector, STAGE))
  })
})
