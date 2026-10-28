/**
 * MI-P8: motion blur driven by each clip's own velocity.
 *
 * There is no GPU in Node. What this file CAN prove, and does:
 *  - the registry / shader / uniform contract (names, ranges, clamps, skip);
 *  - the resolver's velocity (central difference, clamped ends, rotation and
 *    scale as an isotropic term, never computed without the effect);
 *  - the kernel's tap maths in a CPU reference of the shader, premultiplied;
 *  - the GL call sequence: a resting clip adds no pass, a moving one adds one;
 *  - preview and export issue the SAME uniforms and draws, frame by frame,
 *    because both feed one EffectChain from the one resolver.
 * What it cannot: real-GPU pixel parity. That is owed (see the ticket Result).
 */

import { describe, expect, it, vi } from 'vitest'
import { defaultEffectParams, MOTION_BLUR_INPUTS } from '../../../effects/registry'
import { WorkerEffectRenderer, projectNeedsGpu } from '../../../export/gpuExport'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import type { ActiveImageClip } from '../../../resolver/scene'
import { specVocabulary } from '../../../spec/vocabulary'
import type { Clip, ClipKeyframes, Effect, Keyframe, Project, Track } from '../../../types'
import { RecordingGl } from '../debug/RecordingGl'
import { EffectChain } from '../EffectChain'
import { GPU_EFFECTS } from '../effects'
import {
  MOTION_BLUR_GOLDEN_ANGLE,
  MOTION_BLUR_MAX_REACH,
  motionBlur,
  motionBlurTap,
  motionBlurTravel,
} from '../effects/motionBlur'
import type { EffectEnv } from '../effects/types'
import { ImageLayer, type ImageLoader } from '../layers/ImageLayer'
import { __clearImageCacheForTests } from '../layers/imageCache'
import type { LayerContext } from '../layers/types'
import { sanitizeOps } from '../../../ops/sanitize'
import { TimelineEngine } from '../../../editor/TimelineEngine'

const STAGE = { width: 1920, height: 1080 }
const SRC = { width: 960, height: 540 }

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function key(frame: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe {
  return { id: `k${frame}`, frame, value, easing }
}

const track: Track = {
  id: 't1',
  name: 'T',
  kind: 'video',
  order: 0,
  height: 64,
  locked: false,
  disabled: false,
  muted: false,
  solo: false,
}

function imageClip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'image',
    name: 'Rect',
    startFrame: 0,
    durationFrames: 60,
    sourceStartFrame: 0,
    sourceDurationFrames: 60,
    src: 'blob://rect',
    transform: { x: 0.1, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    ...over,
  }
}

function project(clip: Clip): Project {
  return {
    id: 'p',
    fps: 30,
    stage: STAGE,
    tracks: [track],
    clips: { t1: [clip] },
    transitions: [],
    version: 1,
  }
}

function keyed(channels: ClipKeyframes['channels']): ClipKeyframes {
  return { channels }
}

const BLUR: Effect = { id: 'mb', kind: 'motionBlur', params: defaultEffectParams('motionBlur') }
const GAUSS: Effect = { id: 'gb', kind: 'gaussianBlur', params: defaultEffectParams('gaussianBlur') }

/** A rectangle that moves 40 stage px a frame for 40 frames, then rests. */
function mover(effects: Effect[] = [BLUR]): Clip {
  return imageClip({
    effects,
    keyframes: keyed({
      x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(40, 0.1 + (40 * 40) / STAGE.width), key(60, 0.1 + (40 * 40) / STAGE.width)] },
    }),
  })
}

function imageAt(clip: Clip, frame: number): ActiveImageClip {
  return resolveTimeline(frame, project(clip)).images[0]!
}

function inputs(item: ActiveImageClip, id = 'mb') {
  const params = item.effects!.find((e) => e.id === id)!.params
  return {
    x: params[MOTION_BLUR_INPUTS.x] as number | undefined,
    y: params[MOTION_BLUR_INPUTS.y] as number | undefined,
    spin: params[MOTION_BLUR_INPUTS.spin] as number | undefined,
    zoom: params[MOTION_BLUR_INPUTS.zoom] as number | undefined,
  }
}

// ---------------------------------------------------------------------------
// Resolver: velocity
// ---------------------------------------------------------------------------

describe('resolver velocity', () => {
  it('x keyed 0.1 -> 0.5 over 40 frames at 1920 wide is ~19.2 px/frame along +x', () => {
    const clip = imageClip({
      effects: [BLUR],
      keyframes: keyed({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(40, 0.5)] } }),
    })
    const v = inputs(imageAt(clip, 20))
    expect(v.x).toBeCloseTo(19.2, 6)
    expect(v.y).toBeCloseTo(0, 9)
    expect(v.spin).toBeCloseTo(0, 9)
    expect(v.zoom).toBeCloseTo(0, 9)
  })

  it('is the central difference of the transform one frame either side (not one ahead, not two)', () => {
    // Accelerating motion: a wrong neighbour frame gives a different number.
    const clip = imageClip({
      effects: [BLUR],
      keyframes: keyed({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(40, 0.9, 'quad-in')] } }),
    })
    const bare = { ...clip, effects: undefined }
    const xAt = (f: number) => imageAt(bare, f).transform!.x
    const expected = ((xAt(21) - xAt(19)) * STAGE.width) / 2
    expect(inputs(imageAt(clip, 20)).x).toBeCloseTo(expected, 9)
    // The wrong answers really are different, so the assertion above bites.
    expect(((xAt(22) - xAt(19)) * STAGE.width) / 3).not.toBeCloseTo(expected, 3)
    expect(((xAt(21) - xAt(20)) * STAGE.width) / 1).not.toBeCloseTo(expected, 3)
  })

  it('uses the forward difference on the first frame and the backward one on the last', () => {
    const clip = imageClip({
      durationFrames: 41,
      effects: [BLUR],
      keyframes: keyed({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(40, 0.9, 'quad-in')] } }),
    })
    const bare = { ...clip, effects: undefined }
    const xAt = (f: number) => imageAt(bare, f).transform!.x
    expect(inputs(imageAt(clip, 0)).x).toBeCloseTo((xAt(1) - xAt(0)) * STAGE.width, 9)
    expect(inputs(imageAt(clip, 40)).x).toBeCloseTo((xAt(40) - xAt(39)) * STAGE.width, 9)
  })

  it('a one-frame clip is at rest', () => {
    const clip = imageClip({
      durationFrames: 1,
      effects: [BLUR],
      keyframes: keyed({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(40, 0.9)] } }),
    })
    expect(inputs(imageAt(clip, 0))).toEqual({ x: 0, y: 0, spin: 0, zoom: 0 })
  })

  it('measures y in stage px too (the stage is not square)', () => {
    const clip = imageClip({
      effects: [BLUR],
      keyframes: keyed({ y: { source: { kind: 'keyframes' }, keys: [key(0, 0.2), key(30, 0.8)] } }),
    })
    // 0.6 of 1080 over 30 frames.
    expect(inputs(imageAt(clip, 10)).y).toBeCloseTo((0.6 * 1080) / 30, 6)
  })

  it('a spinning square has no translation, only a rotation term', () => {
    const clip = imageClip({
      effects: [BLUR],
      keyframes: keyed({ rotation: { source: { kind: 'keyframes' }, keys: [key(0, 0), key(40, 1.2)] } }),
    })
    const v = inputs(imageAt(clip, 20))
    expect(v.x).toBeCloseTo(0, 9)
    expect(v.y).toBeCloseTo(0, 9)
    expect(v.spin).toBeCloseTo(0.03, 9)
    expect(v.zoom).toBeCloseTo(0, 9)
  })

  it('a zooming clip reports a fractional scale rate', () => {
    const clip = imageClip({
      effects: [BLUR],
      keyframes: keyed({ scale: { source: { kind: 'keyframes' }, keys: [key(0, 1), key(40, 2)] } }),
    })
    // Scale 1.5 at frame 20, +0.025 per frame: ~1.667% of the mid-point scale.
    expect(inputs(imageAt(clip, 20)).zoom).toBeCloseTo(0.025 / 1.5, 9)
  })

  it('is not computed for a clip without the effect, or with it off, or manual', () => {
    const none = imageAt(mover([]), 20)
    expect(none.effects).toBeUndefined()
    expect(JSON.stringify(none)).not.toContain('vel')

    const other = imageAt(mover([GAUSS]), 20)
    expect(Object.keys(other.effects![0]!.params)).toEqual(Object.keys(defaultEffectParams('gaussianBlur')))

    const disabled = imageAt(mover([{ ...BLUR, enabled: false }]), 20)
    expect(disabled.effects).toBeUndefined()

    const manual = imageAt(mover([{ ...BLUR, params: { ...BLUR.params, auto: false } }]), 20)
    expect(Object.keys(manual.effects![0]!.params)).not.toContain(MOTION_BLUR_INPUTS.x)
  })

  it('only the automatic motionBlur in a mixed stack gets the measurement', () => {
    const item = imageAt(mover([GAUSS, BLUR, { ...BLUR, id: 'hand', params: { ...BLUR.params, auto: false } }]), 20)
    expect(inputs(item).x).toBeCloseTo(40, 6)
    expect(Object.keys(item.effects![0]!.params)).not.toContain(MOTION_BLUR_INPUTS.x)
    expect(Object.keys(item.effects![2]!.params)).not.toContain(MOTION_BLUR_INPUTS.x)
  })

  it('a clip without the effect resolves to the same scene object shape as before', () => {
    const item = imageAt(mover([]), 20)
    expect(Object.keys(item).sort()).toEqual(['id', 'name', 'opacity', 'sourceFrame', 'src', 'trackId', 'transform', 'type', 'zIndex'])
  })

  it('applies to a text clip\'s entry animation as well as its keys', () => {
    const clip: Clip = {
      id: 'tx',
      trackId: 't1',
      type: 'text',
      name: 'T',
      startFrame: 0,
      durationFrames: 60,
      sourceStartFrame: 0,
      sourceDurationFrames: 60,
      content: 'hi',
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      effects: [BLUR],
      textAnimation: { in: 'slide-left', durationFrames: 20 },
    }
    const item = resolveTimeline(5, project(clip)).texts[0]!
    const v = item.effects![0]!.params[MOTION_BLUR_INPUTS.x] as number
    expect(Math.abs(v)).toBeGreaterThan(1)
    // And once it has arrived it is at rest.
    const settled = resolveTimeline(40, project(clip)).texts[0]!
    expect(settled.effects![0]!.params[MOTION_BLUR_INPUTS.x]).toBeCloseTo(0, 9)
  })
})

// ---------------------------------------------------------------------------
// Uniform contract and skip
// ---------------------------------------------------------------------------

const ENV: EffectEnv = {
  pass: 0,
  size: [1000, 600],
  inner: [0.1, 0.1, 0.8, 0.8],
  pxPerStagePx: [0.5, 0.5],
  frame: 30,
  time: 1,
}
const BOX = { width: 1600, height: 960 }
const base = defaultEffectParams('motionBlur')

describe('motionBlur uniforms', () => {
  it('turns stage px per frame x shutter into chain uv', () => {
    // 40 px/frame x shutter 0.5 = a 20 stage px streak = 10 chain px = 0.01 uv.
    const u = motionBlur.uniforms({ ...base, velX: 40, velY: 0 }, ENV)
    expect((u.uExtent as number[])[0]).toBeCloseTo(0.01, 9)
    expect((u.uExtent as number[])[1]).toBeCloseTo(0, 9)
    expect((u.uSpread as number[])[0]).toBeCloseTo(0, 9)
    expect(u.uSamples).toBe(12)
  })

  it('+y (down the stage) is -v in texture space: textures are FLIP_Y, v points up', () => {
    const u = motionBlur.uniforms({ ...base, velY: 60 }, ENV)
    expect((u.uExtent as number[])[1]).toBeCloseTo(-(60 * 0.5 * 0.5) / 600, 9)
    expect((u.uExtent as number[])[1]).toBeLessThan(0)
  })

  /**
   * The SIGN, pinned through the kernel's own taps. The streak a pixel is
   * smeared over is the set of texture offsets `line * uExtent`; in image
   * coordinates (x right, y DOWN = -v) its x/y covariance has the sign of the
   * motion's: positive for down-right / up-left, negative for up-right. A real
   * GPU run measured -4 for a down-right move before the y flip was added.
   */
  function imageCovariance(u: Record<string, number | readonly number[]>): number {
    const [ux, uy] = u.uExtent as number[]
    const n = u.uSamples as number
    let cov = 0
    for (let i = 0; i < n; i++) {
      const line = motionBlurTap(i, n).line
      cov += line * ux! * -(line * uy!) // x, then image y = -v
    }
    return cov / n
  }

  it('a down-right move smears down-right, an up-right move up-right (image covariance sign)', () => {
    const downRight = motionBlur.uniforms({ ...base, velX: 40, velY: 40 }, ENV)
    const upRight = motionBlur.uniforms({ ...base, velX: 40, velY: -40 }, ENV)
    expect(imageCovariance(downRight)).toBeGreaterThan(0)
    expect(imageCovariance(upRight)).toBeLessThan(0)
    expect(imageCovariance(motionBlur.uniforms({ ...base, velX: -40, velY: 40 }, ENV))).toBeLessThan(0)
  })

  it('manual angle follows the same convention: 45 deg is down-right, -45 up-right', () => {
    expect(imageCovariance(motionBlur.uniforms({ ...base, auto: false, angle: 45, length: 80 }, ENV))).toBeGreaterThan(0)
    expect(imageCovariance(motionBlur.uniforms({ ...base, auto: false, angle: -45, length: 80 }, ENV))).toBeLessThan(0)
  })

  it('widens isotropically for spin and zoom by the corner residual of the actual box', () => {
    const r = Math.hypot(BOX.width, BOX.height) / 2
    const t = motionBlurTravel({ ...base, velSpin: 0.03, velZoom: 0.04 }, BOX)
    expect(t.x).toBe(0)
    expect(t.spread).toBeCloseTo(r * 0.05, 9) // hypot(0.03, 0.04)
    const u = motionBlur.uniforms({ ...base, velSpin: 0.03, velZoom: 0.04 }, ENV)
    expect((u.uSpread as number[])[0]).toBeCloseTo((r * 0.05 * 0.5 * 0.5) / 1000, 9)
    expect((u.uExtent as number[])[0]).toBe(0)
  })

  it('manual mode uses angle (0 = right, 90 = down) and length, and ignores velocity', () => {
    const u = motionBlur.uniforms({ ...base, auto: false, angle: 90, length: 80, velX: 999 }, ENV)
    expect((u.uExtent as number[])[0]).toBeCloseTo(0, 9)
    // 90 = down the stage = -v in texture space.
    expect((u.uExtent as number[])[1]).toBeCloseTo(-(80 * 0.5 * 0.5) / 600, 9)
  })

  it('keeps the whole reach inside the 200 px padding', () => {
    const u = motionBlur.uniforms({ ...base, shutter: 1, velX: 1000, velSpin: 0.2 }, { ...ENV, pxPerStagePx: [1, 1] })
    const ex = (u.uExtent as number[])[0]! * 1000
    const sp = (u.uSpread as number[])[0]! * 1000
    expect(Math.abs(ex) / 2 + sp).toBeCloseTo(MOTION_BLUR_MAX_REACH, 6)
  })

  it('clamps the tap count to 4..32', () => {
    expect(motionBlur.uniforms({ ...base, samples: 1, velX: 9 }, ENV).uSamples).toBe(4)
    expect(motionBlur.uniforms({ ...base, samples: 99, velX: 9 }, ENV).uSamples).toBe(32)
  })

  it('declares every uniform it sets and pads by the registry amount', () => {
    for (const name of Object.keys(motionBlur.uniforms({ ...base, velX: 9 }, ENV))) {
      expect(motionBlur.frag).toMatch(new RegExp(`uniform \\w+ ${name};`))
    }
    expect(motionBlur.padding!(base, BOX)).toBe(200)
    expect(motionBlur.passes(base)).toBe(1)
    expect(GPU_EFFECTS.get('motionBlur')).toBe(motionBlur)
  })
})

describe('motionBlur skip (the resting clip costs nothing)', () => {
  it('skips with no velocity, below minPx, at zero shutter; runs above', () => {
    expect(motionBlur.skip!(base, BOX)).toBe(true)
    expect(motionBlur.skip!({ ...base, velX: 1 }, BOX)).toBe(true) // 1 < 1.5
    expect(motionBlur.skip!({ ...base, velX: 1.6 }, BOX)).toBe(false)
    expect(motionBlur.skip!({ ...base, velX: 80, shutter: 0 }, BOX)).toBe(true)
    expect(motionBlur.skip!({ ...base, minPx: 0, velX: 0.01 }, BOX)).toBe(false)
  })

  it('counts a slow spin on a big box as travel (the corners move)', () => {
    // r ~ 932 px x 0.01 rad = 9 px at the corners, though the centre is still.
    expect(motionBlur.skip!({ ...base, velSpin: 0.01 }, BOX)).toBe(false)
    expect(motionBlur.skip!({ ...base, velSpin: 0.01 }, { width: 20, height: 20 })).toBe(true)
  })

  it('manual mode with a length runs even though nothing is measured', () => {
    expect(motionBlur.skip!({ ...base, auto: false, length: 40 }, BOX)).toBe(false)
    expect(motionBlur.skip!({ ...base, auto: false, length: 0 }, BOX)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The kernel: a CPU twin of the shader on one premultiplied row
// ---------------------------------------------------------------------------

/** Linear-filtered, clamp-to-edge sample of a premultiplied RGBA row. */
function sampleRow(row: ReadonlyArray<readonly [number, number]>, x: number): [number, number] {
  const p = Math.min(Math.max(x - 0.5, 0), row.length - 1)
  const i = Math.floor(p)
  const t = p - i
  const a = row[i]!
  const b = row[Math.min(i + 1, row.length - 1)]!
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t]
}

/** The shader's loop, on a row, horizontal streak only. [premultiplied colour, alpha] per texel. */
function blurRow(row: ReadonlyArray<readonly [number, number]>, extentPx: number, samples: number): Array<[number, number]> {
  return row.map((_, x) => {
    let c = 0
    let a = 0
    for (let i = 0; i < samples; i++) {
      const s = sampleRow(row, x + 0.5 + extentPx * motionBlurTap(i, samples).line)
      c += s[0]
      a += s[1]
    }
    return [c / samples, a / samples]
  })
}

describe('motionBlur kernel (CPU reference)', () => {
  it('taps sit at the mid-points of equal slices of the streak, symmetric about the pixel', () => {
    const n = 12
    const lines = Array.from({ length: n }, (_, i) => motionBlurTap(i, n).line)
    expect(Math.min(...lines)).toBeCloseTo(-0.5 + 0.5 / n, 12)
    expect(Math.max(...lines)).toBeCloseTo(0.5 - 0.5 / n, 12)
    expect(lines.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 12)
  })

  it('the shader uses the same constants and formulas as the reference', () => {
    expect(motionBlur.frag).toContain(String(MOTION_BLUR_GOLDEN_ANGLE))
    expect(motionBlur.frag).toContain('(fi + 0.5) / float(n)')
    expect(motionBlur.frag).toContain('uExtent * (f - 0.5)')
    expect(motionBlurTap(3, 8).angle).toBeCloseTo(3 * MOTION_BLUR_GOLDEN_ANGLE, 12)
    for (let i = 0; i < 32; i++) expect(motionBlurTap(i, 32).radius).toBeLessThanOrEqual(1)
  })

  it('smears a bright, off-centre rectangle by the streak and conserves its light', () => {
    // 100 texels of bright (colour = alpha = 1, premultiplied) in a 400 row.
    const row: Array<[number, number]> = Array.from({ length: 400 }, (_, x) => (x >= 60 && x < 160 ? [1, 1] : [0, 0]))
    const out = blurRow(row, 40, 16)
    // Untouched further than half a streak (20 px) from either edge.
    expect(out[100]).toEqual([1, 1])
    expect(out[40]).toEqual([0, 0])
    expect(out[200]).toEqual([0, 0])
    // Soft on both edges, inside the streak.
    expect(out[60]![1]).toBeGreaterThan(0.3)
    expect(out[60]![1]).toBeLessThan(0.7)
    expect(out[45]![1]).toBeGreaterThan(0)
    expect(out[175]![1]).toBeGreaterThan(0) // trailing and leading edges both
    // Light is conserved.
    const total = out.reduce((s, p) => s + p[1], 0)
    expect(total).toBeCloseTo(100, 6)
    // Premultiplied averaging keeps colour/alpha at 1 on the ramp (no dark fringe).
    for (const [c, a] of out) if (a > 0.01) expect(c / a).toBeCloseTo(1, 6)
  })

  it('a streak is the same blur whichever way the vector points (symmetric kernel)', () => {
    const row: Array<[number, number]> = Array.from({ length: 400 }, (_, x) => (x >= 60 && x < 160 ? [1, 1] : [0, 0]))
    const fwd = blurRow(row, 40, 16)
    const back = blurRow(row, -40, 16)
    for (let x = 0; x < 400; x++) expect(back[x]![1]).toBeCloseTo(fwd[x]![1], 9)
  })

  it('a longer streak softens more', () => {
    const row: Array<[number, number]> = Array.from({ length: 400 }, (_, x) => (x >= 60 && x < 160 ? [1, 1] : [0, 0]))
    expect(blurRow(row, 80, 16)[40]![1]).toBeGreaterThan(blurRow(row, 40, 16)[40]![1])
  })
})

// ---------------------------------------------------------------------------
// GL call sequence through ImageLayer + EffectChain, and preview == export
// ---------------------------------------------------------------------------

const loader: ImageLoader = () => Promise.resolve({ source: {} as TexImageSource, width: SRC.width, height: SRC.height })
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

/** Everything the chain sends to GL that determines pixels: uniforms and draws. */
function record(gl: RecordingGl): string[] {
  const log: string[] = []
  const wrap = (name: 'uniform1f' | 'uniform2f' | 'uniform3f' | 'uniform4f' | 'uniform1i' | 'uniformMatrix3fv' | 'drawArrays') => {
    const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>
    const orig = g[name]!.bind(gl)
    vi.spyOn(g, name).mockImplementation((...args: unknown[]) => {
      // The location is a {_id} object; its id is stable by uniform name.
      const rest = args.map((a) => (a && typeof a === 'object' && '_id' in a ? `loc${(a as { _id: number })._id}` : a instanceof Float32Array ? Array.from(a) : a))
      log.push(`${name}(${JSON.stringify(rest)})`)
      return orig(...args)
    })
  }
  for (const n of ['uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1i', 'uniformMatrix3fv', 'drawArrays'] as const) wrap(n)
  return log
}

async function preview(item: ActiveImageClip, frame: number) {
  __clearImageCacheForTests()
  const gl = new RecordingGl()
  gl.viewport(0, 0, SRC.width, SRC.height)
  const chain = new EffectChain()
  const ctx: LayerContext = {
    gl: gl as unknown as WebGL2RenderingContext,
    frame,
    stage: STAGE,
    viewport: SRC,
    fps: 30,
    effectChain: chain,
  }
  const layer = new ImageLayer(loader)
  layer.acquire(item, ctx)
  await flush()
  gl.reset()
  gl.viewport(0, 0, SRC.width, SRC.height)
  const log = record(gl)
  layer.draw(item, ctx)
  return { log, chain, draws: log.filter((l) => l.startsWith('drawArrays')).length, digest: await gl.digest() }
}

function exported(item: ActiveImageClip, frame: number) {
  const gl = new RecordingGl()
  const made = { canvas: { width: SRC.width, height: SRC.height } as unknown as OffscreenCanvas, gl: gl as unknown as WebGL2RenderingContext }
  const renderer = WorkerEffectRenderer.create(SRC, STAGE, 30, () => made)
  const source = { width: SRC.width, height: SRC.height } as unknown as TexImageSource & { width: number; height: number }
  gl.reset()
  const log = record(gl)
  const out = renderer.draw(
    { source, ...(item.transform ? { transform: item.transform } : {}), opacity: item.opacity, effects: item.effects ?? [] },
    frame,
  )
  return { log, out, draws: log.filter((l) => l.startsWith('drawArrays')).length }
}

describe('GL sequence', () => {
  it('a moving clip adds exactly one pass: capture + blur + place', async () => {
    const r = await preview(imageAt(mover(), 20), 20)
    expect(r.chain.runs).toBe(1)
    expect(r.draws).toBe(3)
  })

  it('a resting clip adds no pass: the same uniforms and draws as the clip with no effect', async () => {
    // (The layer re-binds its program / texture once after the chain declines;
    // that is existing fall-through behaviour and is state, not a draw.)
    const resting = await preview(imageAt(mover(), 50), 50)
    const bare = await preview(imageAt(mover([]), 50), 50)
    expect(resting.chain.runs).toBe(0)
    expect(resting.draws).toBe(bare.draws)
    expect(resting.log).toEqual(bare.log)
  })

  it('a clip without motionBlur issues the same calls whatever else is in the project', async () => {
    const a = await preview(imageAt(mover([GAUSS]), 20), 20)
    const b = await preview(imageAt(mover([GAUSS]), 20), 20)
    expect(b.digest).toBe(a.digest)
    expect(a.draws).toBe(4) // capture + 2 blur passes + place: untouched by motionBlur
  })

  it('the streak reaches the shader: moving frames send a non-zero uExtent, and faster is wider', async () => {
    const slow = await preview(imageAt(mover(), 20), 20)
    const fast = await preview(
      imageAt(
        imageClip({
          effects: [BLUR],
          keyframes: keyed({ x: { source: { kind: 'keyframes' }, keys: [key(0, 0.1), key(40, 0.1 + (80 * 40) / STAGE.width)] } }),
        }),
        20,
      ),
      20,
    )
    expect(slow.log.join('\n')).not.toBe(fast.log.join('\n'))
    const extent = (log: string[]) =>
      log.filter((l) => l.startsWith('uniform2f')).map((l) => JSON.parse(l.slice('uniform2f('.length, -1)) as [string, number, number])
    const xs = (log: string[]) => extent(log).map((e) => Math.abs(e[1]))
    expect(Math.max(...xs(fast.log))).toBeGreaterThan(Math.max(...xs(slow.log)))
  })
})

describe('preview and export agree frame by frame', () => {
  it('issues identical uniforms and draws on the moving fixture, resting frames and both ends', async () => {
    const clip = mover()
    let blurredFrames = 0
    const seen = new Set<string>()
    for (const frame of [0, 1, 7, 20, 38, 39, 40, 41, 50, 59]) {
      const item = imageAt(clip, frame)
      const p = await preview(item, frame)
      const e = exported(item, frame)
      if (p.chain.runs > 0) {
        expect(e.log, `frame ${frame}`).toEqual(p.log)
        expect(e.draws).toBe(p.draws)
        blurredFrames++
        seen.add(p.log.join('|'))
      } else {
        // At rest neither side runs the chain; the export hands the clip back
        // to its plain 2D draw, exactly as the preview's layer draws it plainly.
        expect(e.out, `frame ${frame}`).toBeNull()
        expect(e.log).toEqual([])
      }
    }
    expect(blurredFrames).toBeGreaterThanOrEqual(7) // frames 0..40 move, 41+ rest
    // Non-vacuous: the 40 px/frame body is one identical blur; the ends differ (forward/backward).
    expect(seen.size).toBeGreaterThan(1)
  })

  it('a resting frame returns null from export, so it is drawn plainly like the preview', () => {
    expect(exported(imageAt(mover(), 50), 50).out).toBeNull()
  })
})

describe('export fallback', () => {
  it('a project with motionBlur always needs the GPU, so it can never export silently unblurred', () => {
    // There is no Canvas2D effect path to degrade to: the exporter either opens
    // WebGL2 or fails with ExportCapabilityError. A disabled one does not count.
    expect(projectNeedsGpu(project(mover()))).toBe(true)
    expect(projectNeedsGpu(project(mover([{ ...BLUR, enabled: false }])))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Reaches the vocabulary and the sanitiser from the registry alone
// ---------------------------------------------------------------------------

describe('registry reach', () => {
  it('specVocabulary lists motionBlur with its params, no prompt edit', () => {
    const line = specVocabulary()
      .split('\n')
      .find((l) => l.startsWith('- motionBlur'))
    expect(line).toBeDefined()
    expect(line).toContain('shutter 0..1')
    expect(line).toContain('samples 4..32')
    expect(line).toContain('auto (boolean)')
    expect(line).toContain('blur')
  })

  it('addEffect motionBlur is accepted and clamped; the velocity inputs are not params', () => {
    const engine = new TimelineEngine({ fps: 30, stage: STAGE })
    const v = engine.addTrack('video').id
    const c = engine.addClip({ trackId: v, type: 'image', name: 'A', src: 'a.png', startFrame: 0, durationFrames: 60 })
    const { ops, dropped } = sanitizeOps(
      [{ op: 'addEffect', clip: c.id, kind: 'motionBlur', params: [{ name: 'shutter', value: 5 }, { name: 'samples', value: 2.2 }, { name: 'velX', value: 500 }] }],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops[0]).toMatchObject({ op: 'addEffect', kind: 'motionBlur', params: { shutter: 1, samples: 4 } })
    expect((ops[0] as { params: Record<string, unknown> }).params).not.toHaveProperty('velX')
  })
})
