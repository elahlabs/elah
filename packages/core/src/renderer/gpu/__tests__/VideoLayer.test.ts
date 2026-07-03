import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { TexturePool } from '../TexturePool'
import type { VideoFrameProvider } from '../../../media/video'
import { VideoLayer } from '../layers/VideoLayer'

// ---------------------------------------------------------------------------
// Minimal WebGL2 mock
// ---------------------------------------------------------------------------

function createMockGL(): WebGL2RenderingContext {
  const textures = new Set<object>()
  const vaos = new Set<object>()
  const programs = new Set<object>()
  const shaders = new Set<object>()

  const gl = {
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE0: 0x84c0,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,

    createTexture: vi.fn(() => {
      const tex = {}
      textures.add(tex)
      return tex
    }),
    deleteTexture: vi.fn((tex: object) => textures.delete(tex)),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),

    createVertexArray: vi.fn(() => {
      const vao = {}
      vaos.add(vao)
      return vao
    }),
    deleteVertexArray: vi.fn((vao: object) => vaos.delete(vao)),
    bindVertexArray: vi.fn(),

    createProgram: vi.fn(() => {
      const prog = {}
      programs.add(prog)
      return prog
    }),
    deleteProgram: vi.fn((p: object) => programs.delete(p)),
    createShader: vi.fn(() => {
      const s = {}
      shaders.add(s)
      return s
    }),
    deleteShader: vi.fn((s: object) => shaders.delete(s)),
    attachShader: vi.fn(),
    detachShader: vi.fn(),
    linkProgram: vi.fn(),
    compileShader: vi.fn(),
    shaderSource: vi.fn(),
    useProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getShaderParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    getShaderInfoLog: vi.fn(() => ''),
    getUniformLocation: vi.fn(() => ({})),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    activeTexture: vi.fn(),
    drawArrays: vi.fn(),
  }

  return gl as unknown as WebGL2RenderingContext
}

function makeMockProvider(): VideoFrameProvider & {
  getCurrent: ReturnType<typeof vi.fn>
  setPlayhead: ReturnType<typeof vi.fn>
  markIdle: ReturnType<typeof vi.fn>
  markActive: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  return {
    getCurrent: vi.fn(() => null),
    setPlayhead: vi.fn(),
    markIdle: vi.fn(),
    markActive: vi.fn(),
    dispose: vi.fn(),
  }
}

function mockFrame(): VideoFrame {
  const frame = {
    close: vi.fn(),
    displayWidth: 640,
    displayHeight: 360,
    // VideoLayer.draw() clones the cached frame before handing it to
    // VideoTexture.upload() (which consumes it). clone() must return an
    // independent reference per the WebCodecs spec.
    clone: vi.fn(() => mockFrame()),
  }
  return frame as unknown as VideoFrame
}

function makeClip(overrides: Partial<ActiveVideoClip> = {}): ActiveVideoClip {
  return {
    id: 'clip-a',
    trackId: 'track-1',
    name: 'Clip A',
    type: 'video',
    src: 'video://asset-1',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    volume: 1,
    ...overrides,
  }
}

function makeCtx(gl: WebGL2RenderingContext): LayerContext {
  return {
    gl,
    frame: 0,
    stage: { width: 1280, height: 720 },
    viewport: { width: 1280, height: 720 },
    fps: 30,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoLayer', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext
  let pool: TexturePool
  let provider: ReturnType<typeof makeMockProvider>
  let layer: VideoLayer

  beforeEach(() => {
    gl = createMockGL()
    ctx = makeCtx(gl)
    pool = new TexturePool({ maxTextures: 8 })
    provider = makeMockProvider()
    layer = new VideoLayer(pool, () => provider)
  })

  it('creates independent providers per clip even when src is shared', () => {
    // Each clip must own a separate StreamingFrameProducer so that copy-pasted
    // clips (same src, different startFrame) never share a playhead — otherwise
    // the transition from clip A → clip B triggers a backwards seek on a shared
    // producer, stalling decode until the async reset completes.
    const providerA = makeMockProvider()
    const providerB = makeMockProvider()
    let callCount = 0
    const providers = [providerA, providerB]
    layer = new VideoLayer(pool, () => providers[callCount++])

    const clipA = makeClip({ id: 'clip-a', src: 'video://shared' })
    const clipB = makeClip({ id: 'clip-b', src: 'video://shared' })

    layer.acquire(clipA, ctx)
    layer.acquire(clipB, ctx)

    expect(layer.getProviderCount()).toBe(2)
    expect(providerA.markActive).toHaveBeenCalledTimes(1)
    expect(providerB.markActive).toHaveBeenCalledTimes(1)
    expect(layer.getProviderForItemId('clip-a')).toBe(providerA)
    expect(layer.getProviderForItemId('clip-b')).toBe(providerB)
  })

  it('allocates one texture handle per clip', () => {
    const clipA = makeClip({ id: 'clip-a' })
    const clipB = makeClip({ id: 'clip-b', src: 'video://other' })

    const providerB = makeMockProvider()
    const providersBySrc = new Map<string, VideoFrameProvider>([
      ['video://asset-1', provider],
      ['video://other', providerB],
    ])
    layer = new VideoLayer(pool, (src) => providersBySrc.get(src)!)

    layer.acquire(clipA, ctx)
    layer.acquire(clipB, ctx)

    expect(layer.getTextureCount()).toBe(2)
  })

  it('draw() remains synchronous', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)

    const result = layer.draw(clip, ctx)
    expect(result).toBeUndefined()
  })

  it('unavailable frame path keeps previous texture and calls setPlayhead()', () => {
    const clip = makeClip({ sourceFrame: 42 })
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(null)
    layer.draw(clip, ctx)

    expect(provider.setPlayhead).toHaveBeenCalledWith(42)
    expect(provider.getCurrent).toHaveBeenCalledWith(42)
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('available frame path uploads texture and draws quad', () => {
    const clip = makeClip({ sourceFrame: 10, opacity: 0.9 })
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)

    expect(gl.texImage2D).toHaveBeenCalled()
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.9)
  })

  it('forwards opacity uniforms correctly', () => {
    const clip = makeClip({ opacity: 0.45 })
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)

    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.45)
  })

  it('forwards transform uniforms correctly', () => {
    const clip = makeClip({
      transform: {
        x: 0.25,
        y: 0.5,
        scale: 0.5,
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
      },
    })
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)

    expect(gl.uniformMatrix3fv).toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.any(Float32Array),
    )
  })

  it('release() cleans clip resources and marks provider idle at zero refCount', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)

    layer.release(clip.id)

    expect(layer.getProviderRefCount(clip.id)).toBe(0)
    expect(provider.markIdle).toHaveBeenCalledTimes(1)

    layer.draw(clip, ctx)
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('dispose() disposes providers and releases texture handles safely', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)

    layer.dispose()

    expect(provider.dispose).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(0)
    expect(gl.deleteVertexArray).toHaveBeenCalled()
    expect(gl.deleteProgram).toHaveBeenCalled()
  })

  it('prewarm() creates a provider and pushes the future playhead without drawing', () => {
    const upcoming = makeClip({ id: 'clip-a', sourceFrame: 90 })

    layer.prewarm([upcoming], ctx)

    // Provider created and warmed to the future source frame — but nothing drawn.
    expect(layer.getProviderCount()).toBe(1)
    expect(provider.markActive).toHaveBeenCalledTimes(1)
    expect(provider.setPlayhead).toHaveBeenCalledWith(90)
    expect(gl.drawArrays).not.toHaveBeenCalled()
    // Still refCount 0 — draw() has not acquired it.
    expect(layer.getProviderRefCount('clip-a')).toBe(0)
  })

  it('acquire() reuses and promotes a prewarmed provider (no second provider)', () => {
    const clip = makeClip({ id: 'clip-a', sourceFrame: 90 })

    layer.prewarm([clip], ctx)
    layer.acquire({ ...clip, sourceFrame: 100 }, ctx)

    // Same provider instance reused — the warm decoder is kept.
    expect(layer.getProviderCount()).toBe(1)
    expect(layer.getProviderForItemId('clip-a')).toBe(provider)
    expect(layer.getProviderRefCount('clip-a')).toBe(1)
    // markActive called once by prewarm, once by acquire.
    expect(provider.markActive).toHaveBeenCalledTimes(2)
  })

  it('prewarm() drops a still-un-drawn provider once it falls out of the horizon', () => {
    const clip = makeClip({ id: 'clip-a', sourceFrame: 90 })

    layer.prewarm([clip], ctx)
    expect(layer.getProviderCount()).toBe(1)

    // Next tick: horizon no longer includes clip-a (user scrubbed away).
    layer.prewarm([], ctx)

    expect(layer.getProviderCount()).toBe(0)
    expect(provider.dispose).toHaveBeenCalledTimes(1)
  })

  it('prewarm() never disturbs an already-active (drawn) clip', () => {
    const clip = makeClip({ id: 'clip-a', sourceFrame: 100 })
    layer.acquire(clip, ctx)
    provider.setPlayhead.mockClear()

    // A prewarm pass that still lists the active clip must not push a future
    // playhead onto it — that would seek it off the frame being drawn.
    layer.prewarm([{ ...clip, sourceFrame: 130 }], ctx)

    expect(provider.setPlayhead).not.toHaveBeenCalled()
    expect(provider.dispose).not.toHaveBeenCalled()
    expect(layer.getProviderRefCount('clip-a')).toBe(1)
  })

  it('does not import decoder, PlaybackEngine, or React modules', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(__dirname, '../layers/VideoLayer.ts'), 'utf8')

    const forbidden = [
      'PlaybackEngine',
      'TimelineEngine',
      'zustand',
      'react',
      'MediaBunny',
      'VideoDecoder',
      'VideoDecoderManager',
    ]

    const importLines = source.match(/^import .+$/gm) ?? []
    for (const name of forbidden) {
      for (const line of importLines) {
        expect(line).not.toContain(name)
      }
    }
  })
})
