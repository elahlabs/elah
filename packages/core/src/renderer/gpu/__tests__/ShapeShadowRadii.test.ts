/**
 * MC-1d: shape `shadow` and per-corner `cornerRadii` in the vector painter.
 *
 * Its own recording context and `Path2D` stub, like `ShapeVectorPaint.test.ts`:
 * this one also records the four shadow properties (in order with everything
 * else, because "set before the fill, reset before the stroke" IS the contract)
 * and can be built with or without `Path2D.roundRect` to exercise both routes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  hasVectorStyle,
  paintShape,
  resolveCornerRadii,
  shapePaintSignature,
  type Shape2DContext,
} from '../layers/shapePaint'
import type { ActiveShapeClip } from '../../../resolver/scene'
import type { TextShadow } from '../../../types'

const STAGE = { width: 1920, height: 1080 }

interface Op {
  op: string
  args: unknown[]
}

class Recording2D {
  readonly ops: Op[] = []
  private push(op: string, ...args: unknown[]): void {
    this.ops.push({ op, args })
  }
  private v: Record<string, unknown> = {}
  set fillStyle(x: unknown) { this.v.fillStyle = x; this.push('fillStyle', x) }
  get fillStyle(): unknown { return this.v.fillStyle }
  set strokeStyle(x: unknown) { this.v.strokeStyle = x; this.push('strokeStyle', x) }
  get strokeStyle(): unknown { return this.v.strokeStyle }
  set lineWidth(x: number) { this.v.lineWidth = x; this.push('lineWidth', x) }
  get lineWidth(): number { return this.v.lineWidth as number }
  set shadowColor(x: string) { this.v.shadowColor = x; this.push('shadowColor', x) }
  get shadowColor(): string { return this.v.shadowColor as string }
  set shadowBlur(x: number) { this.v.shadowBlur = x; this.push('shadowBlur', x) }
  get shadowBlur(): number { return this.v.shadowBlur as number }
  set shadowOffsetX(x: number) { this.v.shadowOffsetX = x; this.push('shadowOffsetX', x) }
  get shadowOffsetX(): number { return this.v.shadowOffsetX as number }
  set shadowOffsetY(x: number) { this.v.shadowOffsetY = x; this.push('shadowOffsetY', x) }
  get shadowOffsetY(): number { return this.v.shadowOffsetY as number }
  save(): void { this.push('save') }
  restore(): void { this.push('restore') }
  translate(x: number, y: number): void { this.push('translate', x, y) }
  rotate(a: number): void { this.push('rotate', a) }
  scale(x: number, y: number): void { this.push('scale', x, y) }
  fill(...a: unknown[]): void { this.push('fill', ...a) }
  stroke(...a: unknown[]): void { this.push('stroke', ...a) }
  clip(...a: unknown[]): void { this.push('clip', ...a) }
  setLineDash(d: number[]): void { this.push('setLineDash', d) }
}

let withRoundRect = true

class RecordingPath2D {
  readonly ops: Op[] = []
  constructor(_d?: string) {
    if (withRoundRect) {
      ;(this as unknown as { roundRect: unknown }).roundRect = (...a: unknown[]) => this.push('roundRect', ...a)
    }
  }
  private push(op: string, ...args: unknown[]): void {
    this.ops.push({ op, args })
  }
  rect(x: number, y: number, w: number, h: number): void { this.push('rect', x, y, w, h) }
  moveTo(x: number, y: number): void { this.push('moveTo', x, y) }
  lineTo(x: number, y: number): void { this.push('lineTo', x, y) }
  arcTo(...a: number[]): void { this.push('arcTo', ...a) }
  ellipse(...a: number[]): void { this.push('ellipse', ...a) }
  closePath(): void { this.push('closePath') }
  addPath(o: unknown): void { this.push('addPath', o) }
}

beforeEach(() => {
  withRoundRect = true
  ;(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D
})
afterEach(() => {
  delete (globalThis as unknown as { Path2D?: unknown }).Path2D
})

const BASE: ActiveShapeClip = {
  type: 'shape',
  id: 'c1',
  trackId: 't1',
  name: 'S',
  shapeKind: 'rect',
  shapeFill: '#ff0000',
  shapeStroke: '#00ff00',
  shapeStrokeWidth: 4,
  sourceFrame: 0,
  opacity: 1,
  zIndex: 0,
}
const shape = (over: Partial<ActiveShapeClip>): ActiveShapeClip => ({ ...BASE, ...over })
const SHADOW: TextShadow = { color: 'rgba(0,0,0,0.5)', blur: 24, offsetX: 6, offsetY: 12 }

function record(item: ActiveShapeClip): Recording2D {
  const ctx = new Recording2D()
  paintShape(ctx as unknown as Shape2DContext, item, STAGE)
  return ctx
}
const names = (c: Recording2D) => c.ops.map((o) => o.op)

describe('shape shadow', () => {
  it('is on for the fill only: set, fill, reset, then the stroke', () => {
    const ctx = record(shape({ shadow: SHADOW }))
    const n = names(ctx)
    const fillAt = n.indexOf('fill')
    const strokeAt = n.indexOf('stroke')
    // The four properties are written immediately before the fill...
    expect(n.slice(fillAt - 4, fillAt)).toEqual(['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'])
    expect(ctx.ops.slice(fillAt - 4, fillAt).map((o) => o.args[0])).toEqual(['rgba(0,0,0,0.5)', 24, 6, 12])
    // ...and cleared immediately after it, before the stroke is drawn.
    expect(n.slice(fillAt + 1, fillAt + 5)).toEqual(['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'])
    expect(ctx.ops.slice(fillAt + 1, fillAt + 5).map((o) => o.args[0])).toEqual(['transparent', 0, 0, 0])
    expect(strokeAt).toBeGreaterThan(fillAt + 4)
  })

  it('applies to every closed kind and to a path, not to a line', () => {
    for (const shapeKind of ['circle', 'triangle', 'polygon'] as const) {
      expect(names(record(shape({ shapeKind, shadow: SHADOW })))).toContain('shadowBlur')
    }
    const path = shape({ shapeKind: 'path', shapePath: 'M0 0 L10 0 L10 10 Z', shadow: SHADOW })
    expect(names(record(path))).toContain('shadowBlur')
    expect(names(record(shape({ shapeKind: 'line', shadow: SHADOW })))).not.toContain('shadowBlur')
  })

  it('follows the shape rotation, because canvas shadow offsets ignore the transform', () => {
    const ctx = record(
      shape({
        shadow: { color: '#000', blur: 0, offsetX: 10, offsetY: 0 },
        transform: { x: 0.5, y: 0.5, scale: 0.5, rotation: Math.PI / 2, anchor: { x: 0.5, y: 0.5 } },
      }),
    )
    const x = ctx.ops.find((o) => o.op === 'shadowOffsetX')!.args[0] as number
    const y = ctx.ops.find((o) => o.op === 'shadowOffsetY')!.args[0] as number
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(10, 6)
  })

  it('a malformed shadow is no shadow (and does not throw)', () => {
    const bad = { color: 5, blur: 'x' } as unknown as TextShadow
    const ctx = record(shape({ shadow: bad }))
    expect(names(ctx)).not.toContain('shadowBlur')
    expect(names(ctx)).toContain('fill')
  })

  it('also wraps the draw-on fill', () => {
    const ctx = record(shape({ shadow: SHADOW, shapeDraw: { start: 0, end: 1 } }))
    // A full window is not a draw-on; force a partial one that still fills.
    expect(names(ctx)).toContain('shadowBlur')
    const partial = record(shape({ shadow: SHADOW, shapeDraw: { start: 0, end: 0.9 } }))
    const n = names(partial)
    const fillAt = n.indexOf('fill')
    expect(n[fillAt - 1]).toBe('shadowOffsetY')
    expect(n[fillAt + 1]).toBe('shadowColor')
  })
})

describe('shape cornerRadii', () => {
  it('reaches Path2D.roundRect as four px radii [tl, tr, br, bl]', () => {
    const ctx = record(shape({ cornerRadii: [0.1, 0.2, 0.3, 0.4] }))
    const path = ctx.ops.find((o) => o.op === 'fill')!.args[0] as RecordingPath2D
    // 540 px square (scale 0.5 of the 1080 short side) at (690, 270).
    expect(path.ops).toEqual([{ op: 'roundRect', args: [690, 270, 540, 540, [54, 108, 162, 216]] }])
  })

  it('wins over cornerRadius', () => {
    const ctx = record(shape({ cornerRadius: 0.5, cornerRadii: [0, 0, 0, 0.1] }))
    const path = ctx.ops.find((o) => o.op === 'fill')!.args[0] as RecordingPath2D
    expect(path.ops[0]!.args[4]).toEqual([0, 0, 0, 54])
  })

  it('falls back to arcTo with the same four radii when roundRect is absent', () => {
    withRoundRect = false
    const ctx = record(shape({ cornerRadii: [0.1, 0.2, 0.3, 0.4] }))
    const path = ctx.ops.find((o) => o.op === 'fill')!.args[0] as RecordingPath2D
    expect(path.ops.filter((o) => o.op === 'arcTo').map((o) => o.args[4])).toEqual([108, 162, 216, 54])
    expect(path.ops[0]).toEqual({ op: 'moveTo', args: [690 + 54, 270] })
    expect(path.ops[path.ops.length - 1]!.op).toBe('closePath')
  })

  it('clamps each radius to half the short side', () => {
    expect(resolveCornerRadii([0.5, 2, 0, 0.25], 200, 100)).toEqual([50, 50, 0, 25])
  })

  it('a malformed list is ignored and cornerRadius rules', () => {
    for (const bad of [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3, NaN], 'x']) {
      const ctx = record(shape({ cornerRadius: 0.1, cornerRadii: bad as unknown as [number, number, number, number] }))
      const path = ctx.ops.find((o) => o.op === 'fill')!.args[0] as RecordingPath2D
      expect(path.ops.some((o) => o.op === 'roundRect')).toBe(false)
      expect(path.ops.filter((o) => o.op === 'arcTo').map((o) => o.args[4])).toEqual([54, 54, 54, 54])
    }
  })

  it('is read by rect only', () => {
    const ctx = record(shape({ shapeKind: 'circle', cornerRadii: [0.1, 0.1, 0.1, 0.1] }))
    const path = ctx.ops.find((o) => o.op === 'fill')!.args[0] as RecordingPath2D
    expect(path.ops.map((o) => o.op)).toEqual(['ellipse'])
  })
})

describe('shape signature and routing', () => {
  const base = (over: Partial<ActiveShapeClip> = {}) => shapePaintSignature(shape(over), STAGE)

  it('each shadow field and each radius changes the signature', () => {
    const s0 = base({ shadow: SHADOW })
    expect(base({ shadow: SHADOW })).toBe(s0)
    expect(s0).not.toBe(base())
    expect(base({ shadow: { ...SHADOW, color: '#fff' } })).not.toBe(s0)
    expect(base({ shadow: { ...SHADOW, blur: 25 } })).not.toBe(s0)
    expect(base({ shadow: { ...SHADOW, offsetX: 7 } })).not.toBe(s0)
    expect(base({ shadow: { ...SHADOW, offsetY: 13 } })).not.toBe(s0)

    const r0 = base({ cornerRadii: [0.1, 0.1, 0.1, 0.1] })
    expect(r0).not.toBe(base())
    for (let i = 0; i < 4; i++) {
      const radii: [number, number, number, number] = [0.1, 0.1, 0.1, 0.1]
      radii[i] = 0.2
      expect(base({ cornerRadii: radii })).not.toBe(r0)
    }
  })

  it('absent fields leave the signature exactly as it was', () => {
    expect(base({ shadow: undefined, cornerRadii: undefined })).toBe(base())
    expect(hasVectorStyle(shape({}))).toBe(false)
  })

  it('either field routes a clip to the vector painter', () => {
    expect(hasVectorStyle(shape({ shadow: SHADOW }))).toBe(true)
    expect(hasVectorStyle(shape({ cornerRadii: [0, 0, 0, 0] }))).toBe(true)
  })
})

// EXP-2: see the same block in TextShadowDecoration.test.ts. The painter must
// take the output scale from the context as it was HANDED IN: a path shape
// scales the context itself before the fill, and that inner scale must not leak
// into the shadow (canvas shadows ignore it).
class Scaled2D extends Recording2D {
  private k: number
  constructor(base: number) {
    super()
    this.k = base
  }
  override scale(x: number, y: number): void {
    super.scale(x, y)
    this.k *= x
  }
  getTransform(): { a: number; b: number; c: number; d: number } {
    return { a: this.k, b: 0, c: 0, d: this.k }
  }
}

describe('shape shadow under an output scale (EXP-2)', () => {
  const run = (item: ActiveShapeClip, base: number) => {
    const ctx = new Scaled2D(base)
    paintShape(ctx as unknown as Shape2DContext, item, STAGE)
    const at = ctx.ops.findIndex((o) => o.op === 'shadowBlur')
    return ctx.ops.slice(at - 1, at + 3).map((o) => o.args[0])
  }

  it('scales blur and offset by the output scale', () => {
    expect(run(shape({ shadow: SHADOW }), 0.5)).toEqual(['rgba(0,0,0,0.5)', 12, 3, 6])
    expect(run(shape({ shadow: SHADOW }), 2)).toEqual(['rgba(0,0,0,0.5)', 48, 12, 24])
  })

  it('keeps today’s values at an identity transform', () => {
    expect(run(shape({ shadow: SHADOW }), 1)).toEqual(['rgba(0,0,0,0.5)', 24, 6, 12])
  })

  it('ignores the scale the painter applies itself (a path shape)', () => {
    const path = shape({ shapeKind: 'path', shapePath: 'M0 0 L10 0 L10 10 Z', shadow: SHADOW })
    expect(run(path, 0.5)).toEqual(['rgba(0,0,0,0.5)', 12, 3, 6])
    expect(run(path, 1)).toEqual(['rgba(0,0,0,0.5)', 24, 6, 12])
  })
})
