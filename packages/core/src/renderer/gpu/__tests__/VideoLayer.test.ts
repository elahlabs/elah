import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { TexturePool } from '../TexturePool'
import type { VideoFrameProvider } from '../../../media/video'
import { VideoLayer, buildVideoTransformMatrix } from '../layers/VideoLayer'

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

    it('hot-swaps provider and disposes old one when clip src changes', () => {
      const providersCreated: Array<{ src: string; provider: ReturnType<typeof makeMockProvider> }> = []
      const factory = (src: string) => {
        const provider = makeMockProvider()
        providersCreated.push({ src, provider })
        return provider
      }

      layer = new VideoLayer(pool, factory)
      const clipV1 = makeClip({ id: 'clip-1', src: 'blob:http://localhost/old-blob' })
      layer.acquire(clipV1, ctx)

      expect(providersCreated).toHaveLength(1)
      expect(providersCreated[0].src).toBe('blob:http://localhost/old-blob')
      const firstProvider = providersCreated[0].provider

      // Now clip's src is updated (e.g. from IndexedDB recovery)
      const clipV2 = makeClip({ id: 'clip-1', src: 'blob:http://localhost/fresh-blob' })
      layer.acquire(clipV2, ctx)

      expect(firstProvider.dispose).toHaveBeenCalledTimes(1)
      expect(providersCreated).toHaveLength(2)
      expect(providersCreated[1].src).toBe('blob:http://localhost/fresh-blob')
      expect(layer.getProviderForItemId('clip-1')).toBe(providersCreated[1].provider)
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

  // Регресія: клік по лінійці — це один «брудний» тік. Якщо шар мовчить про
  // промах кеша, цикл засинає на попередньому кадрі, і прев'ю назавжди
  // відстає на один перехід.
  it('reports an awaited frame when the cache misses, and stops once it arrives', () => {
    const clip = makeClip({ sourceFrame: 120 })
    layer.acquire(clip, ctx)

    expect(layer.isAwaitingFrames).toBe(false)

    provider.getCurrent.mockReturnValue(null)
    layer.draw(clip, ctx)
    expect(layer.isAwaitingFrames).toBe(true)

    provider.getCurrent.mockReturnValue(mockFrame())
    layer.draw(clip, ctx)
    expect(layer.isAwaitingFrames).toBe(false)
  })

  it('gives up on a frame that never arrives instead of holding the loop awake', () => {
    vi.useFakeTimers()
    try {
      const clip = makeClip({ sourceFrame: 9999 })
      layer.acquire(clip, ctx)
      provider.getCurrent.mockReturnValue(null)

      layer.draw(clip, ctx)
      expect(layer.isAwaitingFrames).toBe(true)

      // Довше за AWAIT_FRAME_TIMEOUT_MS: далі такий кліп уже не будить цикл.
      vi.advanceTimersByTime(5000)
      expect(layer.isAwaitingFrames).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('restarts the wait when the playhead moves to another frame', () => {
    vi.useFakeTimers()
    try {
      const clip = makeClip({ sourceFrame: 10 })
      layer.acquire(clip, ctx)
      provider.getCurrent.mockReturnValue(null)
      layer.draw(clip, ctx)

      vi.advanceTimersByTime(5000)
      expect(layer.isAwaitingFrames).toBe(false)

      layer.draw(makeClip({ sourceFrame: 11 }), ctx)
      expect(layer.isAwaitingFrames).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a released clip stops asking for frames', () => {
    const clip = makeClip({ sourceFrame: 42 })
    layer.acquire(clip, ctx)
    provider.getCurrent.mockReturnValue(null)
    layer.draw(clip, ctx)
    expect(layer.isAwaitingFrames).toBe(true)

    layer.release(clip.id)
    expect(layer.isAwaitingFrames).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Provider replacement, watch-set hygiene and borrowed-frame sizing
// ---------------------------------------------------------------------------

type Internals = {
  _textures: Map<string, { hasContent: boolean }>
  _openWatchedItemIds: Set<string>
}
const internals = (l: VideoLayer): Internals => l as unknown as Internals

function frameOfSize(width: number, height: number): VideoFrame {
  return { close: vi.fn(), displayWidth: width, displayHeight: height } as unknown as VideoFrame
}

describe('VideoLayer provider replacement and holdover', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext
  let pool: TexturePool

  beforeEach(() => {
    gl = createMockGL()
    ctx = makeCtx(gl)
    pool = new TexturePool({ maxTextures: 8 })
  })

  it('keeps the ref count and rebinds a live texture when a drawn clip changes src', () => {
    const onClipLoad = vi.fn()
    const providers: Array<ReturnType<typeof makeMockProvider>> = []
    const layer = new VideoLayer(
      pool,
      () => {
        const p = makeMockProvider()
        p.getCurrent.mockReturnValue(frameOfSize(640, 360))
        providers.push(p)
        return p
      },
      { onClipLoad },
    )

    const v1 = makeClip({ src: 'video://one' })
    layer.acquire(v1, ctx)
    layer.draw(v1, ctx)
    const oldTexture = internals(layer)._textures.get('clip-a')
    expect(oldTexture?.hasContent).toBe(true)
    expect(layer.getProviderRefCount('clip-a')).toBe(1)

    onClipLoad.mockClear()
    const v2 = makeClip({ src: 'video://two' })
    layer.draw(v2, ctx)

    expect(providers).toHaveLength(2)
    expect(providers[0].dispose).toHaveBeenCalledTimes(1)
    // The live clip is still drawn: its ref count must survive the swap.
    expect(layer.getProviderRefCount('clip-a')).toBe(1)
    expect(providers[1].markActive).toHaveBeenCalled()
    expect(onClipLoad).toHaveBeenCalledWith('clip-a', 'loading')

    // Frames land in a fresh, tracked texture — not the disposed one.
    const newTexture = internals(layer)._textures.get('clip-a')
    expect(newTexture).toBeDefined()
    expect(newTexture).not.toBe(oldTexture)
    expect(newTexture?.hasContent).toBe(true)
    expect(layer.getTextureCount()).toBe(1)
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
