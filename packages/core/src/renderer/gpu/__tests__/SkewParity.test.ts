/**
 * SkewParity (MOT-8 phase A) - skewX / skewY agree across every path that draws a clip.
 *
 * Skew is a fourth term on top of rotation, and rotation already needs the GPU quad, the
 * 2D-canvas export path and the CSS overlay to agree. The order is CSS "rotate() skew()":
 * the scaled box is sheared about its centre, then rotated about the same centre.
 *
 *   GPU quad (preview image / video / sequence / compound)  buildTransformMatrixFromRect
 *   2D export of those same clips                           translate, rotate, applyShear, draw
 *   text / shape / freehand painters (preview AND export)   the same painters, 2D ops
 *   selection overlay                                       CSS rotate() skew()  (editor package)
 *
 * Everything is checked at the four CORNERS on a NON-SQUARE stage (1920x1080 and 1080x1920): a
 * shear applied in normalized space instead of pixel space is invisible at the centre and on a
 * square stage. The reference below is first-principles maths, deliberately not the code under test.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildDrawTransformMatrix,
  buildTransformMatrixFromRect,
  resolveDrawRect,
  applyShear,
  rectShear,
  skewShear,
  MAX_SKEW_RAD,
  type DrawRect,
} from '../layers/drawRect'
import { resolveShapeRect, paintShape } from '../layers/shapePaint'
import { freehandPlacement, paintFreehand, freehandPaintSignature } from '../layers/freehandPaint'
import { paintText, textPaintSignature } from '../layers/textPaint'
import { shapePaintSignature } from '../layers/shapePaint'
import type { ActiveFreehandClip, ActiveShapeClip, ActiveTextClip } from '../../../resolver/scene'
import type { Transform } from '../../../types'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { TRANSFORM_CHANNELS, isBuiltinKeyframeChannel, isExpressionChannel, sampleKeyframes } from '../../../resolver/keyframes'
import { editableTransform, setKeyframe } from '../../../elements/keyframes'

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
const STAGES = [LANDSCAPE, PORTRAIT]
const deg = (d: number) => (d * Math.PI) / 180

type Pt = { x: number; y: number }

function transform(over: Partial<Transform> = {}): Transform {
  return { x: 0.4, y: 0.6, scale: 0.5, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...over }
}

const SKEW_CASES: Array<{ name: string; t: Partial<Transform> }> = [
  { name: 'skewX 20deg', t: { skewX: deg(20) } },
  { name: 'skewY -15deg', t: { skewY: deg(-15) } },
  { name: 'skewX + skewY', t: { skewX: deg(25), skewY: deg(10) } },
  { name: 'skewX with rotation 30deg', t: { skewX: deg(20), rotation: deg(30) } },
  { name: 'skewY with rotation -70deg', t: { skewY: deg(35), rotation: deg(-70) } },
  { name: 'skew + rotation + scaleX/scaleY', t: { skewX: deg(18), skewY: deg(-8), rotation: deg(40), scaleX: 1.8, scaleY: 0.6 } },
  { name: 'skew + rotation + off-centre anchor', t: { skewX: deg(30), rotation: deg(15), anchor: { x: 0.1, y: 0.9 } } },
]

// ---------------------------------------------------------------------------
// First-principles reference
// ---------------------------------------------------------------------------

/** p -> centre + R(K(p - centre)), with the box already at its final size. K = [[1, tan ax], [tan ay, 1]]. */
function reference(rect: DrawRect, u: number, v: number): Pt {
  const kx = Math.tan(rect.skewX ?? 0)
  const ky = Math.tan(rect.skewY ?? 0)
  const lx = (u - 0.5) * rect.width
  const ly = (v - 0.5) * rect.height
  const sx = lx + kx * ly
  const sy = ky * lx + ly
  const c = Math.cos(rect.rotation)
  const s = Math.sin(rect.rotation)
  return { x: rect.x + rect.width / 2 + (sx * c - sy * s), y: rect.y + rect.height / 2 + (sx * s + sy * c) }
}

const CORNERS: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]]

/** The GPU matrix applied to a unit-quad corner, back in stage pixels. */
function gpuCorner(m: Float32Array, stage: { width: number; height: number }, u: number, v: number): Pt {
  const nx = m[0] * u + m[3] * v + m[6]
  const ny = m[1] * u + m[4] * v + m[7]
  return { x: ((nx + 1) / 2) * stage.width, y: ((ny + 1) / 2) * stage.height }
}

// ---------------------------------------------------------------------------
// A 2D context that tracks the current matrix, as the canvas does
// ---------------------------------------------------------------------------

type Mat = [number, number, number, number, number, number]
const mul = (p: Mat, q: Mat): Mat => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
]
const apply = (m: Mat, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

function trackingCtx() {
  let m: Mat = [1, 0, 0, 1, 0, 0]
  const stack: Mat[] = []
  const ops: string[] = []
  const rects: Pt[][] = []
  const texts: Array<{ text: string; m: Mat }> = []
  const store: Record<string, unknown> = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 }
  const log = (name: string, args: unknown[]) => ops.push(`${name}(${args.map((a) => (typeof a === 'number' ? +a.toFixed(6) : typeof a)).join(',')})`)
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => { stack.push(m); ops.push('save') },
    restore: () => { m = stack.pop() ?? m; ops.push('restore') },
    translate: (x, y) => { m = mul(m, [1, 0, 0, 1, x, y]); log('translate', [x, y]) },
    rotate: (a) => { m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); log('rotate', [a]) },
    scale: (x, y) => { m = mul(m, [x, 0, 0, y, 0, 0]); log('scale', [x, y]) },
    transform: (a, b, c, d, e, f) => { m = mul(m, [a, b, c, d, e, f]); log('transform', [a, b, c, d, e, f]) },
    rect: (x, y, w, h) => { rects.push([apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)]); log('rect', [x, y, w, h]) },
    measureText: (() => undefined) as never,
  }
  const target: Record<string, unknown> = { ...store, ...methods }
  target.measureText = (t: string) => ({ width: t.length * 10 })
  target.fillText = (t: string, x: number, y: number) => { texts.push({ text: t, m }); log('fillText', [x, y]) }
  const ctx = new Proxy(target, {
    get: (t, p: string) => (p in t ? t[p] : (...a: unknown[]) => { log(p, a); return undefined }),
    set: (t, p: string, v) => { t[p] = v; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, rects, texts, matrix: () => m }
}

function close(a: Pt, b: Pt, eps = 0.01) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps)
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps)
}

// ---------------------------------------------------------------------------
// Media: image, video, sequence, compound (one placement function, two renderers)
// ---------------------------------------------------------------------------

describe('skew - media quad: GPU matrix vs the 2D export path vs first principles', () => {
  for (const stage of STAGES) {
    for (const c of SKEW_CASES) {
      it(`${c.name} on ${stage.width}x${stage.height}: four corners agree within 0.01 px`, () => {
        const t = transform(c.t)
        const rect = resolveDrawRect(t, stage.width, stage.height, 640, 360)
        const matrix = buildDrawTransformMatrix(t, stage.width, stage.height, 640, 360)

        // The export path: ExportWorker.drawMedia's own op sequence.
        const ex = trackingCtx()
        ex.ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
        ex.ctx.rotate(rect.rotation)
        applyShear(ex.ctx, rectShear(rect))
        ex.ctx.rect(-rect.width / 2, -rect.height / 2, rect.width, rect.height)

        CORNERS.forEach(([u, v], i) => {
          const want = reference(rect, u, v)
          close(gpuCorner(matrix, stage, u, v), want)
          close(ex.rects[0][i], want)
        })
      })
    }
  }

  it('crops and cover/contain sizes do not change the pivot: skewed corners still agree', () => {
    const t = transform({ skewX: deg(22), rotation: deg(12), anchor: { x: 0, y: 0 } })
    const crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }
    const rect = resolveDrawRect(t, 1920, 1080, 1000, 700, crop)
    const m = buildDrawTransformMatrix(t, 1920, 1080, 1000, 700, crop)
    CORNERS.forEach(([u, v]) => close(gpuCorner(m, LANDSCAPE, u, v), reference(rect, u, v)))
  })

  it('the export worker really issues rotate then applyShear (drawMedia)', () => {
    const src = readFileSync(new URL('../../../export/ExportWorker.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain('ctx.rotate(rect.rotation)\n  // MOT-8: rotate, then shear')
    expect(src).toContain('applyShear(ctx, rectShear(rect))')
  })
})

describe('skew - skew 0 changes nothing', () => {
  const OLD = (rect: DrawRect, sw: number, sh: number) => {
    // The matrix as buildTransformMatrixFromRect computed it before skew existed.
    const sc = Math.cos(rect.rotation)
    const ss = Math.sin(rect.rotation)
    const m00 = (2 * rect.width * sc) / sw
    const m01 = (2 * rect.width * ss) / sh
    const m10 = (-2 * rect.height * ss) / sw
    const m11 = (2 * rect.height * sc) / sh
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    return new Float32Array([m00, m01, 0, m10, m11, 0, (2 * cx) / sw - 1 - (m00 + m10) / 2, (2 * cy) / sh - 1 - (m01 + m11) / 2, 1])
  }

  for (const stage of STAGES) {
    for (const rotation of [0, deg(30), deg(90), deg(-135)]) {
      it(`matrix is bit-identical to the pre-skew formula (rotation ${Math.round((rotation * 180) / Math.PI)}deg, ${stage.width}x${stage.height})`, () => {
        const t = transform({ rotation, scaleX: 1.3, scaleY: 0.7 })
        const rect = resolveDrawRect(t, stage.width, stage.height, 640, 360)
        expect(Object.keys(rect)).toEqual(['x', 'y', 'width', 'height', 'rotation'])
        expect(buildTransformMatrixFromRect(rect, stage.width, stage.height)).toEqual(OLD(rect, stage.width, stage.height))
        // Explicit zeros are the same as absent.
        const zeroed = resolveDrawRect({ ...t, skewX: 0, skewY: 0 }, stage.width, stage.height, 640, 360)
        expect(zeroed).toEqual(rect)
        expect('skewX' in zeroed).toBe(false)
        expect(buildTransformMatrixFromRect(zeroed, stage.width, stage.height)).toEqual(OLD(rect, stage.width, stage.height))
      })
    }
  }

  it('a non-finite or zero skew has no shear, and a huge one is clamped below 90 degrees', () => {
    expect(skewShear(undefined, undefined)).toBeUndefined()
    expect(skewShear(0, -0)).toBeUndefined()
    expect(skewShear(Number.NaN, Infinity)).toBeUndefined()
    const big = skewShear(deg(120), deg(-200))!
    expect(Number.isFinite(big.kx)).toBe(true)
    expect(big.kx).toBeCloseTo(Math.tan(MAX_SKEW_RAD), 9)
    expect(big.ky).toBeCloseTo(-Math.tan(MAX_SKEW_RAD), 9)
  })

  it('applyShear with no shear issues no call', () => {
    const { ctx, ops } = trackingCtx()
    applyShear(ctx, undefined)
    expect(ops).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function shape(t: Transform): ActiveShapeClip {
  return {
    id: 's', trackId: 'tr', name: 's', type: 'shape', sourceFrame: 0, opacity: 1, zIndex: 0,
    shapeKind: 'rect', shapeFill: '#fff', shapeStroke: '#000', shapeStrokeWidth: 0, transform: t,
  } as ActiveShapeClip
}

describe('skew - shapes: the painter draws the box the GPU matrix would', () => {
  for (const stage of STAGES) {
    for (const c of SKEW_CASES) {
      it(`${c.name} on ${stage.width}x${stage.height}`, () => {
        const t = transform(c.t)
        const item = shape(t)
        const rect = resolveShapeRect(t, stage)
        const matrix = buildTransformMatrixFromRect(rect, stage.width, stage.height)
        const { ctx, rects } = trackingCtx()
        paintShape(ctx as never, item, stage)
        expect(rects).toHaveLength(1)
        CORNERS.forEach(([u, v], i) => {
          const want = reference(rect, u, v)
          close(rects[0][i], want)
          close(gpuCorner(matrix, stage, u, v), want)
        })
      })
    }
  }

  it('skew 0 issues exactly the calls an unskewed shape does (no transform call)', () => {
    const base = transform({ rotation: deg(20), scaleX: 1.4 })
    const a = trackingCtx()
    paintShape(a.ctx as never, shape(base), LANDSCAPE)
    const b = trackingCtx()
    paintShape(b.ctx as never, shape({ ...base, skewX: 0, skewY: 0 }), LANDSCAPE)
    expect(b.ops).toEqual(a.ops)
    expect(a.ops.some((o) => o.startsWith('transform('))).toBe(false)
    expect(shapePaintSignature(shape({ ...base, skewX: 0, skewY: 0 }), LANDSCAPE)).toBe(shapePaintSignature(shape(base), LANDSCAPE))
  })

  it('a skew change changes the paint signature (the preview re-uploads its texture)', () => {
    const base = transform()
    expect(shapePaintSignature(shape({ ...base, skewX: deg(10) }), LANDSCAPE)).not.toBe(shapePaintSignature(shape(base), LANDSCAPE))
    expect(shapePaintSignature(shape({ ...base, skewY: deg(10) }), LANDSCAPE)).not.toBe(shapePaintSignature(shape({ ...base, skewX: deg(10) }), LANDSCAPE))
  })
})

// ---------------------------------------------------------------------------
// Freehand
// ---------------------------------------------------------------------------

function freehand(t: Transform): ActiveFreehandClip {
  return {
    id: 'f', trackId: 'tr', name: 'f', type: 'freehand', sourceFrame: 0, opacity: 1, zIndex: 0,
    pathData: 'M 100 100 L 500 100 L 500 300 L 100 300 Z', strokeColor: '#fff', strokeWidth: 4, transformModel: 'v2', transform: t,
  } as ActiveFreehandClip
}

describe('skew - freehand: the path matrix maps the path box onto the GPU quad', () => {
  for (const stage of STAGES) {
    for (const c of SKEW_CASES) {
      it(`${c.name} on ${stage.width}x${stage.height}`, () => {
        const placed = freehandPlacement(freehand(transform(c.t)), stage)!
        const matrix = buildTransformMatrixFromRect(placed.rect, stage.width, stage.height)
        const m = placed.matrix as unknown as Mat
        const b = placed.bounds
        CORNERS.forEach(([u, v]) => {
          const mapped = apply(m, b.x + u * b.width, b.y + v * b.height)
          close(mapped, reference(placed.rect, u, v))
          close(mapped, gpuCorner(matrix, stage, u, v))
        })
      })
    }
  }

  it('skew 0 keeps the matrix and the signature it always had', () => {
    const base = transform({ rotation: deg(33), scaleX: 1.2 })
    const a = freehandPlacement(freehand(base), LANDSCAPE)!
    const b = freehandPlacement(freehand({ ...base, skewX: 0, skewY: 0 }), LANDSCAPE)!
    expect(b.matrix).toEqual(a.matrix)
    expect(freehandPaintSignature(freehand({ ...base, skewX: 0, skewY: 0 }), LANDSCAPE)).toBe(freehandPaintSignature(freehand(base), LANDSCAPE))
    expect(freehandPaintSignature(freehand({ ...base, skewX: deg(5) }), LANDSCAPE)).not.toBe(freehandPaintSignature(freehand(base), LANDSCAPE))
  })

  it('paintFreehand applies the placement matrix (stroke under the transformed ctx)', () => {
    const { ctx, ops } = trackingCtx()
    ;(globalThis as { Path2D?: unknown }).Path2D ??= class {}
    paintFreehand(ctx as never, freehand(transform({ skewX: deg(20) })), LANDSCAPE)
    expect(ops.filter((o) => o.startsWith('transform('))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Text (v2 and legacy)
// ---------------------------------------------------------------------------

function text(t: Transform, v2: boolean): ActiveTextClip {
  return {
    id: 't', trackId: 'tr', name: 't', type: 'text', content: 'HELLO WORLD', sourceFrame: 0, opacity: 1, zIndex: 0,
    ...(v2 ? { transformModel: 'v2' as const } : {}), transform: t,
  } as ActiveTextClip
}

describe('skew - text: rotate, then shear, then stretch, all about the layout centre', () => {
  for (const v2 of [true, false]) {
    for (const stage of STAGES) {
      for (const c of SKEW_CASES) {
        it(`${v2 ? 'v2' : 'legacy'} ${c.name} on ${stage.width}x${stage.height}`, () => {
          const t = transform(c.t)
          const item = text(t, v2)
          const { ctx, texts } = trackingCtx()
          const layout = paintText(ctx as never, item, stage)
          expect(texts).toHaveLength(1)

          const C = { x: layout.center.x * stage.width, y: layout.center.y * stage.height }
          const sx = layout.stretch?.x ?? 1
          const sy = layout.stretch?.y ?? 1
          const kx = Math.tan(t.skewX ?? 0)
          const ky = Math.tan(t.skewY ?? 0)
          const cs = Math.cos(t.rotation)
          const sn = Math.sin(t.rotation)
          // T(C) * R * K * S * T(-C), first principles.
          const R: Mat = [cs, sn, -sn, cs, 0, 0]
          const K: Mat = [1, ky, kx, 1, 0, 0]
          const S: Mat = [sx, 0, 0, sy, 0, 0]
          const want = mul(mul(mul(mul([1, 0, 0, 1, C.x, C.y], R), K), S), [1, 0, 0, 1, -C.x, -C.y])
          const got = texts[0].m
          for (let i = 0; i < 6; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-6)
          // And the four corners of the layout box land where the reference puts them.
          const { box } = layout
          for (const [u, v] of CORNERS) {
            const p = { x: box.x + u * box.width, y: box.y + v * box.height }
            close(apply(got, p.x, p.y), apply(want, p.x, p.y))
          }
        })
      }
    }
  }

  it('skew 0 issues exactly the calls unskewed text does, and keeps its signature', () => {
    const base = transform({ rotation: deg(20) })
    const a = trackingCtx()
    paintText(a.ctx as never, text(base, true), LANDSCAPE)
    const b = trackingCtx()
    paintText(b.ctx as never, text({ ...base, skewX: 0, skewY: 0 }, true), LANDSCAPE)
    expect(b.ops).toEqual(a.ops)
    expect(a.ops.some((o) => o.startsWith('transform('))).toBe(false)
    expect(textPaintSignature(text({ ...base, skewX: 0, skewY: 0 }, true), LANDSCAPE)).toBe(textPaintSignature(text(base, true), LANDSCAPE))
    expect(textPaintSignature(text({ ...base, skewX: deg(9) }, true), LANDSCAPE)).not.toBe(textPaintSignature(text(base, true), LANDSCAPE))
  })
})

// ---------------------------------------------------------------------------
// Keyed skew: sampled, resolved onto the scene item, written by gestures
// ---------------------------------------------------------------------------

describe('skew - keyframes carry the channel to the scene item', () => {
  const key = (frame: number, value: number) => ({ id: `k${frame}`, frame, value, easing: 'linear' as const })
  const track = (...ks: ReturnType<typeof key>[]) => ({ source: { kind: 'keyframes' as const }, keys: ks })

  it('skewX / skewY are builtin transform channels, and unclamped', () => {
    expect(TRANSFORM_CHANNELS).toContain('skewX')
    expect(TRANSFORM_CHANNELS).toContain('skewY')
    expect(isBuiltinKeyframeChannel('skewX')).toBe(true)
    expect(isExpressionChannel('skewY')).toBe(true)
    const s = sampleKeyframes({ channels: { skewX: track(key(0, 0), key(10, 3)) } } as never, 5, transform())
    expect(s.transform?.skewX).toBeCloseTo(1.5, 9)
    expect(s.transform?.skewY).toBeUndefined()
  })

  it('an image clip with a keyed skew resolves a skewed transform that draws the reference corners', () => {
    const engine = new TimelineEngine({ fps: 30, stage: LANDSCAPE })
    const trackId = engine.addTrack('video').id
    const clip = engine.addClip({ trackId, type: 'image', name: 'I', src: 'x.png', startFrame: 0, durationFrames: 60 })
    engine.updateClip(clip.id, trackId, {
      transform: transform({ rotation: deg(10) }),
      keyframes: { channels: { skewX: track(key(0, 0), key(30, deg(30))) } },
    } as never)
    const item = resolveTimeline(15, engine.getProject()).images[0]!
    expect(item.transform?.skewX).toBeCloseTo(deg(15), 9)
    const rect = resolveDrawRect(item.transform, LANDSCAPE.width, LANDSCAPE.height, 640, 360)
    expect(rect.skewX).toBeCloseTo(deg(15), 9)
    const m = buildDrawTransformMatrix(item.transform, LANDSCAPE.width, LANDSCAPE.height, 640, 360)
    CORNERS.forEach(([u, v]) => close(gpuCorner(m, LANDSCAPE, u, v), reference(rect, u, v)))
  })

  it('a gesture on a skewed clip keeps its skew (editableTransform) and an unskewed one gains none', () => {
    const fallback = transform()
    expect(editableTransform(transform({ skewX: deg(12) }), fallback).skewX).toBeCloseTo(deg(12), 9)
    expect('skewX' in editableTransform(transform(), fallback)).toBe(false)
    expect('skewY' in editableTransform(undefined, fallback)).toBe(false)
  })

  it('setKeyframe on a clip without skew starts the key from 0, not from the 0.5 default of position', () => {
    const engine = new TimelineEngine({ fps: 30, stage: LANDSCAPE })
    const trackId = engine.addTrack('video').id
    const clip = engine.addClip({ trackId, type: 'image', name: 'I', src: 'x.png', startFrame: 0, durationFrames: 60, transform: transform() } as never)
    const patch = setKeyframe(engine.findClip(clip.id)!.clip, 'skewX', 0, { stage: LANDSCAPE, content: { width: 640, height: 360 } })
    const track0 = patch.keyframes?.channels?.skewX as { keys: Array<{ value: number }> } | undefined
    expect(track0?.keys[0]?.value).toBe(0)
  })
})
