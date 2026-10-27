import { describe, expect, it } from 'vitest'
import type { Clip, Project } from '../../types'
import { resolveShapeRect } from '../../renderer/gpu/layers/shapePaint'
import { paintColorAt } from '../__tests__/paintSample'
import { lottieToClip } from './convert'
import { LOTTIE_FIXTURES } from './fixtures'
import type { LottieJson, LottieLayer } from './types'

function comp(overrides: Partial<LottieJson> & { layers: LottieLayer[] }): LottieJson {
  return { v: '5.7.0', nm: 'test', fr: 30, ip: 0, op: 60, w: 200, h: 200, ...overrides }
}

function childProject(clip: Clip): Project {
  if (clip.type !== 'compound' || !clip.compound) throw new Error('expected a compound clip')
  return clip.compound.project
}

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

/** All shape clips reachable from `project`, paired with the stage they're drawn into. */
function collectShapeClips(project: Project): Array<{ clip: Clip; stage: { width: number; height: number } }> {
  const out: Array<{ clip: Clip; stage: { width: number; height: number } }> = []
  for (const clip of allClips(project)) {
    if (clip.type === 'shape') out.push({ clip, stage: project.stage })
    else if (clip.type === 'compound' && clip.compound) out.push(...collectShapeClips(clip.compound.project))
  }
  return out
}

// ---------------------------------------------------------------------------
// Step 1: validation and skeleton
// ---------------------------------------------------------------------------

describe('lottieToClip — validation', () => {
  it.each([
    ['{}', {}],
    ['fr: 0', { fr: 0, ip: 0, op: 1, w: 10, h: 10, layers: [] }],
    ["layers: 'x'", { fr: 30, ip: 0, op: 1, w: 10, h: 10, layers: 'x' }],
    ['op <= ip', { fr: 30, ip: 10, op: 10, w: 10, h: 10, layers: [] }],
  ])('%s throws "Not a Lottie animation"', (_name, json) => {
    expect(() => lottieToClip(json, { fps: 30 })).toThrow('Not a Lottie animation')
  })
})

describe('lottieToClip — solids', () => {
  it('one solid, no sw/sh, in a 200×100 comp → one shape clip', () => {
    const json = comp({
      w: 200,
      h: 100,
      op: 60,
      layers: [{ ty: 1, ind: 1, nm: 'bg', sc: '#123456', ip: 0, op: 60, st: 0 }],
    })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    const clips = allClips(childProject(clip))
    expect(clips).toHaveLength(1)
    expect(clips[0]!.type).toBe('shape')
    if (clips[0]!.type === 'shape') {
      expect(clips[0]!.shapePath).toBe('M0 0L200 0L200 100L0 100Z')
      expect(clips[0]!.shapeFill).toBe('#123456')
    }
    expect(skipped).toEqual([])
  })
})

describe('lottieToClip — layer checks', () => {
  it('hd: true produces no clip', () => {
    const json = comp({
      layers: [{ ty: 4, ind: 1, hd: true, ip: 0, op: 60, st: 0, shapes: [{ ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } }, { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] } }] }],
    })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    expect(allClips(childProject(clip))).toHaveLength(0)
    expect(skipped).toEqual([])
  })

  it('a text layer (ty 5) is skipped once', () => {
    const json = comp({ layers: [{ ty: 5, ind: 1, ip: 0, op: 60, st: 0 }] })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    expect(allClips(childProject(clip))).toHaveLength(0)
    expect(skipped).toEqual([{ feature: 'text-layer', count: 1 }])
  })

  it('a td/tt track-matte pair keeps both clips and wires the target to the source', () => {
    const json = comp({
      layers: [
        { ty: 1, ind: 1, td: 1, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 },
        { ty: 1, ind: 2, tt: 1, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 },
      ],
    })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    const clips = allClips(childProject(clip))
    expect(clips).toHaveLength(2)
    const target = clips.find((c) => c.matte)!
    const source = clips.find((c) => !c.matte)!
    expect(target.matte).toEqual({ sourceClipId: source.id, kind: 'alpha' })
    expect(skipped).toEqual([])
  })

  it('bm 1 becomes blend "multiply"; bm 12 is reported and unblended', () => {
    const multiplyJson = comp({ layers: [{ ty: 1, ind: 1, bm: 1, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 }] })
    const multiply = lottieToClip(multiplyJson, { fps: 30 })
    const multiplyClip = allClips(childProject(multiply.clip))[0]!
    expect(multiplyClip.blend).toBe('multiply')

    const unknownJson = comp({ layers: [{ ty: 1, ind: 1, bm: 12, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 }] })
    const unknown = lottieToClip(unknownJson, { fps: 30 })
    expect(unknown.skipped).toEqual([{ feature: 'blend-mode:12', count: 1 }])
    expect(allClips(childProject(unknown.clip))[0]!.blend).toBeUndefined()
  })

  it('a missing parent index is reported once and conversion continues', () => {
    const json = comp({
      layers: [
        {
          ty: 4,
          ind: 1,
          parent: 99,
          ip: 0,
          op: 60,
          st: 0,
          shapes: [{ ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } }, { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] } }],
        },
      ],
    })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    expect(allClips(childProject(clip))).toHaveLength(1)
    expect(skipped).toEqual([{ feature: 'parent-missing', count: 1 }])
  })

  it('clip timing: layer ip 10 op 40 in a comp with op 30 at fr 30, fps 60 → startFrame 20, durationFrames 40', () => {
    const json = comp({ fr: 30, op: 30, layers: [{ ty: 1, ind: 1, sc: '#ffffff', sw: 10, sh: 10, ip: 10, op: 40, st: 0 }] })
    const { clip } = lottieToClip(json, { fps: 60 })
    const solid = allClips(childProject(clip))[0]!
    expect(solid.startFrame).toBe(20)
    expect(solid.durationFrames).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// Step 2/3: shape layers, similarity vs baked pose
// ---------------------------------------------------------------------------

describe('lottieToClip — the slide fixture', () => {
  const fixture = LOTTIE_FIXTURES.find((f) => f.name === 'slide')!

  it('at fps 30: one track, one shape clip, at its first-frame pose', () => {
    const { clip, skipped, shapeCount } = lottieToClip(fixture.json, { fps: fixture.fps })
    if (clip.type !== 'compound' || !clip.compound) throw new Error('expected compound')
    expect(clip.durationFrames).toBe(60)
    expect(clip.sourceStartFrame).toBe(0)
    const project = clip.compound.project
    expect(project.stage).toEqual({ width: 200, height: 200 })
    expect(project.tracks).toHaveLength(1)

    const shape = allClips(project)[0]!
    expect(shape.type).toBe('shape')
    if (shape.type !== 'shape') return
    expect(shape.shapePath).toBe('M-20 -20L20 -20L20 20L-20 20Z')
    expect(shape.shapeViewBox).toEqual({ x: -20, y: -20, width: 40, height: 40 })
    expect(shape.transform).toMatchObject({ x: 0.25, y: 0.5, scale: 0.2, scaleX: 1, scaleY: 1, rotation: 0 })
    expect(shape.shapeFill).toBe('#ff0000')
    expect(shape.shapeStrokeWidth).toBe(0)

    // PV-P6c-3: the animated position becomes real per-frame keyframes on
    // 'x' (y/scale/rotation are unanimated, so they stay on the base
    // transform only — no keys for them).
    expect(skipped).toEqual([])
    expect(shapeCount).toBe(1)

    const xTrack = shape.keyframes?.channels.x
    expect(xTrack).toBeDefined()
    expect(shape.keyframes?.channels.y).toBeUndefined()
    expect(shape.keyframes?.channels.scale).toBeUndefined()
    expect(shape.keyframes?.channels.rotation).toBeUndefined()
    const xKeys = xTrack!.keys
    // PQ-2a: two native keys, the fixture's cubic-bezier carried on the arriving key.
    expect(xKeys.length).toBe(2)
    expect(xKeys[0]).toMatchObject({ frame: 0, value: 0.25 })
    expect(xKeys[1]).toMatchObject({ frame: 30, value: 0.75, easingBezier: [0.33, 0, 0.67, 1] })
    expect(xKeys[0]!.hold).toBeUndefined()
  })

  it('at fps 60 the compound is 120 frames', () => {
    const { clip } = lottieToClip(fixture.json, { fps: 60 })
    if (clip.type !== 'compound' || !clip.compound) throw new Error('expected compound')
    expect(clip.durationFrames).toBe(120)
  })
})

describe('lottieToClip — non-similarity pose', () => {
  it('a non-uniform layer scale bakes geometry into comp space', () => {
    const json = comp({
      w: 200,
      h: 200,
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 0, k: [100, 100] },
            s: { a: 0, k: [200, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } },
            { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    expect(shape.type).toBe('shape')
    if (shape.type !== 'shape') return
    expect(shape.shapeViewBox).toEqual({ x: 90, y: 95, width: 20, height: 10 })
    expect(shape.transform).toMatchObject({ x: 0.5, y: 0.5, scale: 0.1, scaleX: 1, scaleY: 0.5, rotation: 0 })
  })

  it('the same pose with a stroke scales its width by the matrix uniform scale and reports non-uniform-stroke', () => {
    const json = comp({
      w: 200,
      h: 200,
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 0, k: [100, 100] },
            s: { a: 0, k: [200, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } },
            { ty: 'st', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 2 } },
            { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    expect(shape.type).toBe('shape')
    if (shape.type !== 'shape') return
    expect(shape.shapeStrokeWidth).toBeCloseTo(2 * Math.SQRT2, 6)
    expect(skipped.find((s) => s.feature === 'non-uniform-stroke')?.count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Step 4: gradients
// ---------------------------------------------------------------------------

describe('lottieToClip — gradients', () => {
  function gradientJson(t: 1 | 2, extra: Record<string, unknown> = {}): LottieJson {
    return comp({
      w: 100,
      h: 100,
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          shapes: [
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 } },
            {
              ty: 'gf',
              t,
              s: { a: 0, k: [-50, 0] },
              e: { a: 0, k: [50, 0] },
              g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
              o: { a: 0, k: 100 },
              ...extra,
            },
          ],
        },
      ],
    })
  }

  it('a linear gradient produces a linear Paint red at 0, blue at 1', () => {
    const { clip } = lottieToClip(gradientJson(1), { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    expect(shape.type).toBe('shape')
    if (shape.type !== 'shape') return
    expect(shape.shapeFillPaint?.type).toBe('linear')
    expect(shape.shapeFill).toBe('#ff0000')

    const box = shape.shapeViewBox!
    const left = paintColorAt(shape.shapeFillPaint!, box, box.x, box.y + box.height / 2)
    const right = paintColorAt(shape.shapeFillPaint!, box, box.x + box.width, box.y + box.height / 2)
    expect(left.r).toBeGreaterThanOrEqual(254)
    expect(left.b).toBeLessThanOrEqual(1)
    expect(right.b).toBeGreaterThanOrEqual(254)
    expect(right.r).toBeLessThanOrEqual(1)
  })

  it('a radial gradient with a non-zero highlight reports radial-gradient-focal', () => {
    const { skipped } = lottieToClip(gradientJson(2, { h: { a: 0, k: 20 } }), { fps: 30 })
    expect(skipped.some((s) => s.feature === 'radial-gradient-focal')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Step 5: precomps
// ---------------------------------------------------------------------------

describe('lottieToClip — the orbit fixture', () => {
  const fixture = LOTTIE_FIXTURES.find((f) => f.name === 'orbit')!

  it('assembles two tracks (solid, then the precomp compound) with the dot merged and placed', () => {
    const { clip, skipped } = lottieToClip(fixture.json, { fps: fixture.fps })
    if (clip.type !== 'compound' || !clip.compound) throw new Error('expected compound')
    const project = clip.compound.project
    expect(project.tracks).toHaveLength(2)

    const byOrder = [...project.tracks].sort((a, b) => a.order - b.order)
    const bgClip = project.clips[byOrder[0]!.id]![0]!
    const orbitClip = project.clips[byOrder[1]!.id]![0]!

    expect(bgClip.type).toBe('shape')
    if (bgClip.type === 'shape') {
      expect(bgClip.shapePath).toBe('M0 0L100 0L100 100L0 100Z')
      expect(bgClip.shapeFill).toBe('#202020')
      expect(bgClip.transform).toMatchObject({ x: 0.5, y: 0.5, scale: 1, scaleX: 1, scaleY: 1 })
    }

    expect(orbitClip.type).toBe('compound')
    if (orbitClip.type === 'compound') {
      expect(orbitClip.transform).toMatchObject({ x: 0.5, y: 0.5, scale: 0.5, rotation: 0 })
      expect(orbitClip.opacity).toBeCloseTo(0.8, 6)
      expect(orbitClip.startFrame).toBe(0)
      expect(orbitClip.durationFrames).toBe(50)
      expect(orbitClip.sourceStartFrame).toBe(0)

      const inner = allClips(orbitClip.compound!.project)
      expect(inner).toHaveLength(1)
      const dot = inner[0]!
      expect(dot.type).toBe('shape')
      if (dot.type === 'shape') {
        expect(dot.shapeFill).toBe('rgba(0, 128, 255, 0.5)')
        expect(dot.shapeStroke).toBe('#ffffff')
        expect(dot.shapeStrokeWidth).toBe(2)
        expect(dot.shapeStrokeCap).toBe('round')
        expect(dot.shapeStrokeJoin).toBe('round')
        expect(dot.transform).toMatchObject({ x: 0.8, y: 0.5, scale: 0.1 })

        // PV-P6c-3: the pivot's animated rotation (an ancestor of 'dot')
        // becomes real per-frame x/y/scale/rotation keys on the dot, whose
        // first sample reproduces the first-frame pose exactly.
        const ch = dot.keyframes?.channels
        expect(ch?.x).toBeDefined()
        expect(ch?.y).toBeDefined()
        expect(ch?.rotation).toBeDefined()
        expect(ch!.x!.keys[0]).toMatchObject({ frame: 0, value: 0.8 })
        expect(ch!.y!.keys[0]).toMatchObject({ frame: 0, value: 0.5 })
        expect(ch!.rotation!.keys[0]).toMatchObject({ frame: 0, value: 0 })
        // Halfway through the 50-frame rotation (0 -> 360deg, linear), the
        // pivot has turned exactly pi radians.
        const half = ch!.rotation!.keys.find((k) => k.frame === 25)
        expect(half?.value).toBeCloseTo(Math.PI, 10)
      }
    }

    expect(skipped).toEqual([
      { feature: 'effect', count: 1 },
      { feature: 'mask', count: 1 },
      { feature: 'text-layer', count: 1 },
    ])
  })

  it('caps precomp nesting at depth 4 and reports a missing asset', () => {
    const c4Solid: LottieLayer = { ty: 1, ind: 1, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 }
    const c3Precomp: LottieLayer = { ty: 0, ind: 1, refId: 'c4', w: 100, h: 100, ip: 0, op: 60, st: 0 }
    const c2Precomp: LottieLayer = { ty: 0, ind: 1, refId: 'c3', w: 100, h: 100, ip: 0, op: 60, st: 0 }
    const c1Precomp: LottieLayer = { ty: 0, ind: 1, refId: 'c2', w: 100, h: 100, ip: 0, op: 60, st: 0 }
    const rootPrecomp: LottieLayer = { ty: 0, ind: 1, refId: 'c1', w: 100, h: 100, ip: 0, op: 60, st: 0 }

    const json = comp({
      w: 100,
      h: 100,
      layers: [rootPrecomp],
      assets: [
        { id: 'c1', layers: [c1Precomp] },
        { id: 'c2', layers: [c2Precomp] },
        { id: 'c3', layers: [c3Precomp] },
        { id: 'c4', layers: [c4Solid] },
      ],
    })
    const { skipped } = lottieToClip(json, { fps: 30 })
    expect(skipped).toEqual([{ feature: 'precomp-depth', count: 1 }])
  })

  it('a refId with no matching asset is reported', () => {
    const json = comp({
      w: 100,
      h: 100,
      layers: [{ ty: 0, ind: 1, refId: 'missing', w: 100, h: 100, ip: 0, op: 60, st: 0 }],
    })
    const { skipped } = lottieToClip(json, { fps: 30 })
    expect(skipped).toEqual([{ feature: 'precomp-missing', count: 1 }])
  })
})

// ---------------------------------------------------------------------------
// Step 6: budget and invariant
// ---------------------------------------------------------------------------

describe('lottieToClip — texture budget', () => {
  it('a budget of exactly one shape allows one and reports element-limit for the second', () => {
    const shapeLayer = (ind: number): LottieLayer => ({
      ty: 4,
      ind,
      ip: 0,
      op: 60,
      st: 0,
      shapes: [
        { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } },
        { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
      ],
    })
    const json = comp({ w: 200, h: 200, layers: [shapeLayer(1), shapeLayer(2)] })
    const { clip, skipped, shapeCount } = lottieToClip(json, { fps: 30, textureBudgetBytes: 200 * 200 * 4 })
    expect(allClips(childProject(clip))).toHaveLength(1)
    expect(skipped).toEqual([{ feature: 'element-limit', count: 1 }])
    expect(shapeCount).toBe(2)
  })
})

describe('lottieToClip — shape rect / viewBox aspect invariant', () => {
  it('holds for every shape clip in both fixtures', () => {
    for (const fixture of LOTTIE_FIXTURES) {
      const { clip } = lottieToClip(fixture.json, { fps: fixture.fps })
      const project = childProject(clip)
      for (const { clip: shape, stage } of collectShapeClips(project)) {
        if (shape.type !== 'shape' || !shape.shapeViewBox) continue
        const rect = resolveShapeRect(shape.transform, stage)
        const rectAspect = rect.width / rect.height
        const vbAspect = shape.shapeViewBox.width / shape.shapeViewBox.height
        expect(rectAspect).toBeCloseTo(vbAspect, 6)
      }
    }
  })
})
