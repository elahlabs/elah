import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip, Scene } from '../../../resolver/scene'
import type { VideoFrameProvider } from '../../../media/video'

// ---------------------------------------------------------------------------
// WebGL + DOM stubs
// ---------------------------------------------------------------------------

function makeCanvas(): HTMLCanvasElement {
  return {
    tagName: 'CANVAS',
    width: 1280,
    height: 720,
    style: {},
    appendChild: vi.fn(),
    remove: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement
}

const mockCanvas = makeCanvas()
let mockGL: WebGL2RenderingContext

function createMockGL(): WebGL2RenderingContext {
  const gl = {
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
    viewport: vi.fn(),
  }
  return gl as unknown as WebGL2RenderingContext
}

vi.mock('../WebGLContext', () => ({
  WebGLContext: vi.fn().mockImplementation(() => ({
    canvas: mockCanvas,
    get gl() {
      return mockGL
    },
    isLost: false,
    isWebGL2: true,
    resize: vi.fn((cssW: number, cssH: number, dpr = 1) => {
      mockCanvas.width = Math.round(cssW * dpr)
      mockCanvas.height = Math.round(cssH * dpr)
    }),
    clear: vi.fn(),
    setClearColor: vi.fn(),
    dispose: vi.fn(),
  })),
}))

import { GpuRenderer } from '../GpuRenderer'

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

function makeScene(frame: number, videos: ActiveVideoClip[]): Scene {
  return {
    frame,
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

function mockFrame(sourceFrame = 0): VideoFrame {
  const frame = {
    displayWidth: 640,
    displayHeight: 360,
    timestamp: sourceFrame * (1_000_000 / 30),
    close: vi.fn(),
    // VideoLayer.draw() clones cached frames before upload — mirror that.
    clone: vi.fn(() => mockFrame(sourceFrame)),
  }
  return frame as unknown as VideoFrame
}

function createTrackingProvider() {
  const getCurrentCalls: number[] = []
  const setPlayheadCalls: number[] = []
  const cache = new Map<number, VideoFrame>()

  const provider: VideoFrameProvider = {
    getCurrent(sourceFrame: number) {
      getCurrentCalls.push(sourceFrame)
      return cache.get(sourceFrame) ?? null
    },
    setPlayhead(sourceFrame: number, opts?: { lookaheadFrames?: number }) {
      setPlayheadCalls.push(sourceFrame)
      const lookahead = opts?.lookaheadFrames ?? 8
      for (let i = 0; i <= lookahead; i++) {
        const f = sourceFrame + i
        if (!cache.has(f)) {
          cache.set(f, mockFrame(f))
        }
      }
    },
    markIdle: vi.fn(),
    markActive: vi.fn(),
    dispose: vi.fn(),
  }

  return { provider, getCurrentCalls, setPlayheadCalls, cache }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Render synchronization', () => {
  let container: HTMLElement
  let tracking: ReturnType<typeof createTrackingProvider>

  beforeEach(() => {
    mockGL = createMockGL()
    tracking = createTrackingProvider()

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
    vi.clearAllMocks()
  })

  function mountRenderer(): GpuRenderer {
    const renderer = new GpuRenderer({
      providerFactory: () => tracking.provider,
    })
    renderer.mount(container)
    return renderer
  }

  it('render() at frame 5 calls setPlayhead(5) on provider', () => {
    const renderer = mountRenderer()
    const clip = makeClip({ sourceFrame: 5 })
    const scene = makeScene(5, [clip])

    renderer.render(scene)

    expect(tracking.getCurrentCalls).toContain(5)
    expect(tracking.setPlayheadCalls).toContain(5)

    renderer.dispose()
  })

  it('scrubbing updates sourceFrame on each new scene', () => {
    const renderer = mountRenderer()
    const clip = makeClip()

    for (let frame = 0; frame <= 10; frame++) {
      tracking.getCurrentCalls.length = 0
      tracking.setPlayheadCalls.length = 0

      renderer.render(makeScene(frame, [{ ...clip, sourceFrame: frame }]))
      expect(tracking.getCurrentCalls).toEqual([frame])
    }

    renderer.dispose()
  })

  it('letterboxes: gl.viewport is set to the project-aspect inner rect', () => {
    const renderer = mountRenderer()

    // Canvas is 1280×720 (16:9). Render a portrait 1080×1920 (9:16) stage →
    // pillarbox: full height, narrower centred width.
    const portraitScene: Scene = {
      ...makeScene(0, [makeClip()]),
      stage: { width: 1080, height: 1920 },
    }
    renderer.render(portraitScene)

    const expectedWidth = Math.round(720 * (1080 / 1920)) // 405
    const expectedX = Math.round((1280 - expectedWidth) / 2)
    expect(mockGL.viewport).toHaveBeenCalledWith(expectedX, 0, expectedWidth, 720)

    renderer.dispose()
  })

  it('render() is idempotent on equal Scene references', () => {
    const renderer = mountRenderer()
    const scene = makeScene(0, [makeClip()])

    renderer.render(scene)
    const callsAfterFirst = tracking.getCurrentCalls.length

    renderer.render(scene)
    expect(tracking.getCurrentCalls.length).toBe(callsAfterFirst)

    renderer.dispose()
  })

  it('seek jump requests new sourceFrame without stale cache reuse', () => {
    const renderer = mountRenderer()
    const clip = makeClip()

    tracking.cache.set(0, mockFrame(0))
    renderer.render(makeScene(0, [{ ...clip, sourceFrame: 0 }]))

    tracking.getCurrentCalls.length = 0
    tracking.setPlayheadCalls.length = 0
    tracking.cache.clear()

    renderer.render(makeScene(60, [{ ...clip, sourceFrame: 60 }]))

    expect(tracking.getCurrentCalls).toEqual([60])
    // Frame 60 must be the first setPlayhead call on the jump.
    expect(tracking.setPlayheadCalls[0]).toBe(60)
    expect(tracking.setPlayheadCalls).not.toContain(0) // no stale frame 0
    expect(tracking.cache.has(0)).toBe(false)

    renderer.dispose()
  })

  it('context loss resets lastScene so next render re-acquires clips', () => {
    const renderer = mountRenderer()
    const scene = makeScene(0, [makeClip()])

    renderer.render(scene)
    const layer = renderer.videoLayer
    expect(layer?.getTextureCount()).toBe(1)

    ;(renderer as unknown as { _handleContextLost: () => void })._handleContextLost()

    tracking.getCurrentCalls.length = 0
    renderer.render(scene)

    expect(tracking.getCurrentCalls).toContain(0)
    expect(layer?.getTextureCount()).toBe(1)

    renderer.dispose()
  })

  it('scene frame matches clip sourceFrame during playback scrub', () => {
    const renderer = mountRenderer()
    const clip = makeClip({ id: 'clip-playback' })

    for (const frame of [0, 15, 30, 45, 60]) {
      const scene = makeScene(frame, [{ ...clip, sourceFrame: frame }])
      expect(scene.frame).toBe(frame)
      expect(scene.videos[0]!.sourceFrame).toBe(frame)

      renderer.render(scene)
      expect(tracking.getCurrentCalls[tracking.getCurrentCalls.length - 1]).toBe(frame)
    }

    renderer.dispose()
  })
})
