/**
 * PQ-2a: native keys, trim paths, masks, mattes, blend modes and colour slots.
 */
import { describe, expect, it } from 'vitest'
import type { Clip, Project } from '../../types'
import { instantiate } from '../../composition'
import { readProjectDocument } from '../../editor/projectDocument'
import { sampleChannel, sampleColorChannel } from '../../resolver/keyframes'
import { projectFromClips } from '../importClip'
import { lottieToClip } from './convert'
import { LOTTIE_FIXTURES } from './fixtures'
import type { LottieJson, LottieLayer, LottieTransform } from './types'

function childProject(clip: Clip): Project {
  if (clip.type !== 'compound' || !clip.compound) throw new Error('expected a compound clip')
  return clip.compound.project
}

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

/** Every clip, depth first, in a stable order. */
function flatten(project: Project): Clip[] {
  const out: Clip[] = []
  for (const c of allClips(project)) {
    out.push(c)
    if (c.type === 'compound' && c.compound) out.push(...flatten(c.compound.project))
  }
  return out
}

function fixture(name: string): { json: LottieJson; fps: number } {
  const f = LOTTIE_FIXTURES.find((x) => x.name === name)
  if (!f) throw new Error(`no fixture ${name}`)
  return f
}

function comp(overrides: Partial<LottieJson> & { layers: LottieLayer[] }): LottieJson {
  return { v: '5.7.0', nm: 'test', fr: 30, ip: 0, op: 60, w: 200, h: 200, ...overrides }
}

const KS = { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [100, 100] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } as unknown as LottieTransform
const BOX = [
  { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [40, 40] }, r: { a: 0, k: 0 } },
  { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
]
function boxLayer(extra: Partial<LottieLayer> & { ind: number }): LottieLayer {
  return { ty: 4, nm: 'box', ip: 0, op: 60, st: 0, ks: KS, shapes: BOX, ...extra } as LottieLayer
}

function wrapAngle(a: number): number {
  return ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI
}

// ---------------------------------------------------------------------------
// The differential: native keys, run through the engine's own sampler, equal
// the old per-frame series within 0.5% of the channel range.
// ---------------------------------------------------------------------------

describe('native keys equal the sampled series', () => {
  let nativeChannels = 0

  for (const f of LOTTIE_FIXTURES) {
    it(`fixture ${f.name}`, () => {
      const native = lottieToClip(f.json, { fps: f.fps })
      const sampled = lottieToClip(f.json, { fps: f.fps, sampledOnly: true })
      const a = flatten(childProject(native.clip))
      const b = flatten(childProject(sampled.clip))
      expect(a.length).toBe(b.length)

      for (let i = 0; i < b.length; i++) {
        const nClip = a[i]!
        const sClip = b[i]!
        expect(Object.keys(nClip.keyframes?.channels ?? {}).sort()).toEqual(Object.keys(sClip.keyframes?.channels ?? {}).sort())
        for (const [name, track] of Object.entries(sClip.keyframes?.channels ?? {})) {
          if (!track) continue
          const nTrack = nClip.keyframes!.channels[name as never]!
          if (name === 'shape.path' || name === 'time') continue
          if (nTrack.keys.length !== track.keys.length) nativeChannels++
          for (let frame = 0; frame < sClip.durationFrames; frame++) {
            if (name === 'shape.fill' || name === 'shape.stroke') {
              const want = sampleColorChannel(track.keys, frame)!
              const got = sampleColorChannel(nTrack.keys, frame)!
              for (let c = 0; c < 4; c++) expect(Math.abs(got[c]! - want[c]!), `${f.name} ${name} c${c} @${frame}`).toBeLessThanOrEqual(0.005)
              continue
            }
            const values = track.keys.map((k) => k.value)
            const range = Math.max(...values) - Math.min(...values)
            const want = sampleChannel(track.keys, frame)!
            const got = sampleChannel(nTrack.keys, frame)!
            const diff = name === 'rotation' ? Math.abs(wrapAngle(got - want)) : Math.abs(got - want)
            expect(diff, `${f.name} ${name} @${frame}`).toBeLessThanOrEqual(Math.max(range * 0.005, 1e-9))
          }
        }
      }
    })
  }

  it('most of what the fixtures animate is native, not sampled', () => {
    let native = 0
    let sampled = 0
    for (const f of LOTTIE_FIXTURES) {
      const r = lottieToClip(f.json, { fps: f.fps }).report
      native += r.native
      sampled += r.sampled.length
    }
    expect(native).toBeGreaterThanOrEqual(6)
    expect(native).toBeGreaterThan(sampled)
    expect(nativeChannels).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Key counts, easing, and the sampled fallback named in the report
// ---------------------------------------------------------------------------

describe('native key counts', () => {
  const f = fixture('bezier-pop')
  const { clip, report, skipped } = lottieToClip(f.json, { fps: f.fps })
  const pop = allClips(childProject(clip))[0]!

  it('a 3 s opacity fade has 2 keys, not 90, with its bezier on the arriving key', () => {
    const keys = pop.keyframes!.channels.opacity!.keys
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatchObject({ frame: 0, value: 0 })
    expect(keys[0]!.easingBezier).toBeUndefined()
    expect(keys[1]).toMatchObject({ frame: 90, value: 1, easingBezier: [0.33, 0, 0.67, 1] })
  })

  it('the scale pop is three keys with each segment curve on the key it arrives at', () => {
    const keys = pop.keyframes!.channels.scale!.keys
    expect(keys.map((k) => k.frame)).toEqual([0, 30, 90])
    expect(keys[1]!.easingBezier).toEqual([0.2, 0, 0.4, 1.4])
    expect(keys[2]!.easingBezier).toEqual([0.5, 0, 0.5, 1])
    expect(keys.some((k) => k.hold)).toBe(false)
  })

  it('reports native channels and no sampled ones', () => {
    expect(report.native).toBeGreaterThanOrEqual(2)
    expect(report.sampled).toEqual([])
    expect(skipped).toEqual([])
  })

  it('an h:1 key becomes hold:true on that key', () => {
    const json = comp({
      layers: [boxLayer({ ind: 1, ks: { ...KS, o: { a: 1, k: [{ t: 0, s: [20], h: 1 }, { t: 30, s: [80] }] } } as never })],
    })
    const keys = allClips(childProject(lottieToClip(json, { fps: 30 }).clip))[0]!.keyframes!.channels.opacity!.keys
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatchObject({ value: 0.2, hold: true })
    expect(sampleChannel(keys, 29)).toBeCloseTo(0.2, 10)
    expect(sampleChannel(keys, 30)).toBeCloseTo(0.8, 10)
  })
})

describe('rotation and split position', () => {
  it('a full turn is two keys 2\u03c0 apart, not the 0 \u2192 0 that atan2 would give', () => {
    const json = comp({
      layers: [boxLayer({ ind: 1, ks: { ...KS, r: { a: 1, k: [{ t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 60, s: [360] }] } } as never })],
    })
    const r = lottieToClip(json, { fps: 30 })
    const keys = allClips(childProject(r.clip))[0]!.keyframes!.channels.rotation!.keys
    expect(keys.map((k) => k.frame)).toEqual([0, 60])
    expect(keys[0]!.value).toBeCloseTo(0, 10)
    expect(keys[1]!.value).toBeCloseTo(Math.PI * 2, 10)
    expect(r.report.sampled).toEqual([])
    expect(sampleChannel(keys, 30)).toBeCloseTo(Math.PI, 10)
  })

  it('a split position keyed on one axis is native on that axis only', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: { ...KS, p: { s: true, x: { a: 1, k: [{ t: 0, s: [20], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } }, { t: 30, s: [180] }] }, y: { a: 0, k: 100 } } } as never,
        }),
      ],
    })
    const r = lottieToClip(json, { fps: 30 })
    const channels = allClips(childProject(r.clip))[0]!.keyframes!.channels
    expect(Object.keys(channels)).toEqual(['x'])
    expect(channels.x!.keys).toHaveLength(2)
    expect(channels.x!.keys[1]).toMatchObject({ frame: 30, value: 0.9, easingBezier: [0.3, 0, 0.7, 1] })
    expect(r.report.sampled).toEqual([])
  })
})

describe('sampled fallbacks are named in the report', () => {
  function sampledOf(json: LottieJson): Array<{ layer: string; channel: string; reason: string }> {
    return lottieToClip(json, { fps: 30 }).report.sampled
  }

  it('per-dimension easing', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: { ...KS, p: { a: 1, k: [{ t: 0, s: [0, 0], o: { x: [0.1, 0.9], y: [0, 0] }, i: { x: [0.9, 0.1], y: [1, 1] } }, { t: 30, s: [40, 20] }] } } as never,
        }),
      ],
    })
    const sampled = sampledOf(json)
    expect(sampled.map((s) => s.channel).sort()).toEqual(['x', 'y'])
    expect(sampled[0]!.reason).toBe('per-dimension easing')
    expect(sampled[0]!.layer).toBe('box')
  })

  it('a spatial tangent', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: { ...KS, p: { a: 1, k: [{ t: 0, s: [0, 0], to: [10, 0], ti: [0, -10], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 30, s: [40, 40] }] } } as never,
        }),
      ],
    })
    expect(sampledOf(json).every((s) => s.reason === 'spatial tangent')).toBe(true)
    expect(sampledOf(json).length).toBeGreaterThan(0)
  })

  it('two keys landing on one output frame', () => {
    const json = comp({
      fr: 60,
      op: 60,
      layers: [boxLayer({ ind: 1, op: 60, ks: { ...KS, o: { a: 1, k: [{ t: 0, s: [0] }, { t: 0.5, s: [50] }, { t: 40, s: [100] }] } } as never })],
    })
    expect(sampledOf({ ...json }).map((s) => s.reason)).toEqual(['two keys land on one output frame'])
  })

  it('a key outside the clip', () => {
    const json = comp({
      op: 60,
      layers: [boxLayer({ ind: 1, ks: { ...KS, o: { a: 1, k: [{ t: 0, s: [0] }, { t: 90, s: [100] }] } } as never })],
    })
    expect(sampledOf(json).map((s) => s.reason)).toEqual(['a key falls outside the clip'])
  })

  it('an animated parent', () => {
    const { report } = lottieToClip(fixture('orbit').json, { fps: 25 })
    expect(report.sampled.map((s) => s.channel)).toEqual(expect.arrayContaining(['rotation', 'x', 'y']))
    expect(report.sampled.every((s) => s.reason === 'animated parent')).toBe(true)
  })

  it('two animated transform properties', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: {
            ...KS,
            p: { a: 1, k: [{ t: 0, s: [0, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 30, s: [40, 0] }] },
            s: { a: 1, k: [{ t: 0, s: [100, 100], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 30, s: [200, 200] }] },
          } as never,
        }),
      ],
    })
    expect(sampledOf(json).every((s) => s.reason === 'several animated transform properties')).toBe(true)
    expect(sampledOf(json).length).toBeGreaterThan(0)
  })

  it('the sampled series stays available: a forced sampled import is per-frame', () => {
    const f = fixture('bezier-pop')
    const r = lottieToClip(f.json, { fps: f.fps, sampledOnly: true })
    const keys = allClips(childProject(r.clip))[0]!.keyframes!.channels.opacity!.keys
    expect(keys.length).toBeGreaterThan(60)
    expect(r.report.native).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Trim paths
// ---------------------------------------------------------------------------

describe('trim paths', () => {
  const f = fixture('trim-stroke')
  const { clip, skipped, report } = lottieToClip(f.json, { fps: f.fps })
  const line = allClips(childProject(clip))[0]!

  it('become shapeDraw plus keys on draw (end) and draw.start', () => {
    expect(skipped).toEqual([])
    expect(line.shapeDraw).toEqual({ start: 0, end: 0 })
    const end = line.keyframes!.channels.draw!.keys
    const start = line.keyframes!.channels['draw.start']!.keys
    expect(end.map((k) => [k.frame, k.value])).toEqual([[0, 0], [45, 1]])
    expect(end[1]!.easingBezier).toEqual([0.33, 0, 0.67, 1])
    expect(start.map((k) => [k.frame, k.value])).toEqual([[30, 0], [90, 1]])
    expect(report.sampled).toEqual([])
  })

  it('a static trim writes only shapeDraw', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          shapes: [
            { ty: 'sh', ks: { a: 0, k: { v: [[-20, 0], [20, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], c: false } } },
            { ty: 'st', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 } },
            { ty: 'tm', m: 1, s: { a: 0, k: 25 }, e: { a: 0, k: 75 }, o: { a: 0, k: 0 } },
          ],
        }),
      ],
    })
    const r = lottieToClip(json, { fps: 30 })
    const c = allClips(childProject(r.clip))[0]!
    expect(c.shapeDraw).toEqual({ start: 0.25, end: 0.75 })
    expect(c.keyframes).toBeUndefined()
    expect(r.skipped).toEqual([])
  })

  it('a nonzero offset, individual shapes and a fill-only item stay skipped, with the reason', () => {
    const path = { ty: 'sh', ks: { a: 0, k: { v: [[-20, 0], [20, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], c: false } } }
    const stroke = { ty: 'st', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 } }
    const run = (tm: Record<string, unknown>, styles: unknown[] = [stroke]) =>
      lottieToClip(comp({ layers: [boxLayer({ ind: 1, shapes: [path, ...styles, { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 50 }, ...tm }] as never })] }), { fps: 30 })

    const offset = run({ o: { a: 0, k: 30 } })
    expect(offset.skipped).toEqual([{ feature: 'trim-paths', count: 1 }])
    expect(offset.report.approximations.join(' ')).toMatch(/nonzero offset/)
    expect(allClips(childProject(offset.clip))[0]!.shapeDraw).toBeUndefined()

    const individual = run({ m: 2 })
    expect(individual.report.approximations.join(' ')).toMatch(/individual-shapes/)

    const fillOnly = run({}, [{ ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } }])
    expect(fillOnly.skipped).toEqual([{ feature: 'trim-paths', count: 1 }])
    expect(fillOnly.report.approximations.join(' ')).toMatch(/only a stroked path/)
  })
})

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

describe('masks', () => {
  it('the first static add mask becomes a path ClipMask in the clip\'s draw box, not the comp', () => {
    const f = fixture('masked-bar')
    const { clip, skipped } = lottieToClip(f.json, { fps: f.fps })
    expect(skipped).toEqual([])
    const bar = allClips(childProject(clip))[0]!
    expect(bar.type).toBe('shape')
    expect(bar.mask).toMatchObject({ kind: 'path', x: 0, y: 0, width: 1, height: 1 })
    expect(bar.mask!.invert).toBeUndefined()
    // The clip's draw box is the bar (100 x 40), and the mask's viewBox is that box.
    expect(bar.shapeViewBox).toEqual({ x: -50, y: -20, width: 100, height: 40 })
    expect(bar.mask!.viewBox).toEqual(bar.shapeViewBox)
    expect(bar.mask!.path).toBe('M-30 -30L30 -30L0 30L-30 -30Z')
  })

  it('a layer transform moves the mask with the bar: the mask is mapped into geometry space', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          hasMask: true,
          // A group scaled 2x: geometry space is half the layer space.
          shapes: [{ ty: 'gr', it: [BOX[0], BOX[1], { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [200, 200] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }] as never,
          masksProperties: [{ mode: 'a', inv: true, o: { a: 0, k: 100 }, pt: { a: 0, k: { v: [[-20, -20], [20, -20], [20, 20], [-20, 20]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true } } }],
        }),
      ],
    })
    const c = allClips(childProject(lottieToClip(json, { fps: 30 }).clip))[0]!
    expect(c.mask!.invert).toBe(true)
    expect(c.mask!.path).toBe('M-10 -10L10 -10L10 10L-10 10L-10 -10Z')
  })

  it('extra masks, other modes, mask opacity and an animated path stay skipped by name', () => {
    const pt = { a: 0, k: { v: [[-30, -30], [30, -30], [0, 30]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true } }
    const ptAnimated = {
      a: 1,
      k: [
        { t: 0, s: [pt.k], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 30, s: [pt.k] },
      ],
    }
    const skippedFor = (masks: unknown[]) =>
      lottieToClip(comp({ layers: [boxLayer({ ind: 1, hasMask: true, masksProperties: masks })] }), { fps: 30 }).skipped

    expect(skippedFor([{ mode: 'a', pt }, { mode: 'a', pt }])).toEqual([{ feature: 'mask-extra', count: 1 }])
    expect(skippedFor([{ mode: 's', pt }])).toEqual([{ feature: 'mask-mode', count: 1 }])
    expect(skippedFor([{ mode: 'i', pt }])).toEqual([{ feature: 'mask-mode', count: 1 }])
    expect(skippedFor([{ mode: 'a', pt, o: { a: 0, k: 50 } }])).toEqual([{ feature: 'mask-opacity', count: 1 }])
    expect(skippedFor([{ mode: 'a', pt: ptAnimated }])).toEqual([{ feature: 'mask-path-animation', count: 1 }])
    expect(skippedFor([{}])).toEqual([{ feature: 'mask', count: 1 }])
  })

  it('mask expansion is dropped and flagged', () => {
    const pt = { a: 0, k: { v: [[-30, -30], [30, -30], [0, 30]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true } }
    const r = lottieToClip(comp({ layers: [boxLayer({ ind: 1, hasMask: true, masksProperties: [{ mode: 'a', pt, x: { a: 0, k: 5 } }] })] }), { fps: 30 })
    expect(r.report.approximations).toContain('mask expansion dropped')
    expect(allClips(childProject(r.clip))[0]!.mask).toBeDefined()
  })

  it('a precomp mask sits on the compound clip over its own box', () => {
    const pt = { a: 0, k: { v: [[0, 0], [50, 0], [50, 50]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true } }
    const json = comp({
      layers: [{ ty: 0, ind: 1, nm: 'pc', refId: 'c1', w: 100, h: 80, ip: 0, op: 60, st: 0, ks: KS, hasMask: true, masksProperties: [{ mode: 'a', pt }] } as LottieLayer],
      assets: [{ id: 'c1', layers: [boxLayer({ ind: 1 })] }],
    })
    const c = allClips(childProject(lottieToClip(json, { fps: 30 }).clip))[0]!
    expect(c.type).toBe('compound')
    expect(c.mask!.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })
})

// ---------------------------------------------------------------------------
// Mattes and blend modes
// ---------------------------------------------------------------------------

describe('track mattes', () => {
  it('a td source above its tt target becomes a ClipMatte, and nothing is skipped', () => {
    const f = fixture('matte-reveal')
    const { clip, skipped } = lottieToClip(f.json, { fps: f.fps })
    expect(skipped).toEqual([])
    const clips = allClips(childProject(clip))
    expect(clips.map((c) => c.name).sort()).toEqual(['hole', 'photo'])
    const photo = clips.find((c) => c.name === 'photo')!
    const hole = clips.find((c) => c.name === 'hole')!
    expect(photo.matte).toEqual({ sourceClipId: hole.id, kind: 'alpha' })
    expect(hole.matte).toBeUndefined()
  })

  it('tt 2/3/4 are inverted alpha, luma and inverted luma', () => {
    const f = fixture('matte-reveal')
    const kinds = [2, 3, 4].map((tt) => {
      const json = JSON.parse(JSON.stringify(f.json)) as LottieJson
      json.layers[1]!.tt = tt
      const c = allClips(childProject(lottieToClip(json, { fps: f.fps }).clip)).find((x) => x.name === 'photo')!
      return c.matte
    })
    expect(kinds.map((m) => [m!.kind, m!.invert ?? false])).toEqual([
      ['alpha', true],
      ['luma', false],
      ['luma', true],
    ])
  })

  it('tp names the source layer', () => {
    const json = comp({
      layers: [
        boxLayer({ ind: 5, nm: 'other' }),
        boxLayer({ ind: 7, nm: 'src', td: 1 }),
        boxLayer({ ind: 9, nm: 'target', tt: 1, tp: 7 }),
      ],
    })
    const clips = allClips(childProject(lottieToClip(json, { fps: 30 }).clip))
    const src = clips.find((c) => c.name === 'src')!
    expect(clips.find((c) => c.name === 'target')!.matte!.sourceClipId).toBe(src.id)
  })

  it('a source that draws several clips cannot be one matte: both layers are skipped as before', () => {
    const two = [BOX[0], BOX[1], { ty: 'rc', p: { a: 0, k: [50, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 }, r: 1 }]
    const json = comp({ layers: [boxLayer({ ind: 1, td: 1, shapes: two as never }), boxLayer({ ind: 2, tt: 1 })] })
    const r = lottieToClip(json, { fps: 30 })
    expect(r.skipped).toEqual([{ feature: 'track-matte', count: 2 }])
    const clips = allClips(childProject(r.clip))
    expect(clips).toHaveLength(1)
    expect(clips[0]!.matte).toBeUndefined()
  })
})

describe('blend modes', () => {
  const blendOf = (bm: number) => {
    const r = lottieToClip(comp({ layers: [{ ty: 1, ind: 1, bm, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 }] }), { fps: 30 })
    return { blend: allClips(childProject(r.clip))[0]!.blend, report: r.report, skipped: r.skipped }
  }

  it('16 is add, exactly', () => {
    const r = blendOf(16)
    expect(r.blend).toBe('add')
    expect(r.report.approximations).toEqual([])
  })

  it('6, 7, 8 and 11 map to the nearest mode and are recorded', () => {
    expect(blendOf(6).blend).toBe('add')
    expect(blendOf(7).blend).toBe('multiply')
    expect(blendOf(8).blend).toBe('overlay')
    expect(blendOf(11).blend).toBe('difference')
    expect(blendOf(7).report.approximations[0]).toMatch(/blend-mode:7.*multiply/)
    expect(blendOf(7).skipped).toEqual([])
  })

  it('12-15 and 17 stay skipped', () => {
    for (const bm of [12, 13, 14, 15, 17]) {
      const r = blendOf(bm)
      expect(r.blend, String(bm)).toBeUndefined()
      expect(r.skipped).toEqual([{ feature: `blend-mode:${bm}`, count: 1 }])
    }
  })
})

// ---------------------------------------------------------------------------
// Colour slots and parts
// ---------------------------------------------------------------------------

describe('colour slots', () => {
  const f = fixture('slot-fill')

  it('a $name item and a same-coloured item become one colour prop with two bindings', () => {
    const { clip, report } = lottieToClip(f.json, { fps: f.fps, slots: { accent: '#FF3D7F' } })
    const child = childProject(clip)
    expect(child.composition!.props).toMatchObject([{ name: 'accent', type: 'color', default: '#ff3d7f' }])
    expect(child.composition!.bindings).toHaveLength(2)
    expect(child.composition!.bindings.every((b) => b.prop === 'accent' && b.path === 'shapeFill')).toBe(true)
    expect(report.slots).toEqual([{ name: 'accent', value: '#ff3d7f', count: 2 }])
  })

  it('without options only the named item is a slot', () => {
    const { clip, report } = lottieToClip(f.json, { fps: f.fps })
    expect(childProject(clip).composition!.bindings).toHaveLength(1)
    expect(report.slots).toEqual([{ name: 'accent', value: '#ff3d7f', count: 1 }])
  })

  it('a keyed colour cannot rebind and is reported', () => {
    const { clip, report } = lottieToClip(f.json, { fps: f.fps })
    expect(report.approximations.join(' ')).toMatch(/\$pulse.*keyed/)
    expect(childProject(clip).composition!.props.map((p) => p.name)).toEqual(['accent'])
  })

  it('instantiate with a new colour changes the bound fills and nothing else', () => {
    const { clip } = lottieToClip(f.json, { fps: f.fps, slots: { accent: '#ff3d7f' } })
    const child = childProject(clip)
    const out = instantiate(child, { accent: '#00ff88' }, { seed: 1 })
    expect(out.issues).toEqual([])
    const fills = Object.fromEntries(allClips(out.project).map((c) => [c.name, c.shapeFill]))
    expect(fills.badge).toBe('#00ff88')
    expect(fills.dot).toBe('#00ff88')
    expect(fills.ring).not.toBe('#00ff88')
    // The input is untouched.
    expect(allClips(child).find((c) => c.name === 'badge')!.shapeFill).toBe('#ff3d7f')
  })

  it('a translucent named fill is reported, not bound', () => {
    const json = comp({
      layers: [boxLayer({ ind: 1, shapes: [BOX[0], { ty: 'fl', nm: '$glass', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 50 }, r: 1 }] as never })],
    })
    const r = lottieToClip(json, { fps: 30 })
    expect(r.report.slots).toEqual([])
    expect(r.report.approximations.join(' ')).toMatch(/translucent/)
    expect(childProject(r.clip).composition).toBeUndefined()
  })

  it('a slot inside a precomp binds through a clip path', () => {
    const json = comp({
      layers: [{ ty: 0, ind: 1, nm: 'pc', refId: 'c1', w: 100, h: 100, ip: 0, op: 60, st: 0, ks: KS } as LottieLayer],
      assets: [{ id: 'c1', layers: [boxLayer({ ind: 1, shapes: [BOX[0], { ty: 'fl', nm: '$accent', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 }] as never })] }],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const child = childProject(clip)
    expect(child.composition!.bindings).toHaveLength(1)
    expect(child.composition!.bindings[0]!.clipId).toContain('/')
    const out = instantiate(child, { accent: '#123456' }, { seed: 1 })
    expect(out.issues).toEqual([])
    const inner = flatten(out.project).find((c) => c.type === 'shape')!
    expect(inner.shapeFill).toBe('#123456')
  })

  it('the composition survives a save and reload of the project document', () => {
    const { clip } = lottieToClip(f.json, { fps: f.fps, slots: { accent: '#ff3d7f' } })
    const root = projectFromClips([clip], { fps: 30, stage: { width: 1920, height: 1080 } })
    const reloaded = readProjectDocument(JSON.parse(JSON.stringify(root)))
    const back = Object.values(reloaded.clips).flat()[0]!
    expect(back.compound!.project.composition).toEqual(childProject(clip).composition)
  })
})

describe('parts', () => {
  it('are named from the layer nm', () => {
    const { report } = lottieToClip(fixture('slot-fill').json, { fps: 30 })
    expect(report.parts.map((p) => p.name).sort()).toEqual(['badge', 'dot', 'ring'])
  })

  it('a part inside a precomp carries a path through the compound', () => {
    const { report } = lottieToClip(fixture('orbit').json, { fps: 25 })
    const nested = report.parts.filter((p) => p.id.includes('/'))
    expect(nested.map((p) => p.name)).toEqual(['dot'])
  })
})
