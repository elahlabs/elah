/**
 * EDX-P2: EffectChain geometry, GL call sequence, bypass and determinism.
 *
 * Runs against RecordingGl (no GPU). What it proves: clips without effects
 * issue exactly the calls they did before the chain existed; clips with
 * effects capture → pass → place and leave GL state as they found it; the
 * same frame always produces the same call log (the EffectChainHash golden).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveImageClip } from '../../../resolver/scene'
import type { ResolvedEffect } from '../../../effects/resolveEffects'
import { defaultEffectParams } from '../../../effects/registry'
import { RecordingGl } from '../debug/RecordingGl'
import { EffectChain, MAX_CHAIN_PADDING, MAX_CHAIN_SIDE, planChain } from '../EffectChain'
import { GPU_EFFECTS } from '../effects'
import { FramebufferPool } from '../FramebufferPool'
import { ImageLayer, type ImageLoader } from '../layers/ImageLayer'
import { __clearImageCacheForTests } from '../layers/imageCache'
import type { LayerContext } from '../layers/types'

const STAGE = { width: 1920, height: 1080 }
const FULL = { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 }

function fx(kind: string, params: Record<string, number | string | boolean> = {}, id = kind): ResolvedEffect {
  return { id, kind, params: { ...defaultEffectParams(kind), ...params } }
}

function gpu(kind: string, params: ResolvedEffect['params'] = defaultEffectParams(kind)) {
  return { gpu: GPU_EFFECTS.get(kind)!, params }
}

const loader: ImageLoader = () =>
  Promise.resolve({ source: {} as TexImageSource, width: 3840, height: 2160 })
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function image(overrides: Partial<ActiveImageClip> = {}): ActiveImageClip {
  return {
    id: 'img',
    trackId: 't1',
    name: 'img',
    type: 'image',
    src: 'blob://chain-test',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...overrides,
  }
}

function ctxFor(gl: RecordingGl, chain?: EffectChain, frame = 0): LayerContext {
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    frame,
    stage: STAGE,
    viewport: STAGE,
    fps: 30,
    ...(chain ? { effectChain: chain } : {}),
  }
}

/** Draw one image clip on a fresh GL + layer and return the call-log digest. */
async function renderImage(item: ActiveImageClip, withChain: boolean): Promise<{ digest: string; chain: EffectChain; gl: RecordingGl }> {
  __clearImageCacheForTests()
  const gl = new RecordingGl()
  const chain = new EffectChain()
  const layer = new ImageLayer(loader)
  const ctx = ctxFor(gl, withChain ? chain : undefined)
  layer.acquire(item, ctx)
  await flush()
  gl.reset()
  layer.draw(item, ctx)
  return { digest: await gl.digest(), chain, gl }
}

describe('planChain', () => {
  it('works at the on-stage size when the source is larger', () => {
    const plan = planChain(FULL, 3840, 2160, undefined, [gpu('colorGrade')])!
    expect(plan.contentWidth).toBe(1920)
    expect(plan.contentHeight).toBe(1080)
    expect(plan.pxPerStagePx).toEqual([1, 1])
    expect(plan.padX).toBe(0)
    expect(plan.outRect).toEqual(FULL)
  })

  it('carries the clip skew to the output rect, and adds none when there is none (MOT-8)', () => {
    const skewed = planChain({ ...FULL, skewX: 0.3, skewY: -0.1 }, 1920, 1080, undefined, [gpu('colorGrade')])!
    expect(skewed.outRect.skewX).toBe(0.3)
    expect(skewed.outRect.skewY).toBe(-0.1)
    const plain = planChain(FULL, 1920, 1080, undefined, [gpu('colorGrade')])!
    expect('skewX' in plain.outRect || 'skewY' in plain.outRect).toBe(false)
  })

  it('works at the source size when the source is smaller than its box', () => {
    const plan = planChain(FULL, 640, 360, undefined, [gpu('colorGrade')])!
    expect([plan.contentWidth, plan.contentHeight]).toEqual([640, 360])
    expect(plan.pxPerStagePx[0]).toBeCloseTo(1 / 3)
  })

  it('crops before sizing', () => {
    const plan = planChain(FULL, 1000, 1000, { x: 0, y: 0, width: 0.5, height: 0.5 }, [gpu('colorGrade')])!
    expect([plan.contentWidth, plan.contentHeight]).toEqual([500, 500])
  })

  it('caps the long side', () => {
    const big = { x: 0, y: 0, width: 8000, height: 4000, rotation: 0 }
    const plan = planChain(big, 8000, 4000, undefined, [gpu('colorGrade')])!
    expect(plan.contentWidth).toBe(MAX_CHAIN_SIDE)
    expect(plan.contentHeight).toBe(MAX_CHAIN_SIDE / 2)
  })

  it('pads for bleeding effects and grows the placed rect around the same centre', () => {
    const rect = { x: 100, y: 50, width: 800, height: 400, rotation: 0.3 }
    const plan = planChain(rect, 800, 400, undefined, [gpu('gaussianBlur', { radius: 20 })])!
    expect(plan.padX).toBe(30)
    expect(plan.width).toBe(860)
    expect(plan.outRect.x + plan.outRect.width / 2).toBeCloseTo(rect.x + rect.width / 2)
    expect(plan.outRect.y + plan.outRect.height / 2).toBeCloseTo(rect.y + rect.height / 2)
    expect(plan.outRect.rotation).toBe(0.3)
  })

  it('caps the summed padding', () => {
    const plan = planChain(FULL, 1920, 1080, undefined, [
      gpu('gaussianBlur', { radius: 100 }),
      gpu('gaussianBlur', { radius: 100 }),
    ])!
    expect(plan.padX).toBe(MAX_CHAIN_PADDING)
  })

  it('refuses a zero-size box', () => {
    expect(planChain({ ...FULL, width: 0 }, 100, 100, undefined, [gpu('colorGrade')])).toBeNull()
  })
})

describe('EffectChain.draw', () => {
  let gl: RecordingGl
  let chain: EffectChain

  beforeEach(() => {
    gl = new RecordingGl()
    chain = new EffectChain()
  })

  function request(effects: ResolvedEffect[]) {
    // A real quad program is what the layers pass; ImageLayer builds one.
    const layer = new ImageLayer(loader)
    layer.acquire(image(), ctxFor(gl))
    const internals = layer as unknown as { _program: never; _vao: never }
    return {
      program: internals._program,
      vao: internals._vao,
      unit: 0,
      contentWidth: 1920,
      contentHeight: 1080,
      rect: FULL,
      opacity: 0.5,
      effects,
    }
  }

  it('does nothing for kinds with no GPU implementation', () => {
    expect(chain.draw(ctxFor(gl), request([{ id: 'x', kind: 'nope', params: {} }]))).toBe(false)
    expect(chain.runs).toBe(0)
  })

  it('captures, runs every pass, places, and restores GL state', () => {
    gl.viewport(10, 20, 300, 200)
    gl.clearColor(0.1, 0.2, 0.3, 1)
    const draws = vi.spyOn(gl, 'drawArrays')
    const fbos = vi.spyOn(gl, 'bindFramebuffer')

    const ok = chain.draw(ctxFor(gl), request([fx('colorGrade'), fx('gaussianBlur')]))

    expect(ok).toBe(true)
    // capture + colorGrade (1) + blur (2) + place
    expect(draws).toHaveBeenCalledTimes(5)
    expect(fbos.mock.calls.at(-1)?.[1]).toBeNull()
    expect(Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)).toEqual([10, 20, 300, 200])
    expect(Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)).toEqual([
      expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3), 1,
    ])
    // Both targets returned to the pool for the next clip.
    expect(chain.pool.freeCount).toBe(2)
    expect(chain.runs).toBe(1)
  })

  it('reuses its targets frame after frame', () => {
    const create = vi.spyOn(gl, 'createFramebuffer')
    const req = request([fx('vignette')])
    chain.draw(ctxFor(gl), req)
    chain.draw(ctxFor(gl, undefined, 1), req)
    chain.draw(ctxFor(gl, undefined, 2), req)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('falls back (returns false) when the pool cannot supply two targets', () => {
    const starved = new EffectChain(new FramebufferPool({ maxLive: 2 }))
    const pool = starved.pool
    pool.acquire(gl as unknown as WebGL2RenderingContext, 5, 5)
    expect(starved.draw(ctxFor(gl), request([fx('vignette')]))).toBe(false)
  })
})

describe('FramebufferPool', () => {
  it('keeps at most maxFree idle targets, oldest evicted first', () => {
    const gl = new RecordingGl() as unknown as WebGL2RenderingContext
    const pool = new FramebufferPool({ maxLive: 10, maxFree: 2 })
    const a = pool.acquire(gl, 10, 10)!
    const b = pool.acquire(gl, 20, 20)!
    const c = pool.acquire(gl, 30, 30)!
    pool.release(gl, a)
    pool.release(gl, b)
    pool.release(gl, c)
    expect(pool.freeCount).toBe(2)
    expect(pool.acquire(gl, 10, 10)).not.toBe(a)
    expect(pool.acquire(gl, 30, 30)).toBe(c)
  })
})

describe('layer bypass and EffectChainHash', () => {
  it('a clip without effects issues the same calls with or without a chain', async () => {
    const plain = await renderImage(image(), false)
    const chained = await renderImage(image(), true)
    expect(chained.digest).toBe(plain.digest)
    expect(chained.chain.runs).toBe(0)
  })

  it('a clip with effects goes through the chain', async () => {
    const { chain } = await renderImage(image({ effects: [fx('colorGrade')] }), true)
    expect(chain.runs).toBe(1)
  })

  it('without a chain in the context, a clip with effects draws plainly', async () => {
    const plain = await renderImage(image(), false)
    const noChain = await renderImage(image({ effects: [fx('colorGrade')] }), false)
    expect(noChain.digest).toBe(plain.digest)
  })

  it('the same frame always produces the same call log', async () => {
    const item = image({ effects: [fx('colorGrade', { saturation: 0 }), fx('gaussianBlur', { radius: 8 })] })
    const first = await renderImage(item, true)
    const second = await renderImage(item, true)
    expect(second.digest).toBe(first.digest)
  })

  it('a param change changes the call log', async () => {
    const a = await renderImage(image({ effects: [fx('vignette', { amount: 0.2 })] }), true)
    const b = await renderImage(image({ effects: [fx('vignette', { amount: 0.8 })] }), true)
    expect(b.digest).not.toBe(a.digest)
  })
})
