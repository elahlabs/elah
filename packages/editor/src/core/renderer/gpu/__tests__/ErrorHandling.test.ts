import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { TexturePool } from '../TexturePool'
import type { VideoFrameProvider } from '../../../media/video'
import { VideoLayer } from '../layers/VideoLayer'
import { VideoTexture } from '../VideoTexture'
import { VideoDecoderManager } from '../../../media/video/VideoDecoderManager'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from '../../../media/video/__tests__/helpers/mockDemuxer'
import { createTrackingFrame } from './helpers/trackingFrame'

describe('Error handling', () => {
  describe('VideoDecoderManager', () => {
    it('invalid codec transitions to Errored', async () => {
      const decoder = createMockDecoder({
        configureError: new Error('invalid codec'),
      })
      const manager = new VideoDecoderManager({
        demuxerFactory: () => createMockDemuxerBackend(),
        decoderFactory: decoder.factory,
      })

      await expect(manager.open('video://bad')).rejects.toThrow('invalid codec')
      expect(manager.state).toBe('Errored')
    })

    it('broken source transitions to Errored', async () => {
      const manager = new VideoDecoderManager({
        demuxerFactory: () => createMockDemuxerBackend({
          openError: new Error('broken source'),
        }),
        decoderFactory: createMockDecoder().factory,
      })

      await expect(manager.open('video://missing')).rejects.toThrow('broken source')
      expect(manager.state).toBe('Errored')
    })

    it('failed packet stream transitions to Errored', async () => {
      const onError = vi.fn()
      const manager = new VideoDecoderManager({
        demuxerFactory: () => createMockDemuxerBackend({
          chunks: [createMockChunk()],
          packetsError: new Error('stream broken'),
        }),
        decoderFactory: createMockDecoder().factory,
        onError,
      })

      await manager.open('video://test')
      manager.feed([0, 33333])
      // Allow async feed loop to process and surface the error.
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(manager.state).toBe('Errored')
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'stream broken' }))
    })

    it('dispose() from Errored cleans up safely', async () => {
      const decoder = createMockDecoder({ configureError: new Error('fail') })
      const manager = new VideoDecoderManager({
        demuxerFactory: () => createMockDemuxerBackend(),
        decoderFactory: decoder.factory,
      })

      await expect(manager.open('video://fail')).rejects.toThrow()
      manager.dispose()
      expect(manager.state).toBe('Disposed')
    })
  })

  describe('VideoLayer isolation', () => {
    let gl: WebGL2RenderingContext
    let ctx: LayerContext
    let pool: TexturePool

    beforeEach(() => {
      gl = createMockGL()
      ctx = {
        gl,
        stage: { width: 1280, height: 720 },
        viewport: { width: 1280, height: 720 },
        fps: 30,
      }
      pool = new TexturePool({ maxTextures: 8 })
    })

    it('errored provider skips draw without crashing', () => {
      const goodProvider = makeMockProvider()
      const badProvider = makeMockProvider()

      goodProvider.getCurrent.mockReturnValue(createTrackingFrame())
      badProvider.getCurrent.mockReturnValue(null)

      const layer = new VideoLayer(pool, (src) =>
        src === 'video://bad' ? badProvider : goodProvider,
      )

      const badClip = makeClip({ id: 'bad', src: 'video://bad', sourceFrame: 0 })
      const goodClip = makeClip({ id: 'good', src: 'video://good', sourceFrame: 0, zIndex: 1 })

      layer.acquire(badClip, ctx)
      layer.acquire(goodClip, ctx)

      expect(() => {
        layer.draw(badClip, ctx)
        layer.draw(goodClip, ctx)
      }).not.toThrow()

      expect(badProvider.setPlayhead).toHaveBeenCalledWith(0)
      expect(gl.drawArrays).toHaveBeenCalled()
    })

    it('pool exhaustion closes frame and skips draw for new clip', () => {
      const provider = makeMockProvider()
      provider.getCurrent.mockReturnValue(createTrackingFrame())

      const layer = new VideoLayer(pool, () => provider)
      const exhaustedPool = new TexturePool({ maxTextures: 0 })
      const exhaustedLayer = new VideoLayer(exhaustedPool, () => provider)

      const clip = makeClip()
      exhaustedLayer.acquire(clip, ctx)

      expect(() => exhaustedLayer.draw(clip, ctx)).not.toThrow()
      expect(gl.drawArrays).not.toHaveBeenCalled()

      layer.dispose()
      exhaustedLayer.dispose()
    })

    it('multiple clips: one failing provider does not block others', () => {
      const providerA = makeMockProvider()
      const providerB = makeMockProvider()

      providerA.getCurrent.mockReturnValue(null)
      providerB.getCurrent.mockReturnValue(createTrackingFrame())

      const layer = new VideoLayer(pool, (src) =>
        src === 'video://a' ? providerA : providerB,
      )

      const clipA = makeClip({ id: 'a', src: 'video://a' })
      const clipB = makeClip({ id: 'b', src: 'video://b', zIndex: 1 })

      layer.acquire(clipA, ctx)
      layer.acquire(clipB, ctx)

      vi.mocked(gl.drawArrays).mockClear()
      layer.draw(clipA, ctx)
      layer.draw(clipB, ctx)

      expect(providerA.setPlayhead).toHaveBeenCalled()
      expect(gl.drawArrays).toHaveBeenCalledTimes(1)

      layer.dispose()
    })
  })

  describe('VideoTexture upload failure', () => {
    it('returns false and still closes frame when pool exhausted', () => {
      const pool = new TexturePool({ maxTextures: 0 })
      const gl = createMockGL()
      const texture = new VideoTexture(pool)
      const frame = createTrackingFrame()

      const result = texture.upload(gl, frame)

      expect(result).toBe(false)
      expect(frame.closeCount()).toBe(1)
    })
  })
})

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

function createMockGL(): WebGL2RenderingContext {
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
  }
  return gl as unknown as WebGL2RenderingContext
}
