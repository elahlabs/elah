import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip, Scene } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { RenderGraph } from '../RenderGraph'
import { TexturePool } from '../TexturePool'
import type { VideoFrameProvider } from '../../../media/video'
import { VideoLayer, buildVideoTransformMatrix } from '../layers/VideoLayer'
import { videoUploadProbe } from '../layers/videoUploadProbe'

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
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
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
    videoUploadProbe.forgetAll()
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

  it('opens a new provider when a released clip comes back on another source', () => {
    // The reload case: the clip first loads with the dead blob: URL of the old
    // page, then is re-pointed at the reopened local file under the same id.
    const dead = makeMockProvider()
    const live = makeMockProvider()
    const bySrc = new Map<string, VideoFrameProvider>([
      ['blob:dead', dead],
      ['blob:live', live],
    ])
    layer = new VideoLayer(pool, (src) => bySrc.get(src)!)

    layer.acquire(makeClip({ id: 'clip-a', src: 'blob:dead' }), ctx)
    layer.release('clip-a')
    layer.acquire(makeClip({ id: 'clip-a', src: 'blob:live' }), ctx)

    expect(layer.getProviderForItemId('clip-a')).toBe(live)
    expect(dead.dispose).toHaveBeenCalledTimes(1)
    expect(layer.getProviderCount()).toBe(1)
  })

  it('keeps the warm provider when a released clip comes back on the same source', () => {
    layer.acquire(makeClip({ id: 'clip-a' }), ctx)
    layer.release('clip-a')
    layer.acquire(makeClip({ id: 'clip-a' }), ctx)

    expect(layer.getProviderForItemId('clip-a')).toBe(provider)
    expect(provider.dispose).not.toHaveBeenCalled()
  })

  it('prewarm replaces an idle provider opened on another source', () => {
    const dead = makeMockProvider()
    const live = makeMockProvider()
    const bySrc = new Map<string, VideoFrameProvider>([
      ['blob:dead', dead],
      ['blob:live', live],
    ])
    layer = new VideoLayer(pool, (src) => bySrc.get(src)!)

    layer.prewarm([makeClip({ id: 'clip-a', src: 'blob:dead' })], ctx)
    layer.prewarm([makeClip({ id: 'clip-a', src: 'blob:live' })], ctx)

    expect(layer.getProviderForItemId('clip-a')).toBe(live)
    expect(dead.dispose).toHaveBeenCalledTimes(1)
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

  it('reports a clip drawn without a picture as pending, then clears it on upload and on release', () => {
    const clip = makeClip({ id: 'probe-clip', sourceFrame: 7 })
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(null)
    layer.draw(clip, ctx)
    expect(videoUploadProbe.pendingAt(0)).toEqual(['probe-clip'])

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)
    expect(videoUploadProbe.pendingAt(0)).toEqual([])

    provider.getCurrent.mockReturnValue(null)
    layer.draw(clip, { ...ctx, frame: 30 })
    expect(videoUploadProbe.pendingAt(30)).toEqual(['probe-clip'])
    layer.release('probe-clip')
    expect(videoUploadProbe.pendingAt(30)).toEqual([])
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

  it('always sets uCrop, zeroed when the clip has no crop', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)

    expect(gl.uniform4f).toHaveBeenCalledWith(expect.anything(), 0, 0, 0, 0)
  })

  it('forwards the clip crop rect as uCrop', () => {
    const clip = makeClip({ crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } })
    layer.acquire(clip, ctx)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)

    expect(gl.uniform4f).toHaveBeenCalledWith(expect.anything(), 0.1, 0.2, 0.5, 0.4)
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

  describe('onClipLoad', () => {
    it('reports loading on acquire and clears it on the first drawn frame', () => {
      const onClipLoad = vi.fn()
      layer = new VideoLayer(pool, () => provider, { onClipLoad })
      const clip = makeClip()

      layer.acquire(clip, ctx)
      expect(onClipLoad).toHaveBeenCalledWith('clip-a', 'loading')

      // No frame yet — the clip is still waiting, and nothing is reported.
      onClipLoad.mockClear()
      layer.draw(clip, ctx)
      expect(onClipLoad).not.toHaveBeenCalled()

      provider.getCurrent.mockReturnValue(mockFrame())
      layer.draw(clip, ctx)
      expect(onClipLoad).toHaveBeenCalledWith('clip-a', null)

      // Steady state: a drawing clip reports nothing further.
      onClipLoad.mockClear()
      layer.draw(clip, ctx)
      layer.draw(clip, ctx)
      expect(onClipLoad).not.toHaveBeenCalled()
    })

    it('clears the clip on release', () => {
      const onClipLoad = vi.fn()
      layer = new VideoLayer(pool, () => provider, { onClipLoad })
      const clip = makeClip()

      layer.acquire(clip, ctx)
      onClipLoad.mockClear()

      layer.release('clip-a')
      expect(onClipLoad).toHaveBeenCalledWith('clip-a', null)
    })

    it('reports an error when the container fails to open', async () => {
      const onClipLoad = vi.fn()
      const failing = makeMockProvider()
      let settleOpen!: () => void
      const opening = new Promise<void>((resolve) => {
        settleOpen = resolve
      })
      // Mirrors StreamingFrameProducer: the open promise swallows its own
      // rejection into `openError` and resolves.
      Object.defineProperty(failing, 'openPromise', { get: () => opening })
      let openError: Error | null = null
      Object.defineProperty(failing, 'openError', { get: () => openError })

      layer = new VideoLayer(pool, () => failing, { onClipLoad })
      layer.acquire(makeClip(), ctx)
      expect(onClipLoad).toHaveBeenCalledWith('clip-a', 'loading')

      onClipLoad.mockClear()
      openError = new Error('no video track')
      settleOpen()
      await opening

      expect(onClipLoad).toHaveBeenCalledWith('clip-a', 'error')
    })

    it('watches the open promise once, not once per tick', () => {
      const onClipLoad = vi.fn()
      const watched = makeMockProvider()
      const opening = Promise.resolve()
      const then = vi.spyOn(opening, 'then')
      Object.defineProperty(watched, 'openPromise', { get: () => opening })

      layer = new VideoLayer(pool, () => watched, { onClipLoad })
      const clip = makeClip()
      layer.acquire(clip, ctx)
      layer.acquire(clip, ctx)
      layer.acquire(clip, ctx)

      expect(then).toHaveBeenCalledTimes(1)
    })
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

// ---------------------------------------------------------------------------
// Provider replacement, watch-set hygiene and borrowed-frame sizing
// (ported from the open-source VideoLayer.test.ts, commit e4d1c88)
// ---------------------------------------------------------------------------

type Internals = {
  _textures: Map<string, { hasContent: boolean }>
  _openWatchedItemIds: Set<string>
}
const internals = (l: VideoLayer): Internals => l as unknown as Internals

function frameOfSize(width: number, height: number): VideoFrame {
  return { close: vi.fn(), displayWidth: width, displayHeight: height } as unknown as VideoFrame
}

function sceneOf(videos: ActiveVideoClip[]): Scene {
  return {
    frame: 0,
    fps: 30,
    stage: { width: 1280, height: 720 },
    videos,
    audios: [],
    texts: [],
    images: [],
    shapes: [],
    freehand: [],
    transitions: [],
  }
}

describe('VideoLayer provider replacement and holdover', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext
  let pool: TexturePool

  beforeEach(() => {
    videoUploadProbe.forgetAll()
    gl = createMockGL()
    ctx = makeCtx(gl)
    pool = new TexturePool({ maxTextures: 8 })
  })

  it('an active clip re-pointed between two renders ends on the new provider, old one disposed, refCount unchanged', () => {
    // Premium routes a src change through RenderGraph (release + acquire, see
    // RenderGraph._diff) rather than through VideoLayer.draw() as the
    // open-source layer does. This drives the real graph so the test covers the
    // path a render tick actually takes.
    const onClipLoad = vi.fn()
    const one = makeMockProvider()
    const two = makeMockProvider()
    const frameOne = frameOfSize(640, 360)
    const frameTwo = frameOfSize(640, 360)
    one.getCurrent.mockReturnValue(frameOne)
    two.getCurrent.mockReturnValue(frameTwo)
    const bySrc = new Map<string, VideoFrameProvider>([
      ['video://one', one],
      ['video://two', two],
    ])
    const layer = new VideoLayer(pool, (src) => bySrc.get(src)!, { onClipLoad })
    const graph = new RenderGraph()
    graph.registerLayer(layer, (s) => s.videos, (v) => v.id, (v) => v.zIndex)

    graph.execute(sceneOf([makeClip({ src: 'video://one' })]), ctx)
    const oldTexture = internals(layer)._textures.get('clip-a')
    expect(oldTexture?.hasContent).toBe(true)
    expect(layer.getProviderRefCount('clip-a')).toBe(1)

    onClipLoad.mockClear()
    const texImage = gl.texImage2D as unknown as { mock: { calls: unknown[][] } }
    texImage.mock.calls.length = 0
    graph.execute(sceneOf([makeClip({ src: 'video://two' })]), { ...ctx, frame: 1 })

    expect(layer.getProviderForItemId('clip-a')).toBe(two)
    expect(one.dispose).toHaveBeenCalledTimes(1)
    expect(two.dispose).not.toHaveBeenCalled()
    expect(layer.getProviderRefCount('clip-a')).toBe(1)
    expect(layer.getProviderCount()).toBe(1)
    expect(two.markActive).toHaveBeenCalled()
    expect(onClipLoad).toHaveBeenCalledWith('clip-a', 'loading')

    // The new source's frame lands in a fresh, tracked texture.
    const newTexture = internals(layer)._textures.get('clip-a')
    expect(newTexture).toBeDefined()
    expect(newTexture).not.toBe(oldTexture)
    expect(newTexture?.hasContent).toBe(true)
    expect(layer.getTextureCount()).toBe(1)
    // (The pool's storage allocation is a texImage2D too; only frame uploads count.)
    const uploadedFrames = texImage.mock.calls.filter((c) => c.length === 6).map((c) => c[5])
    expect(uploadedFrames).toEqual([frameTwo])
    expect(onClipLoad).toHaveBeenLastCalledWith('clip-a', null)
  })

  it('_disposeProvider clears the open-watch set and reports a null load state', () => {
    vi.useFakeTimers()
    try {
      const onClipLoad = vi.fn()
      const layer = new VideoLayer(
        pool,
        () => {
          const p = makeMockProvider()
          Object.defineProperty(p, 'openPromise', { get: () => new Promise<void>(() => {}) })
          return p
        },
        { onClipLoad, idleDisposeMs: 1000 },
      )
      const clip = makeClip()
      layer.acquire(clip, ctx)
      expect(internals(layer)._openWatchedItemIds.has('clip-a')).toBe(true)

      layer.release('clip-a')
      onClipLoad.mockClear()
      vi.advanceTimersByTime(1500)

      expect(layer.getProviderForItemId('clip-a')).toBeUndefined()
      expect(internals(layer)._openWatchedItemIds.has('clip-a')).toBe(false)
      expect(onClipLoad).toHaveBeenCalledWith('clip-a', null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports an error for a failed re-open after an idle eviction', async () => {
    vi.useFakeTimers()
    try {
      const onClipLoad = vi.fn()
      let openError: Error | null = null
      const layer = new VideoLayer(
        pool,
        () => {
          const p = makeMockProvider()
          Object.defineProperty(p, 'openPromise', { get: () => Promise.resolve() })
          Object.defineProperty(p, 'openError', { get: () => openError })
          return p
        },
        { onClipLoad, idleDisposeMs: 1000 },
      )
      const clip = makeClip()
      layer.acquire(clip, ctx)
      layer.release('clip-a')
      vi.advanceTimersByTime(1500)

      openError = new Error('boom')
      onClipLoad.mockClear()
      layer.acquire(clip, ctx)
      await Promise.resolve()
      await Promise.resolve()

      expect(onClipLoad).toHaveBeenLastCalledWith('clip-a', 'error')
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose() reports a null load state for every provider and clears the watch set', () => {
    const onClipLoad = vi.fn()
    const layer = new VideoLayer(
      pool,
      () => {
        const p = makeMockProvider()
        Object.defineProperty(p, 'openPromise', { get: () => new Promise<void>(() => {}) })
        return p
      },
      { onClipLoad },
    )
    layer.acquire(makeClip({ id: 'a' }), ctx)
    layer.acquire(makeClip({ id: 'b' }), ctx)
    onClipLoad.mockClear()

    layer.dispose()

    expect(onClipLoad).toHaveBeenCalledWith('a', null)
    expect(onClipLoad).toHaveBeenCalledWith('b', null)
    expect(internals(layer)._openWatchedItemIds.size).toBe(0)
  })

  it('fits a borrowed holdover frame by its own decoded size, not the stage', () => {
    const providerA = makeMockProvider()
    providerA.getCurrent.mockReturnValue(frameOfSize(400, 400))
    const providerB = makeMockProvider() // still decoding: getCurrent -> null
    const providers = [providerA, providerB]
    let n = 0
    const layer = new VideoLayer(pool, () => providers[n++])

    const clipA = makeClip({ id: 'clip-a', src: 'video://a' })
    const clipB = makeClip({ id: 'clip-b', src: 'video://b' })
    layer.acquire(clipA, ctx)
    layer.draw(clipA, ctx)
    layer.release('clip-a')

    layer.acquire(clipB, ctx)
    const setMatrix = gl.uniformMatrix3fv as unknown as { mock: { calls: unknown[][] } }
    setMatrix.mock.calls.length = 0
    layer.draw(clipB, ctx)

    expect(setMatrix.mock.calls).toHaveLength(1)
    const used = setMatrix.mock.calls[0][2] as Float32Array
    const fitted = buildVideoTransformMatrix(clipB, 1280, 720, 400, 400)
    const stretched = buildVideoTransformMatrix(clipB, 1280, 720, undefined, undefined)
    expect(Array.from(fitted)).not.toEqual(Array.from(stretched))
    expect(Array.from(used)).toEqual(Array.from(fitted))
  })
})
