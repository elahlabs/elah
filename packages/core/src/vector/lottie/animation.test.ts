import { describe, expect, it } from 'vitest'
import type { Clip, Project } from '../../types'
import { sampleChannel, sampleColorChannel } from '../../resolver/keyframes'
import { lottieToClip } from './convert'
import { MAX_ANIMATION_DURATION_FRAMES, MAX_ANIMATION_KEYS } from './animation'
import type { LottieJson, LottieLayer } from './types'

function comp(overrides: Partial<LottieJson> & { layers: LottieLayer[] }): LottieJson {
  return { v: '5.7.0', nm: 'test', fr: 30, ip: 0, op: 60, w: 100, h: 100, ...overrides }
}

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

function childProject(clip: Clip): Project {
  if (clip.type !== 'compound' || !clip.compound) throw new Error('expected a compound clip')
  return clip.compound.project
}

/** A box-shape layer (as the `slide` fixture's, but parametrised) whose local
 *  viewBox is centred at (0, 0), so an unrotated/unscaled layer translation
 *  `p` maps directly to `transform.x = p.x / stage.width`. */
function boxLayer(overrides: Partial<LottieLayer> & { ind: number }): LottieLayer {
  return {
    ty: 4,
    nm: 'box',
    ip: 0,
    op: 60,
    st: 0,
    ks: { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    shapes: [
      { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [4, 4] }, r: { a: 0, k: 0 } },
      { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
    ],
    ...overrides,
  }
}

/** A linear (non-eased) key pair: `o`/`i` at the identity handle. */
function linearKey(t: number, s: number[]): { t: number; s: number[]; o: { x: number; y: number }; i: { x: number; y: number } } {
  return { t, s, o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }
}

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id') continue
      out[k] = stripIds(v)
    }
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Step 1: source-to-output frame mapping
// ---------------------------------------------------------------------------

describe('source-to-output frame mapping', () => {
  it('a 60fps source position 0 -> 100 samples exactly at output frame 15 (30fps)', () => {
    const json = comp({
      fr: 60,
      ip: 0,
      op: 60,
      layers: [boxLayer({ ind: 1, op: 60, ks: { a: { a: 0, k: [0, 0] }, p: { a: 1, k: [linearKey(0, [0, 50]), { t: 60, s: [100, 50] }] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } })],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    if (shape.type !== 'shape') throw new Error('expected shape')
    const xKeys = shape.keyframes!.channels.x!.keys
    // The two Lottie keys (source frames 0 and 60) land on output frames 0 and 30;
    // sourceFrame = (0 + 15) * 60 / 30 = 30 is the exact midpoint of that segment.
    expect(xKeys.map((k) => k.frame)).toEqual([0, 30])
    expect(sampleChannel(xKeys, 15)).toBeCloseTo(50 / 100, 10)
  })

  it('a layer start offset (st) does not double-shift the sampled property time', () => {
    const withoutSt = comp({
      fr: 30,
      ip: 0,
      op: 30,
      layers: [boxLayer({ ind: 1, st: 0, ip: 0, op: 30, ks: { a: { a: 0, k: [0, 0] }, p: { a: 1, k: [linearKey(0, [0, 0]), { t: 30, s: [50, 0] }] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } })],
    })
    // Shifted by st=10: the same property key TIMES (layer-local time), but the
    // layer itself starts 10 frames later in the comp.
    const withSt = comp({
      fr: 30,
      ip: 10,
      op: 40,
      // Key TIMES are unchanged (0 and 30): they live in layer-local time
      // (comp time - st), which is unaffected by where the layer starts.
      layers: [boxLayer({ ind: 1, st: 10, ip: 10, op: 40, ks: { a: { a: 0, k: [0, 0] }, p: { a: 1, k: [linearKey(0, [0, 0]), { t: 30, s: [50, 0] }] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } })],
    })
    const a = lottieToClip(withoutSt, { fps: 30 })
    const b = lottieToClip(withSt, { fps: 30 })
    const shapeA = allClips(childProject(a.clip))[0]!
    const shapeB = allClips(childProject(b.clip))[0]!
    if (shapeA.type !== 'shape' || shapeB.type !== 'shape') throw new Error('expected shapes')
    const keysA = shapeA.keyframes!.channels.x!.keys
    const keysB = shapeB.keyframes!.channels.x!.keys
    expect(keysB.map((k) => k.value)).toEqual(keysA.map((k) => k.value))
    // Layer-local key times: the same frames, whichever frame the layer starts on.
    expect(keysB.map((k) => k.frame)).toEqual(keysA.map((k) => k.frame))
  })

  it('a hold key remains a step until the next key', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 1, k: [{ t: 0, s: [0, 0], h: 1 }, { t: 30, s: [40, 0] }] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        }),
      ],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    if (shape.type !== 'shape') throw new Error('expected shape')
    const xKeys = shape.keyframes!.channels.x!.keys
    // Held at the key-0 value up to the next key: the hold is carried natively
    // as `hold: true` on key 0, then the jump at frame 30.
    expect(xKeys).toHaveLength(2)
    expect(xKeys[0]).toMatchObject({ frame: 0, value: 0, hold: true })
    expect(sampleChannel(xKeys, 29)).toBe(0)
    const jump = xKeys.find((k) => k.frame === 30)!
    expect(jump.value).toBeCloseTo(0.4, 10)
  })
})

// ---------------------------------------------------------------------------
// Step 2: scalar/world-transform channels
// ---------------------------------------------------------------------------

describe('scalar and world-transform channels', () => {
  it('a static clip gets no keyframes at all', () => {
    const json = comp({ layers: [boxLayer({ ind: 1 })] })
    const { clip, skipped } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    expect(shape.keyframes).toBeUndefined()
    expect(skipped).toEqual([])
  })

  it('the same JSON produces identical key payloads (ids aside)', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: { a: { a: 0, k: [0, 0] }, p: { a: 1, k: [linearKey(0, [0, 0]), { t: 30, s: [40, 0] }] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
        }),
      ],
    })
    const a = lottieToClip(json, { fps: 30 })
    const b = lottieToClip(json, { fps: 30 })
    const shapeA = allClips(childProject(a.clip))[0]!
    const shapeB = allClips(childProject(b.clip))[0]!
    if (shapeA.type !== 'shape' || shapeB.type !== 'shape') throw new Error('expected shapes')
    expect(stripIds(shapeA.keyframes)).toEqual(stripIds(shapeB.keyframes))
  })

  it('opacity keys stay clamped to 0..1 even when the source overshoots', () => {
    const json = comp({
      layers: [
        boxLayer({
          ind: 1,
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 1, k: [linearKey(0, [-50]), { t: 30, s: [150] }] },
          },
        }),
      ],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    if (shape.type !== 'shape') throw new Error('expected shape')
    const opacityKeys = shape.keyframes!.channels.opacity!.keys
    expect(opacityKeys.every((k) => k.value >= 0 && k.value <= 1)).toBe(true)
    expect(opacityKeys[0]!.value).toBe(0)
    expect(opacityKeys[opacityKeys.length - 1]!.value).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Step 3: typed colours/paths and precomp remap
// ---------------------------------------------------------------------------

describe('typed colour keys', () => {
  it('a red -> blue linear fill matches the source sampler at the midpoint', () => {
    const json = comp({
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          shapes: [
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [4, 4] }, r: { a: 0, k: 0 } },
            { ty: 'fl', c: { a: 1, k: [linearKey(0, [1, 0, 0, 1]), { t: 60, s: [0, 0, 1, 1] }] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    if (shape.type !== 'shape') throw new Error('expected shape')
    const fillKeys = shape.keyframes!.channels['shape.fill']!.keys
    // Two native colour keys (red at 0, blue at 60); 60 frames at fr 30 == fps 30,
    // so frame 30 is the exact midpoint.
    expect(fillKeys.map((k) => k.frame)).toEqual([0, 60])
    expect(fillKeys[0]!.vec).toEqual([1, 0, 0, 1])
    expect(fillKeys[1]!.vec).toEqual([0, 0, 1, 1])
    const mid = sampleColorChannel(fillKeys, 30)!
    expect(mid[0]).toBeCloseTo(0.5, 10)
    expect(mid[2]).toBeCloseTo(0.5, 10)
  })
})

describe('typed path keys', () => {
  it('a structure mismatch between path keys holds until the destination key', () => {
    const json = comp({
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          shapes: [
            {
              ty: 'sh',
              ks: {
                a: 1,
                k: [
                  { t: 0, s: [{ v: [[0, 0], [10, 0], [10, 10]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true }] },
                  { t: 30, s: [{ v: [[0, 0], [10, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], c: true }] },
                ],
              },
            },
            { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    const shape = allClips(childProject(clip))[0]!
    if (shape.type !== 'shape') throw new Error('expected shape')
    const pathKeys = shape.keyframes!.channels['shape.path']!.keys
    // samplePath holds the source (3-vertex) path for every frame up to 30,
    // so the run-length encoder collapses that whole span into one key.
    expect(pathKeys.filter((k) => k.frame < 30)).toHaveLength(1)
    const before = pathKeys[0]!.path!
    expect(before).toContain('Z')
    const after = pathKeys.find((k) => k.frame === 30)!.path!
    expect(after).not.toBe(before)
  })
})

describe('precomp time remap', () => {
  it('tm 0.5s (at 30fps) selects child source frame 15', () => {
    const child: LottieLayer = { ty: 1, ind: 1, sc: '#ffffff', sw: 10, sh: 10, ip: 0, op: 60, st: 0 }
    const json = comp({
      layers: [
        {
          ty: 0,
          ind: 1,
          refId: 'c1',
          w: 100,
          h: 100,
          ip: 0,
          op: 60,
          st: 0,
          tm: { a: 1, k: [linearKey(0, [0]), { t: 60, s: [2] }] },
        },
      ],
      assets: [{ id: 'c1', layers: [child] }],
    })
    const { clip } = lottieToClip(json, { fps: 30 })
    if (clip.type !== 'compound' || !clip.compound) throw new Error('expected compound')
    const precomp = allClips(clip.compound.project)[0]!
    expect(precomp.type).toBe('compound')
    const timeKeys = precomp.keyframes!.channels.time!.keys
    // tm goes 0 -> 2s linearly over 60 frames; at output frame 15 (of 60),
    // t = 15/60 * 2s = 0.5s, so the child source frame is 0.5 * 30fps = 15.
    const at15 = timeKeys.find((k) => k.frame === 15)!
    expect(at15.value).toBeCloseTo(15, 6)
  })
})

describe('unsupported animated features report once', () => {
  it('an animated gradient reports gradient-stop-animation exactly once', () => {
    const json = comp({
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          shapes: [
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [4, 4] }, r: { a: 0, k: 0 } },
            {
              ty: 'gf',
              t: 1,
              s: { a: 0, k: [-2, 0] },
              e: { a: 0, k: [2, 0] },
              g: { p: 2, k: { a: 1, k: [linearKey(0, [0, 1, 0, 0, 1, 0, 0, 1]), { t: 60, s: [0, 0, 0, 1, 1, 1, 1, 1] }] } },
              o: { a: 0, k: 100 },
            },
          ],
        },
      ],
    })
    const { skipped } = lottieToClip(json, { fps: 30 })
    expect(skipped).toEqual([{ feature: 'gradient-stop-animation', count: 1 }])
  })
})

// ---------------------------------------------------------------------------
// Step 4: budget
// ---------------------------------------------------------------------------

describe('animation budget', () => {
  it('rejects a clip whose animated duration exceeds the frame budget, before allocating', () => {
    const json = comp({
      fr: 1,
      ip: 0,
      op: MAX_ANIMATION_DURATION_FRAMES + 1,
      layers: [
        boxLayer({
          ind: 1,
          op: MAX_ANIMATION_DURATION_FRAMES + 1,
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 1, k: [linearKey(0, [0, 0]), { t: MAX_ANIMATION_DURATION_FRAMES + 1, s: [40, 0] }] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        }),
      ],
    })
    expect(() => lottieToClip(json, { fps: 1 })).toThrow(/frame budget/)
  })

  it('rejects an import whose cumulative animated keys exceed the key budget', () => {
    const perLayerFrames = 18_000
    const layerCount = Math.ceil(MAX_ANIMATION_KEYS / perLayerFrames) + 1
    const layers: LottieLayer[] = []
    for (let n = 0; n < layerCount; n++) {
      layers.push(
        boxLayer({
          ind: n + 1,
          op: perLayerFrames,
          ks: {
            a: { a: 0, k: [0, 0] },
            // Different easing per dimension is not 1:1, so this channel is sampled per frame.
            p: { a: 1, k: [{ t: 0, s: [0, 0], o: { x: [0.1, 0.9], y: [0, 0] }, i: { x: [0.9, 0.1], y: [1, 1] } }, { t: perLayerFrames, s: [40, 0] }] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        }),
      )
    }
    const json = comp({ fr: 1, ip: 0, op: perLayerFrames, layers })
    expect(() => lottieToClip(json, { fps: 1 })).toThrow(/key animation budget/)
  })
})
