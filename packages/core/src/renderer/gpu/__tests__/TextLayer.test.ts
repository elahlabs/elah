import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { TextLayer, type TextCanvasFactory } from '../layers/TextLayer'

// ---------------------------------------------------------------------------
// Minimal WebGL2 mock (mirrors VideoLayer.test.ts, plus pixelStorei for the
// premultiply toggle TextLayer uses on upload).
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

// ---------------------------------------------------------------------------
// Mock 2D canvas (vitest runs in the `node` environment — no real DOM).
// ---------------------------------------------------------------------------

function makeMockCanvasFactory(): TextCanvasFactory {
  return () => {
    const ctx2d = {
      font: '',
      fillStyle: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx2d),
    }
    return canvas as unknown as HTMLCanvasElement
  }
}

function makeClip(overrides: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 'text-a',
    trackId: 'track-1',
    name: 'Text A',
    type: 'text',
    content: 'Hello',
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
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

describe('TextLayer', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext
  let layer: TextLayer

  beforeEach(() => {
    gl = createMockGL()
    ctx = makeCtx(gl)
    layer = new TextLayer(makeMockCanvasFactory())
  })

  it('acquire() allocates a texture per clip', () => {
    layer.acquire(makeClip(), ctx)
    expect(gl.createTexture).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(1)
  })

  it('draw() paints, uploads the canvas, and issues a quad draw', () => {
    const clip = makeClip({ opacity: 0.8 })
    layer.acquire(clip, ctx)
    layer.draw(clip, ctx)

    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.8)
  })

  it('toggles premultiply-alpha around the upload', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    layer.draw(clip, ctx)

    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  })

  it('skips re-upload when content + style are unchanged', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)

    layer.draw(clip, ctx)
    layer.draw(clip, ctx)

    // Painted/uploaded once; second draw reuses the texture.
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    // But still draws the quad each tick.
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
  })

  it('re-uploads when the content changes', () => {
    const a = makeClip({ content: 'Hello' })
    layer.acquire(a, ctx)
    layer.draw(a, ctx)

    const b = makeClip({ content: 'World' })
    layer.draw(b, ctx)

    expect(gl.texImage2D).toHaveBeenCalledTimes(2)
  })

  it('release() deletes the clip texture', () => {
    const clip = makeClip()
    layer.acquire(clip, ctx)
    layer.release(clip.id)

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(0)
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

  it('re-rasterizes (re-uploads) when transform.scale changes', () => {
    const base = makeClip()
    layer.acquire(base, ctx)
    layer.draw(base, ctx)

    const scaled = makeClip({
      transform: { x: 0.5, y: 0.5, scale: 2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    })
    layer.draw(scaled, ctx)

    // scale is baked into fontSize, so it changes the painted pixels.
    expect(gl.texImage2D).toHaveBeenCalledTimes(2)
  })

  it('uses the full-stage matrix when rotation is 0, a different one when rotated', () => {
    const FULL_STAGE = [2, 0, 0, 0, 2, 0, -1, -1, 1]

    const flat = makeClip({
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
    })
    layer.acquire(flat, ctx)
    layer.draw(flat, ctx)
    const calls = (gl.uniformMatrix3fv as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const flatMat = Array.from(calls[calls.length - 1][2] as Float32Array)
    expect(flatMat).toEqual(FULL_STAGE)

    const rotated = makeClip({
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 1, anchor: { x: 0.5, y: 0.5 } },
    })
    layer.draw(rotated, ctx)
    const rotMat = Array.from(calls[calls.length - 1][2] as Float32Array)
    expect(rotMat).not.toEqual(FULL_STAGE)
  })
})
