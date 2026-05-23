import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TestLayer } from '../layers/TestLayer'
import type { LayerContext } from '../layers/types'
import type { DebugRenderItem } from '../debug/types'

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
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE0: 0x84c0,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    COLOR_BUFFER_BIT: 0x4000,

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

const STUB_ITEM: DebugRenderItem = {
  id: 'test-quad',
  zIndex: 0,
  color: [1, 0, 0, 1],
  x: 100,
  y: 50,
  width: 200,
  height: 150,
  opacity: 0.8,
}

function makeCtx(gl: WebGL2RenderingContext): LayerContext {
  return {
    gl,
    stage: { width: 1280, height: 720 },
    viewport: { width: 1280, height: 720 },
    fps: 30,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TestLayer lifecycle', () => {
  let gl: WebGL2RenderingContext
  let layer: TestLayer
  let ctx: LayerContext

  beforeEach(() => {
    gl = createMockGL()
    layer = new TestLayer()
    ctx = makeCtx(gl)
  })

  it('acquire() uploads a 1×1 colour texture', () => {
    layer.acquire(STUB_ITEM, ctx)

    expect(gl.createTexture).toHaveBeenCalled()
    expect(gl.texImage2D).toHaveBeenCalled()
  })

  it('draw() binds shader uniforms and issues drawArrays', () => {
    layer.acquire(STUB_ITEM, ctx)
    layer.draw(STUB_ITEM, ctx)

    expect(gl.useProgram).toHaveBeenCalled()
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.8)
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4)
  })

  it('release() removes item from active resources', () => {
    layer.acquire(STUB_ITEM, ctx)
    layer.release(STUB_ITEM.id)

    expect(gl.deleteTexture).toHaveBeenCalled()

    layer.draw(STUB_ITEM, ctx)
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('disposeGL() deletes all GL objects', () => {
    layer.acquire(STUB_ITEM, ctx)
    layer.disposeGL(gl)

    expect(gl.deleteTexture).toHaveBeenCalled()
    expect(gl.deleteVertexArray).toHaveBeenCalled()
    expect(gl.deleteProgram).toHaveBeenCalled()
  })

  it('notifyContextLost() clears state for re-acquire on restore', () => {
    layer.acquire(STUB_ITEM, ctx)
    layer.notifyContextLost()

    layer.draw(STUB_ITEM, ctx)
    expect(gl.drawArrays).not.toHaveBeenCalled()

    layer.acquire(STUB_ITEM, ctx)
    layer.draw(STUB_ITEM, ctx)
    expect(gl.drawArrays).toHaveBeenCalled()
  })
})
