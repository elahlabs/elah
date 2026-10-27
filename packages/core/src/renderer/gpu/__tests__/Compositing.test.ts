/**
 * EDX-P7: masks and blend modes — pure maths, chain routing and the
 * no-compositing bypass.
 */

import { describe, expect, it, vi } from 'vitest'
import { BLEND_MODES, type ClipMask } from '../../../types'
import { RecordingGl } from '../debug/RecordingGl'
import { EffectChain } from '../EffectChain'
import { CANVAS_COMPOSITE_OP, isDrawableMask, needsChain } from '../compositing'
import { BLEND_FRAG_SRC, BLEND_MODE_INDEX, MASK_FRAG, maskUniforms } from '../compositingGpu'
import { ImageLayer, type ImageLoader } from '../layers/ImageLayer'
import { __clearImageCacheForTests } from '../layers/imageCache'
import type { LayerContext } from '../layers/types'

const rect = (over: Partial<ClipMask> = {}): ClipMask => ({ kind: 'rect', x: 0, y: 0, width: 1, height: 1, ...over })

describe('needsChain', () => {
  it('only for effects, a drawable mask or a non-normal blend', () => {
    expect(needsChain({})).toBe(false)
    expect(needsChain({ effects: [] })).toBe(false)
    expect(needsChain({ blend: 'normal' })).toBe(false)
    expect(needsChain({ mask: { ...rect(), kind: 'path' } })).toBe(false)
    expect(needsChain({ effects: [{}] })).toBe(true)
    expect(needsChain({ mask: rect() })).toBe(true)
    expect(needsChain({ blend: 'screen' })).toBe(true)
  })

  it('draws rect, ellipse and gradient masks; path masks are stored only', () => {
    expect(isDrawableMask(rect())).toBe(true)
    expect(isDrawableMask(rect({ kind: 'ellipse' }))).toBe(true)
    expect(isDrawableMask(rect({ kind: 'gradient' }))).toBe(true)
    expect(isDrawableMask(rect({ kind: 'path' }))).toBe(false)
    expect(isDrawableMask(undefined)).toBe(false)
  })
})

describe('maskUniforms', () => {
  it('places the mask in box pixels, top-left origin, with feather from the shorter side', () => {
    // Box = 800×400 px inside a 1000×600 target.
    const u = maskUniforms(rect({ x: 0.25, y: 0.5, width: 0.5, height: 0.25, feather: 0.2 }), [0.1, 1 / 6, 0.8, 4 / 6], [1000, 600])
    expect(u.uBoxPx).toEqual([800, 400])
    expect(u.uHalf).toEqual([200, 50])
    expect(u.uCenter).toEqual([400, 250])
    expect(u.uFeather).toBeCloseTo(0.2 * 100)
    expect(u.uKind).toBe(0)
    expect(u.uInvert).toBe(0)
  })

  it('encodes kind, invert, rotation and gradient angle', () => {
    const u = maskUniforms(rect({ kind: 'gradient', invert: true, rotation: 0.3, angle: 1.2 }), [0, 0, 1, 1], [100, 100])
    expect(u).toMatchObject({ uKind: 2, uInvert: 1, uRotation: 0.3, uAngle: 1.2 })
  })

  it('declares every uniform it sets', () => {
    for (const name of Object.keys(maskUniforms(rect(), [0, 0, 1, 1], [10, 10]))) {
      expect(MASK_FRAG).toMatch(new RegExp(`uniform \\w+ ${name};`))
    }
  })
})

describe('blend tables', () => {
  it('cover every blend mode, in shader and in export', () => {
    for (const mode of BLEND_MODES) {
      expect(BLEND_MODE_INDEX[mode]).toBeTypeOf('number')
      expect(CANVAS_COMPOSITE_OP[mode]).toBeTypeOf('string')
    }
    expect(new Set(Object.values(BLEND_MODE_INDEX)).size).toBe(BLEND_MODES.length)
    expect(BLEND_FRAG_SRC).toContain('uniform sampler2D uBackdrop;')
  })
})

// ---------------------------------------------------------------------------
// Routing through ImageLayer + EffectChain on RecordingGl
// ---------------------------------------------------------------------------

const loader: ImageLoader = () => Promise.resolve({ source: {} as TexImageSource, width: 1920, height: 1080 })
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function draw(over: Record<string, unknown>, withChain = true) {
  __clearImageCacheForTests()
  const gl = new RecordingGl()
  gl.viewport(0, 0, 960, 540)
  const chain = new EffectChain()
  const ctx: LayerContext = {
    gl: gl as unknown as WebGL2RenderingContext,
    frame: 0,
    stage: { width: 1920, height: 1080 },
    viewport: { width: 960, height: 540 },
    fps: 30,
    ...(withChain ? { effectChain: chain } : {}),
  }
  const item = { id: 'i', trackId: 't', name: 'i', type: 'image' as const, src: 'blob://c', sourceFrame: 0, opacity: 1, zIndex: 0, ...over }
  const layer = new ImageLayer(loader)
  layer.acquire(item, ctx)
  await flush()
  const draws = vi.spyOn(gl, 'drawArrays')
  const copies = vi.spyOn(gl, 'copyTexSubImage2D')
  gl.reset()
  // The stage viewport the renderer sets before drawing (reset() zeroed it).
  gl.viewport(0, 0, 960, 540)
  layer.draw(item, ctx)
  return { gl, chain, draws: draws.mock.calls.length, copies: copies.mock.calls.length, digest: await gl.digest() }
}

describe('chain routing', () => {
  it('a mask alone adds exactly one pass: capture + mask + place', async () => {
    const r = await draw({ mask: rect({ kind: 'ellipse', feather: 0.1 }) })
    expect(r.chain.runs).toBe(1)
    expect(r.draws).toBe(3)
    expect(r.copies).toBe(0)
  })

  it('a blend alone copies the backdrop once and places with the blend program', async () => {
    const r = await draw({ blend: 'multiply' })
    expect(r.chain.runs).toBe(1)
    expect(r.draws).toBe(2)
    expect(r.copies).toBe(1)
  })

  it('normal blend and an empty path mask leave the plain draw untouched', async () => {
    const plain = await draw({}, false)
    const normal = await draw({ blend: 'normal', mask: rect({ kind: 'path', path: '' }) })
    expect(normal.chain.runs).toBe(0)
    expect(normal.digest).toBe(plain.digest)
  })
})

// ---------------------------------------------------------------------------
// EDX-P7c: element-relative masks and path masks
// ---------------------------------------------------------------------------

describe('mask frames (text/shape boxes)', () => {
  it('measures the mask in the frame, not the whole box', () => {
    // Content box 1000×500; the element occupies 200×100 at (400, 200).
    const frame = { x: 400, y: 200, width: 200, height: 100, rotation: 0 }
    const u = maskUniforms(rect({ x: 0.5, y: 0, width: 0.5, height: 1 }), [0, 0, 1, 1], [1000, 500], frame)
    expect(u.uHalf).toEqual([50, 50])
    expect(u.uCenter).toEqual([550, 250])
  })

  it('turns the mask with a rotated frame', () => {
    const frame = { x: 0, y: 0, width: 200, height: 100, rotation: Math.PI / 2 }
    const u = maskUniforms(rect({ x: 0.5, y: 0, width: 0.5, height: 1 }), [0, 0, 1, 1], [1000, 1000], frame)
    // Offset (+50, 0) from the frame centre (100, 50) turns to (0, +50).
    const [cx, cy] = u.uCenter as number[]
    expect(cx).toBeCloseTo(100)
    expect(cy).toBeCloseTo(100)
    expect(u.uRotation).toBeCloseTo(Math.PI / 2)
  })
})

describe('path masks', () => {
  it('are drawable only with path data, and map to kind 3', () => {
    expect(isDrawableMask(rect({ kind: 'path' }))).toBe(false)
    expect(isDrawableMask(rect({ kind: 'path', path: '  ' }))).toBe(false)
    expect(isDrawableMask(rect({ kind: 'path', path: 'M0 0 L100 0 L50 100 Z' }))).toBe(true)
    expect(maskUniforms(rect({ kind: 'path', path: 'M0 0' }), [0, 0, 1, 1], [10, 10]).uKind).toBe(3)
    expect(MASK_FRAG).toContain('uniform sampler2D uPath;')
  })
})
