import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveImageClip } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { ImageLayer, type ImageLoader, type LoadedImage } from '../layers/ImageLayer'
import { __clearImageCacheForTests } from '../layers/imageCache'

// ---------------------------------------------------------------------------
// Minimal WebGL2 mock (mirrors TextLayer.test.ts — same quad + premultiply path).
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
    uniformMatrix3fv: vi.fn(),
    activeTexture: vi.fn(),
    drawArrays: vi.fn(),
  }

  return gl as unknown as WebGL2RenderingContext
}

// A loader that resolves immediately with a fake uploadable source + size.
function makeLoader(width = 1920, height = 1080): ImageLoader {
  return () =>
    Promise.resolve<LoadedImage>({
      source: {} as TexImageSource,
      width,
      height,
    })
}

// Flush the microtask queue so the acquire() load promise's .then runs.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function makeClip(overrides: Partial<ActiveImageClip> = {}): ActiveImageClip {
  return {
    id: 'image-a',
    trackId: 'track-1',
    name: 'Image A',
    type: 'image',
    src: 'blob://image-1',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...overrides,
  }
}

function makeCtx(gl: WebGL2RenderingContext): LayerContext {
  return {
    gl,
    stage: { width: 1080, height: 1920 },
    viewport: { width: 1080, height: 1920 },
    fps: 30,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageLayer', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext
  let layer: ImageLayer

  beforeEach(() => {
    __clearImageCacheForTests()
    gl = createMockGL()
    ctx = makeCtx(gl)
    layer = new ImageLayer(makeLoader())
  })

  it('acquire() allocates a texture per clip', () => {
    layer.acquire(makeClip(), ctx)
    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(1)
  })

  it('draw() before the image loads is a no-op (keeps the canvas as-is)', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    layer.draw(clip, ctx) // image not yet resolved
    expect(gl.texImage2D).not.toHaveBeenCalled()
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('draw() after load uploads the image once and draws a quad with opacity', async () => {
    const clip = makeClip({ opacity: 0.7 })
    layer.acquire(clip, ctx)
    await flush()

    layer.draw(clip, ctx)

    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.7)
    expect(gl.uniformMatrix3fv).toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.any(Float32Array),
    )
  })

  it('does not re-upload the static image on subsequent draws', async () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()

    layer.draw(clip, ctx)
    layer.draw(clip, ctx)

    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
  })

  it('toggles premultiply-alpha around the upload', async () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()
    layer.draw(clip, ctx)

    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  })

  it('release() deletes the clip texture', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    layer.release(clip.id)

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(0)
  })

  it('does not upload to a texture released before the load resolved', async () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    layer.release(clip.id) // released before the async load resolves
    await flush()

    layer.draw(clip, ctx)
    expect(gl.texImage2D).not.toHaveBeenCalled()
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('dispose() deletes textures and GL pipeline objects', () => {
    layer.acquire(makeClip(), ctx)
    layer.dispose()

    expect(gl.deleteTexture).toHaveBeenCalled()
    expect(gl.deleteVertexArray).toHaveBeenCalled()
    expect(gl.deleteProgram).toHaveBeenCalled()
    expect(layer.getTextureCount()).toBe(0)
  })

  it('draw() before acquire() is a no-op', () => {
    layer.draw(makeClip(), ctx)
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })
})
