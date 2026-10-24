import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveRotoMask } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { RotoMaskLayer } from '../layers/RotoMaskLayer'
import { RotoMaskFrameProvider, type RotoMaskImage } from '../../../media/masks/RotoMaskFrameProvider'

// ---------------------------------------------------------------------------
// Minimal WebGL2 mock (copied from ImageLayer.test.ts — every layer spec keeps its own).
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
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE0: 0x84c0,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,

    createTexture: vi.fn(() => {
      const tex = {}
      textures.add(tex)
      return tex
    }),
    deleteTexture: vi.fn((tex: object) => textures.delete(tex)),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    pixelStorei: vi.fn(),

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

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function makeItem(overrides: Partial<ActiveRotoMask> = {}): ActiveRotoMask {
  return {
    id: 'c1:roto',
    clipId: 'c1',
    trackId: 't1',
    sourceFrame: 0,
    frameUrlTemplate: '/m/{frame}',
    frameCount: 24,
    width: 1920,
    height: 1080,
    mode: 'overlay',
    color: [1, 0, 0],
    opacity: 0.5,
    zIndex: 0.5,
    ...overrides,
  }
}

function makeCtx(gl: WebGL2RenderingContext): LayerContext {
  return { gl, frame: 0, stage: { width: 1920, height: 1080 }, viewport: { width: 1920, height: 1080 }, fps: 24 }
}

describe('RotoMaskLayer', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext
  let loader: ReturnType<typeof vi.fn>
  let layer: RotoMaskLayer

  beforeEach(() => {
    gl = createMockGL()
    ctx = makeCtx(gl)
    loader = vi.fn(async (url: string) => new Blob([url]))
    const decode = async (): Promise<RotoMaskImage> => ({ source: {} as TexImageSource, width: 1920, height: 1080 })
    layer = new RotoMaskLayer({
      providerFactory: (t, n) => new RotoMaskFrameProvider(t, n, { loader, decode, maxInFlight: 8 }),
      lookahead: 2,
    })
  })

  it('acquire allocates one texture and starts fetching the current frame plus lookahead', () => {
    layer.acquire(makeItem({ sourceFrame: 5 }), ctx)
    expect(layer.getTextureCount()).toBe(1)
    expect(loader.mock.calls.map((c) => c[0])).toEqual(['/m/5', '/m/6', '/m/7'])
  })

  it('draws nothing before the first frame arrives', () => {
    const item = makeItem()
    layer.acquire(item, ctx)
    layer.draw(item, ctx)
    expect(gl.texImage2D).not.toHaveBeenCalled()
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('uploads once the frame is cached, then draws with mode, colour and opacity uniforms', async () => {
    const item = makeItem()
    layer.acquire(item, ctx)
    await flush()
    layer.draw(item, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 0) // overlay
    expect(gl.uniform4f).toHaveBeenCalledWith(expect.anything(), 1, 0, 0, 1)
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.5)
    layer.draw(item, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1) // same frame, no re-upload
  })

  it('on a miss keeps drawing the last uploaded frame (I4)', async () => {
    const item = makeItem()
    layer.acquire(item, ctx)
    await flush()
    layer.draw(item, ctx)
    loader.mockImplementation(() => new Promise<Blob>(() => {})) // never resolves
    layer.draw(makeItem({ sourceFrame: 20 }), ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
  })

  it('draws nothing on a frame the provider knows is absent, instead of the previous frame mask', async () => {
    const item = makeItem()
    layer.acquire(item, ctx)
    await flush()
    layer.draw(item, ctx)
    expect(gl.drawArrays).toHaveBeenCalledTimes(1)

    // Frame 20 404s: an uncovered frame has no mask at all. Keeping the last
    // upload here is what made an uncovered frame show frame 0's mask.
    loader.mockImplementation(() => Promise.reject(new Error('404')))
    const missing = makeItem({ sourceFrame: 20 })
    layer.draw(missing, ctx) // kicks off the fetch
    await flush()
    layer.draw(missing, ctx) // now the provider knows it is absent
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2) // the second draw was skipped
  })

  it('matte mode sets uMode 1', async () => {
    const item = makeItem({ mode: 'matte' })
    layer.acquire(item, ctx)
    await flush()
    layer.draw(item, ctx)
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 1)
  })

  it('a new run on the same clip drops the old upload until the new frame loads', async () => {
    const item = makeItem()
    layer.acquire(item, ctx)
    await flush()
    layer.draw(item, ctx)
    const pending = new Promise<Blob>(() => {})
    loader.mockImplementation(() => pending)
    layer.draw(makeItem({ frameUrlTemplate: '/n/{frame}' }), ctx)
    expect(gl.drawArrays).toHaveBeenCalledTimes(1)
    expect(loader).toHaveBeenCalledWith('/n/0', expect.anything())
  })

  it('release deletes the texture; notifyContextLost clears handles without GL calls', () => {
    layer.acquire(makeItem(), ctx)
    layer.release('c1:roto')
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(0)

    layer.acquire(makeItem(), ctx)
    const before = (gl.deleteTexture as ReturnType<typeof vi.fn>).mock.calls.length
    layer.notifyContextLost()
    expect(layer.getTextureCount()).toBe(0)
    expect((gl.deleteTexture as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })
})
