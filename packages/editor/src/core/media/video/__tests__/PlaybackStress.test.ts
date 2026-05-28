import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip, Scene } from '../../../resolver/scene'
import type { VideoFrameProvider } from '../VideoFrameProvider'
import { VideoDecoderManager } from '../VideoDecoderManager'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

// ---------------------------------------------------------------------------
// WebGL + DOM stubs
// ---------------------------------------------------------------------------

function makeCanvas(): HTMLCanvasElement {
  return {
    tagName: 'CANVAS',
    width: 1280,
    height: 720,
    style: {},
    remove: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement
}

const mockCanvas = makeCanvas()
let mockGL: WebGL2RenderingContext

function createMockGL(): WebGL2RenderingContext {
  return {
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE0: 0x84c0,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createTexture: vi.fn(() => ({})),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    createVertexArray: vi.fn(() => ({})),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createProgram: vi.fn(() => ({})),
    deleteProgram: vi.fn(),
    createShader: vi.fn(() => ({})),
    deleteShader: vi.fn(),
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
  } as unknown as WebGL2RenderingContext
}

vi.mock('../../../renderer/gpu/WebGLContext', () => ({
  WebGLContext: vi.fn().mockImplementation(() => ({
    canvas: mockCanvas,
    get gl() {
      return mockGL
    },
    isLost: false,
    isWebGL2: true,
    resize: vi.fn(),
    clear: vi.fn(),
    setClearColor: vi.fn(),
    dispose: vi.fn(),
  })),
}))

import { GpuRenderer } from '../../../renderer/gpu/GpuRenderer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(videos: ActiveVideoClip[], frame = 0): Scene {
  return {
    frame,
    fps: 30,
    stage: { width: 1280, height: 720 },
    videos,
    audios: [],
    texts: [],
    images: [],
    transitions: [],
  }
}

function makeClip(id: string, src = 'video://shared'): ActiveVideoClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    type: 'video',
    src,
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    volume: 1,
  }
}

function mockFrame(): VideoFrame {
  const frame = {
    displayWidth: 640,
    displayHeight: 360,
    close: vi.fn(),
    // VideoLayer.draw() clones cached frames before upload — mirror that.
    clone: vi.fn(() => mockFrame()),
  }
  return frame as unknown as VideoFrame
}

function createStressProvider() {
  const cache = new Map<number, VideoFrame>()
  let disposed = false

  const provider: VideoFrameProvider = {
    getCurrent(sourceFrame: number) {
      return cache.get(sourceFrame) ?? null
    },
    setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }) {
      const lookahead = opts?.lookaheadFrames ?? 4
      for (let i = 0; i <= lookahead; i++) {
        const f = sourceFrame + i
        if (!cache.has(f)) {
          cache.set(f, mockFrame())
        }
      }
    },
    markIdle: vi.fn(),
    markActive: vi.fn(),
    dispose: vi.fn(() => {
      disposed = true
      cache.clear()
    }),
  }

  return { provider, isDisposed: () => disposed }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Playback stress', () => {
  let container: HTMLElement

  beforeEach(() => {
    mockGL = createMockGL()
    vi.useFakeTimers()

    container = {
      tagName: 'DIV',
      clientWidth: 1280,
      clientHeight: 720,
      style: {},
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    } as unknown as HTMLElement
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('survives 200 rapid render calls with random sourceFrame', () => {
    const stress = createStressProvider()
    const renderer = new GpuRenderer({
      maxTextures: 8,
      providerFactory: () => stress.provider,
    })
    renderer.mount(container)

    const clip = makeClip('clip-a')

    for (let i = 0; i < 200; i++) {
      const sourceFrame = (i * 17) % 120
      expect(() =>
        renderer.render(makeScene([{ ...clip, sourceFrame }], sourceFrame)),
      ).not.toThrow()
    }

    renderer.dispose()
    expect(stress.provider.dispose).toHaveBeenCalledTimes(1)
  })

  it('clip enter/leave cycles keep texture count bounded', () => {
    const stress = createStressProvider()
    const renderer = new GpuRenderer({
      providerFactory: () => stress.provider,
    })
    renderer.mount(container)

    const layer = renderer.videoLayer!

    for (let i = 0; i < 50; i++) {
      renderer.render(makeScene([makeClip(`clip-${i % 3}`)], i))
      renderer.render(makeScene([], i + 1))
    }

    expect(layer.getTextureCount()).toBe(0)
    renderer.dispose()
  })

  it('pool exhaustion does not crash renderer', () => {
    const stress = createStressProvider()
    const renderer = new GpuRenderer({
      maxTextures: 2,
      providerFactory: () => stress.provider,
    })
    renderer.mount(container)

    const clips = Array.from({ length: 10 }, (_, i) =>
      makeClip(`clip-${i}`, `video://${i}`),
    )

    expect(() => renderer.render(makeScene(clips))).not.toThrow()
    expect(renderer.videoLayer!.getTextureCount()).toBe(10)

    renderer.dispose()
  })

  it('provider ref count returns to zero after clip release', () => {
    const stress = createStressProvider()
    const renderer = new GpuRenderer({
      providerFactory: () => stress.provider,
    })
    renderer.mount(container)
    const layer = renderer.videoLayer!
    const src = 'video://shared'

    for (let i = 0; i < 100; i++) {
      renderer.render(makeScene([makeClip(`clip-${i}`, src)], i))
      renderer.render(makeScene([], i + 1))
    }

    expect(layer.getProviderRefCount(src)).toBe(0)
    renderer.dispose()
  })

  it('multiple render calls per frame remain stable', () => {
    const stress = createStressProvider()
    const renderer = new GpuRenderer({
      providerFactory: () => stress.provider,
    })
    renderer.mount(container)

    const sceneA = makeScene([makeClip('a')], 0)
    const sceneB = makeScene([makeClip('a', 'video://other')], 1)

    for (let i = 0; i < 20; i++) {
      renderer.render(sceneA)
      renderer.render(sceneB)
    }

    expect(renderer.videoLayer!.getTextureCount()).toBeLessThanOrEqual(2)
    renderer.dispose()
  })

  it('rapid reset spam keeps decoder in Ready without Errored', async () => {
    const demuxerBackend = createMockDemuxerBackend({
      chunks: [createMockChunk()],
    })
    const manager = new VideoDecoderManager({
      demuxerFactory: () => demuxerBackend,
      decoderFactory: createMockDecoder().factory,
    })

    await manager.open('video://test')

    const targetUs = [0, 50 * 33333, 100 * 33333]
    for (let i = 0; i < 10; i++) {
      if (manager.state === 'Ready') {
        try {
          await manager.reset(targetUs[i % targetUs.length]!)
        } catch {
          // reset from wrong state — ignore
        }
      }
    }

    expect(manager.state).not.toBe('Errored')
    expect(['Ready', 'Resetting']).toContain(manager.state)
  })

  it('play/pause spam via acquire/release does not double-dispose providers', () => {
    const stress = createStressProvider()
    const renderer = new GpuRenderer({
      providerFactory: () => stress.provider,
    })
    renderer.mount(container)

    for (let i = 0; i < 50; i++) {
      renderer.render(makeScene([makeClip('clip-a')], i))
      renderer.render(makeScene([], i))
    }

    renderer.dispose()
    expect(stress.provider.dispose).toHaveBeenCalledTimes(1)
  })
})
