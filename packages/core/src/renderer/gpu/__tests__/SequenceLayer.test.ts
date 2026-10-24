import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveSequenceClip } from '../../../resolver/scene'
import type { LayerContext, EffectChainLike } from '../layers/types'
import { SequenceLayer } from '../layers/SequenceLayer'
import { buildDrawTransformMatrix } from '../layers/drawRect'
import type { SequenceFrameReader, SequenceImage } from '../../../media/sequence/SequenceReader'

// ---------------------------------------------------------------------------
// Minimal WebGL2 mock (copied from ImageLayer.test.ts — same quad path).
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

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

function makeClip(overrides: Partial<ActiveSequenceClip> = {}): ActiveSequenceClip {
  return {
    id: 'seq-a',
    trackId: 'track-1',
    name: 'Seq A',
    type: 'sequence',
    kind: 'animated-image',
    src: 'blob://gif-1',
    frameCount: 4,
    frameIndex: 0,
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...overrides,
  }
}

function makeCtx(gl: WebGL2RenderingContext, extra: Partial<LayerContext> = {}): LayerContext {
  return {
    gl,
    frame: 0,
    stage: { width: 1920, height: 1080 },
    viewport: { width: 1920, height: 1080 },
    fps: 30,
    ...extra,
  }
}

/** A controllable reader whose `read()` resolves on demand. */
function makeControllableReader(frameCount = 4, size = { width: 64, height: 64 }) {
  const pending = new Map<number, (img: SequenceImage) => void>()
  const closeSpy = vi.fn()
  const reader: SequenceFrameReader = {
    frameCount,
    fallback: null,
    read: (index: number) =>
      new Promise<SequenceImage>((resolve) => {
        pending.set(index, resolve)
      }),
    close: closeSpy,
  }
  return {
    reader,
    closeSpy,
    resolveFrame: (index: number) => {
      const resolve = pending.get(index)
      if (!resolve) throw new Error(`no pending read for ${index}`)
      pending.delete(index)
      resolve({ source: {} as ImageBitmap, width: size.width, height: size.height, close: vi.fn() })
    },
    hasPending: (index: number) => pending.has(index),
  }
}

describe('SequenceLayer', () => {
  let gl: WebGL2RenderingContext
  let ctx: LayerContext

  beforeEach(() => {
    gl = createMockGL()
    ctx = makeCtx(gl)
  })

  it('acquire + draw before the first frame lands draws nothing', async () => {
    const { reader } = makeControllableReader()
    const layer = new SequenceLayer({ openReader: async () => reader })
    const clip = makeClip()
    layer.acquire(clip, ctx)
    layer.draw(clip, ctx)
    await flush()

    expect(gl.texImage2D).not.toHaveBeenCalled()
    expect(gl.drawArrays).not.toHaveBeenCalled()
  })

  it('uploads frame 0 and draws once it lands', async () => {
    const { reader, resolveFrame } = makeControllableReader()
    const layer = new SequenceLayer({ openReader: async () => reader })
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()

    layer.draw(clip, ctx)

    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledTimes(1)
  })

  it('advancing frameIndex while the next frame is pending still draws the last uploaded one', async () => {
    const { reader, resolveFrame } = makeControllableReader()
    const layer = new SequenceLayer({ openReader: async () => reader, lookahead: 0 })
    let clip = makeClip({ frameIndex: 0 })
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()
    layer.draw(clip, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)

    // Advance to frame 1 — its read is now pending, not yet resolved.
    clip = makeClip({ frameIndex: 1 })
    layer.draw(clip, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1) // still frame 0's upload
    expect(gl.drawArrays).toHaveBeenCalledTimes(2) // draws frame 0 again

    resolveFrame(1)
    await flush()
    layer.draw(clip, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(2)
  })

  it('a frame whose load was rejected draws nothing, not the previous frame (stale matte)', async () => {
    // Frame 0 loads; frame 1 is rejected (an uncovered roto-mask frame is a 404).
    const reader: SequenceFrameReader = {
      frameCount: 4,
      fallback: null,
      read: (index: number) =>
        index === 0
          ? Promise.resolve({ source: {} as ImageBitmap, width: 64, height: 64, close: vi.fn() })
          : Promise.reject(Object.assign(new Error('not covered'), { name: 'NotFound' })),
      close: vi.fn(),
    }
    const layer = new SequenceLayer({ openReader: async () => reader, lookahead: 0 })
    layer.acquire(makeClip({ frameIndex: 0 }), ctx)
    await flush()
    await flush()
    layer.draw(makeClip({ frameIndex: 0 }), ctx)
    expect(gl.drawArrays).toHaveBeenCalledTimes(1)

    // Seek to frame 1: first draw only requests it (still loading -> keeps frame 0, I4).
    layer.draw(makeClip({ frameIndex: 1 }), ctx)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
    await flush()
    await flush()

    // Now it is known missing: nothing drawn.
    layer.draw(makeClip({ frameIndex: 1 }), ctx)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)

    // Back on the covered frame it draws again.
    layer.draw(makeClip({ frameIndex: 0 }), ctx)
    expect(gl.drawArrays).toHaveBeenCalledTimes(3)
  })

  it('drawing the same frameIndex twice uploads once', async () => {
    const { reader, resolveFrame } = makeControllableReader()
    const layer = new SequenceLayer({ openReader: async () => reader })
    const clip = makeClip({ frameIndex: 0 })
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()

    layer.draw(clip, ctx)
    layer.draw(clip, ctx)

    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
  })

  it('changing src reopens the reader and draws nothing until the new frame lands', async () => {
    const first = makeControllableReader()
    const second = makeControllableReader()
    let call = 0
    const openReader = vi.fn(async () => {
      call += 1
      return call === 1 ? first.reader : second.reader
    })
    const layer = new SequenceLayer({ openReader })
    let clip = makeClip({ src: 'blob://a' })
    layer.acquire(clip, ctx)
    await flush()
    first.resolveFrame(0)
    await flush()
    layer.draw(clip, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)

    clip = makeClip({ src: 'blob://b', frameIndex: 0 })
    layer.draw(clip, ctx) // sourceKey changed -> new provider, nothing drawn yet
    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
    await flush()

    second.resolveFrame(0)
    await flush()
    layer.draw(clip, ctx)
    expect(gl.texImage2D).toHaveBeenCalledTimes(2)
    expect(openReader).toHaveBeenCalledTimes(2)
  })

  it('release deletes the texture and closes the reader', async () => {
    const { reader, resolveFrame, closeSpy } = makeControllableReader()
    const layer = new SequenceLayer({ openReader: async () => reader })
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()

    layer.release(clip.id)

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(layer.getTextureCount()).toBe(0)
  })

  it('uTransform matches buildDrawTransformMatrix with the content size', async () => {
    const { reader, resolveFrame } = makeControllableReader(4, { width: 64, height: 64 })
    const layer = new SequenceLayer({ openReader: async () => reader })
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()

    layer.draw(clip, ctx)

    const expected = buildDrawTransformMatrix(undefined, 1920, 1080, 64, 64, undefined)
    expect(gl.uniformMatrix3fv).toHaveBeenCalledWith(expect.anything(), false, expected)
  })

  it('never toggles UNPACK_PREMULTIPLY_ALPHA_WEBGL', async () => {
    const { reader, resolveFrame } = makeControllableReader()
    const layer = new SequenceLayer({ openReader: async () => reader })
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()

    layer.draw(clip, ctx)

    expect(gl.pixelStorei).not.toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, expect.anything())
  })

  it('onFrameReady fires when a frame lands', async () => {
    const { reader, resolveFrame } = makeControllableReader()
    const onFrameReady = vi.fn()
    const layer = new SequenceLayer({ openReader: async () => reader, onFrameReady })
    const clip = makeClip()
    layer.acquire(clip, ctx)
    await flush()
    resolveFrame(0)
    await flush()

    expect(onFrameReady).toHaveBeenCalled()
  })

  it('an item with effects and a stub effectChain calls effectChain.draw with the content size', async () => {
    const { reader, resolveFrame } = makeControllableReader(4, { width: 64, height: 64 })
    const layer = new SequenceLayer({ openReader: async () => reader })
    const drawSpy = vi.fn(() => true)
    const effectChain: EffectChainLike = { draw: drawSpy }
    const clip = makeClip({ effects: [{ type: 'brightness', amount: 0.5 } as never] })
    const ctxWithChain = makeCtx(gl, { effectChain })
    layer.acquire(clip, ctxWithChain)
    await flush()
    resolveFrame(0)
    await flush()

    layer.draw(clip, ctxWithChain)

    expect(drawSpy).toHaveBeenCalledWith(
      ctxWithChain,
      expect.objectContaining({ contentWidth: 64, contentHeight: 64 }),
    )
  })
})
