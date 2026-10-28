import { describe, expect, it, vi } from 'vitest'
import {
  GENERATOR_REGISTRY,
  clampGeneratorParams,
  createGenerator,
  keyframeableGeneratorParams,
} from './registry'
import {
  counterValue,
  formatCounter,
  generatorPaintSignature,
  paintGenerator,
  parseChartValues,
  rand,
} from '../renderer/gpu/layers/generatorPaint'
import { estimatePathLength } from '../renderer/gpu/layers/pathLength'
import { applyDrawOn, clearDrawOn } from '../elements/drawOn'
import { TimelineEngine } from '../editor/TimelineEngine'
import { resolveTimeline } from '../resolver/resolveTimeline'
import { setKeyframe } from '../elements/keyframes'
import { PROJECT_VERSION, documentVersionFor, readProjectDocument } from '../editor/projectDocument'
import { paintShape, shapePaintSignature } from '../renderer/gpu/layers/shapePaint'
import type { ActiveGeneratorClip, ActiveShapeClip } from '../resolver/scene'

/** A 2D context that records calls, enough for the painters. */
function recorder() {
  const calls: string[] = []
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: () => undefined })
      }
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : typeof a === 'object' ? 'o' : String(a))).join(',')})`)
      }
    },
    set(target, prop: string, value) {
      target[prop] = value
      calls.push(`${prop}=${typeof value === 'number' ? value.toFixed(3) : String(value)}`)
      return true
    },
  }
  return { ctx: new Proxy({ globalAlpha: 1 } as Record<string, unknown>, handler) as unknown as CanvasRenderingContext2D, calls }
}

function gen(kind: string, extra: Partial<ActiveGeneratorClip> = {}): ActiveGeneratorClip {
  return {
    type: 'generator',
    id: 'g',
    trackId: 't',
    name: 'g',
    kind,
    params: clampGeneratorParams(kind, {})!,
    seed: 1,
    localFrame: 10,
    durationFrames: 90,
    fps: 30,
    sourceFrame: 0,
    opacity: 1,
    zIndex: 1000,
    ...extra,
  }
}

const STAGE = { width: 1280, height: 720 }

describe('generator registry', () => {
  it('every default is inside its own range', () => {
    for (const def of GENERATOR_REGISTRY.values()) {
      for (const [name, pd] of Object.entries(def.params)) {
        if (pd.type === 'number') {
          expect(pd.default as number, `${def.kind}.${name}`).toBeGreaterThanOrEqual(pd.min!)
          expect(pd.default as number, `${def.kind}.${name}`).toBeLessThanOrEqual(pd.max!)
        }
      }
    }
  })

  it('clamps params, keeps text, and rejects unknown kinds', () => {
    const p = clampGeneratorParams('counter', { to: 5e12, prefix: 'x'.repeat(100), bogus: 1 })!
    expect(p.to).toBe(1e9)
    expect((p.prefix as string).length).toBe(40)
    expect('bogus' in p).toBe(false)
    expect(clampGeneratorParams('nope', {})).toBeNull()
    expect(() => createGenerator('nope')).toThrow()
    expect(createGenerator('particles', { style: 'snow' }, 7)).toMatchObject({ kind: 'particles', seed: 7, params: { style: 'snow' } })
    expect(keyframeableGeneratorParams('particles')).toEqual(['size', 'speed'])
  })
})

describe('generator painter', () => {
  it('is deterministic: the same frame paints the same calls', () => {
    for (const kind of GENERATOR_REGISTRY.keys()) {
      const a = recorder()
      const b = recorder()
      paintGenerator(a.ctx, gen(kind), STAGE)
      paintGenerator(b.ctx, gen(kind), STAGE)
      expect(a.calls.length, kind).toBeGreaterThan(0)
      expect(a.calls, kind).toEqual(b.calls)
    }
  })

  it('particles move with time and differ by seed', () => {
    const at = (localFrame: number, seed = 1) => {
      const r = recorder()
      paintGenerator(r.ctx, gen('particles', { localFrame, seed }), STAGE)
      return r.calls.join(';')
    }
    expect(at(10)).not.toBe(at(11))
    expect(at(10)).not.toBe(at(10, 2))
  })

  it('rand is uniform-ish and stable', () => {
    expect(rand(1, 2, 3)).toBe(rand(1, 2, 3))
    let sum = 0
    for (let i = 0; i < 2000; i++) sum += rand(9, i, 0)
    expect(sum / 2000).toBeGreaterThan(0.45)
    expect(sum / 2000).toBeLessThan(0.55)
  })

  it('counter counts with ease-out and formats', () => {
    const p = clampGeneratorParams('counter', { from: 0, to: 1000, countFraction: 0.5 })!
    expect(counterValue(p, 0, 61)).toBe(0)
    expect(counterValue(p, 30, 61)).toBeCloseTo(1000)
    expect(counterValue(p, 45, 61)).toBeCloseTo(1000)
    expect(counterValue(p, 10, 61)).toBeGreaterThan(1000 * (10 / 30))
    expect(formatCounter(1234567.891, 2, true)).toBe('1,234,567.89')
    expect(formatCounter(-1500, 0, false)).toBe('-1500')
    expect(parseChartValues('40, 65;52 x 90')).toEqual([40, 65, 52, 90])
  })

  it('a still gradient paints once; everything else per frame', () => {
    const g1 = generatorPaintSignature(gen('gradientBackground', { localFrame: 1 }), STAGE)
    const g2 = generatorPaintSignature(gen('gradientBackground', { localFrame: 2 }), STAGE)
    expect(g1).toBe(g2)
    expect(generatorPaintSignature(gen('particles', { localFrame: 1 }), STAGE)).not.toBe(
      generatorPaintSignature(gen('particles', { localFrame: 2 }), STAGE),
    )
  })
})

describe('generator clips in the document', () => {
  it('resolve with keyed params, and stamp version 3 in the same undo step', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const el = engine.addTrack('elements').id
    expect(engine.getProject().version).toBe(1)
    const c = engine.addClip({ trackId: el, type: 'generator', name: 'Confetti', startFrame: 0, durationFrames: 60, generator: createGenerator('particles') })
    expect(engine.getProject().version).toBe(3)
    const clip = engine.findClip(c.id)!.clip
    engine.updateClip(c.id, el, setKeyframe(clip, 'gen.speed', 0, { stage: { width: 1, height: 1 } }, 0))
    const c2 = engine.findClip(c.id)!.clip
    engine.updateClip(c.id, el, setKeyframe(c2, 'gen.speed', 30, { stage: { width: 1, height: 1 } }, 2))
    const scene = resolveTimeline(15, engine.getProject())
    expect(scene.generators).toHaveLength(1)
    expect(scene.generators![0]!.params.speed).toBeCloseTo(1)
    expect(scene.generators![0]!.localFrame).toBe(15)
    engine.undo()
    engine.undo()
    engine.undo()
    expect(engine.getProject().version).toBe(1)
  })

  it('an unknown generator kind draws nothing; documents round-trip', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const el = engine.addTrack('elements').id
    engine.addClip({ trackId: el, type: 'generator', name: 'x', startFrame: 0, durationFrames: 30, generator: { kind: 'from-the-future', params: {} } })
    expect(resolveTimeline(1, engine.getProject()).generators).toBeUndefined()
    const doc = JSON.parse(JSON.stringify(engine.getProject()))
    expect(readProjectDocument(doc).clips[el]![0]!.generator!.kind).toBe('from-the-future')
    expect(PROJECT_VERSION).toBe(5)
  })

  it('new transition kinds and draw-on also need version 3', () => {
    expect(documentVersionFor({ clips: {}, transitions: [{ kind: 'fade' } as never] })).toBe(1)
    expect(documentVersionFor({ clips: {}, transitions: [{ kind: 'zoom' } as never] })).toBe(3)
    expect(documentVersionFor({ clips: { t: [{ type: 'shape', shapeDraw: { start: 0, end: 1 } } as never] } })).toBe(3)
  })
})

describe('shape draw-on', () => {
  const shape = (extra: Partial<ActiveShapeClip> = {}): ActiveShapeClip => ({
    type: 'shape',
    id: 's',
    trackId: 't',
    name: 's',
    shapeKind: 'rect',
    shapeFill: '#ff0000',
    shapeStroke: '#ffffff',
    shapeStrokeWidth: 4,
    sourceFrame: 0,
    opacity: 1,
    zIndex: 1,
    ...extra,
  })

  it('a full draw window paints exactly like no draw-on', () => {
    const a = recorder()
    const b = recorder()
    paintShape(a.ctx, shape(), STAGE)
    paintShape(b.ctx, shape({ shapeDraw: { start: 0, end: 1 } }), STAGE)
    expect(b.calls).toEqual(a.calls)
  })

  it('half drawn: dashed stroke, no fill yet; signature changes', () => {
    const r = recorder()
    paintShape(r.ctx, shape({ shapeDraw: { start: 0, end: 0.5 } }), STAGE)
    expect(r.calls.some((c) => c.startsWith('setLineDash'))).toBe(true)
    expect(r.calls.filter((c) => c.startsWith('fill(')).length).toBe(0)
    expect(shapePaintSignature(shape({ shapeDraw: { start: 0, end: 0.5 } }), STAGE)).not.toBe(shapePaintSignature(shape(), STAGE))
  })

  it('draw-on keys resolve into the scene; clear removes them', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const el = engine.addTrack('elements').id
    const c = engine.addClip({ trackId: el, type: 'shape', name: 's', startFrame: 0, durationFrames: 60, shape: { shapeKind: 'circle' } } as never)
    const clip = engine.findClip(c.id)!.clip
    engine.updateClip(c.id, el, applyDrawOn(clip, 'draw-on', 20))
    expect(resolveTimeline(0, engine.getProject()).shapes[0]!.shapeDraw).toEqual({ start: 0, end: 0 })
    expect(resolveTimeline(20, engine.getProject()).shapes[0]!.shapeDraw).toEqual({ start: 0, end: 1 })
    const mid = resolveTimeline(10, engine.getProject()).shapes[0]!.shapeDraw!.end
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    const cleared = { ...engine.findClip(c.id)!.clip, ...clearDrawOn(engine.findClip(c.id)!.clip) }
    expect(cleared.shapeDraw).toBeUndefined()
    expect(cleared.keyframes).toBeUndefined()
    expect(applyDrawOn({ ...clip, type: 'text' } as never, 'draw-on')).toEqual({})
  })

  it('estimates path lengths', () => {
    expect(estimatePathLength('M0 0 L100 0 L100 100 Z')).toBeCloseTo(100 + 100 + Math.SQRT2 * 100)
    expect(estimatePathLength('M0 0 h10 v10 h-10 z')).toBeCloseTo(40)
    // A quarter circle as a cubic ≈ π/2 × r.
    expect(estimatePathLength('M100 0 C100 55.23 55.23 100 0 100')).toBeCloseTo((Math.PI / 2) * 100, 0)
    expect(estimatePathLength('garbage')).toBe(0)
    expect(estimatePathLength('')).toBe(0)
  })
})

vi.stubGlobal('Path2D', undefined)
