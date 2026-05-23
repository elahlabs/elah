import { describe, expect, it, vi } from 'vitest'
import { MediabunnyDemuxer } from '../demuxer/MediabunnyDemuxer'
import { VideoDecoderManager } from '../VideoDecoderManager'
import {
  createMockChunk,
  createMockDecoder,
  createMockDemuxerBackend,
} from './helpers/mockDemuxer'

describe('MediabunnyDemuxer adapter', () => {
  it('open(src) passes src to backend', async () => {
    const backend = createMockDemuxerBackend()
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://asset-1')

    expect(backend.open).toHaveBeenCalledWith('video://asset-1')
    expect(demuxer.src).toBe('video://asset-1')
    expect(demuxer.isOpen).toBe(true)
  })

  it('getConfig() returns VideoDecoderConfig', async () => {
    const config: VideoDecoderConfig = {
      codec: 'avc1.42E01E',
      codedWidth: 1920,
      codedHeight: 1080,
    }
    const backend = createMockDemuxerBackend({ config })
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://hd')

    expect(demuxer.getConfig()).toEqual(config)
    expect(demuxer.getConfig().codec).toBe('avc1.42E01E')
  })

  it('packets() iterates chunks in order', async () => {
    const chunks = [createMockChunk(0), createMockChunk(33333), createMockChunk(66666)]
    const backend = createMockDemuxerBackend({ chunks })
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://test')

    const received: number[] = []
    for await (const chunk of demuxer.packets([0, 100_000])) {
      received.push(chunk.timestamp)
    }

    expect(received).toEqual([0, 33333, 66666])
  })

  it('packets() stops iteration cleanly on early return', async () => {
    const chunks = [createMockChunk(0), createMockChunk(33333), createMockChunk(66666)]
    const backend = createMockDemuxerBackend({ chunks })
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://test')

    const received: number[] = []
    for await (const chunk of demuxer.packets([0, 100_000])) {
      received.push(chunk.timestamp)
      if (received.length >= 2) break
    }

    expect(received).toEqual([0, 33333])
  })

  it('seekToKeyframe() invokes underlying seek', async () => {
    const backend = createMockDemuxerBackend()
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://test')
    await demuxer.seekToKeyframe(1_000_000)

    expect(backend.seekToKeyframe).toHaveBeenCalledWith(1_000_000)
  })

  it('dispose() releases handles and subsequent calls are no-ops', async () => {
    const backend = createMockDemuxerBackend()
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://test')
    demuxer.dispose()
    demuxer.dispose()

    expect(backend.dispose).toHaveBeenCalledTimes(1)
    expect(demuxer.isOpen).toBe(false)
    expect(demuxer.src).toBeNull()
  })

  it('double open throws', async () => {
    const backend = createMockDemuxerBackend()
    const demuxer = new MediabunnyDemuxer(() => backend)

    await demuxer.open('video://first')

    await expect(demuxer.open('video://second')).rejects.toThrow(/already open/)
  })

  it('getConfig() before open throws', () => {
    const demuxer = new MediabunnyDemuxer(() => createMockDemuxerBackend())

    expect(() => demuxer.getConfig()).toThrow(/not open/)
  })

  it('broken source surfaces as Errored in VideoDecoderManager', async () => {
    const backend = createMockDemuxerBackend({
      openError: new Error('broken source'),
    })
    const manager = new VideoDecoderManager({
      demuxerFactory: () => backend,
      decoderFactory: () => createMockDecoder(),
    })

    await expect(manager.open('video://broken')).rejects.toThrow('broken source')
    expect(manager.state).toBe('Errored')
  })

  it('configure flow wires demuxer config to decoder', async () => {
    const config: VideoDecoderConfig = {
      codec: 'vp09.00.10.08',
      codedWidth: 1280,
      codedHeight: 720,
    }
    const backend = createMockDemuxerBackend({ config })
    const decoder = createMockDecoder()
    const manager = new VideoDecoderManager({
      demuxerFactory: () => backend,
      decoderFactory: () => decoder,
    })

    await manager.open('video://webm')

    expect(backend.getConfig).toHaveBeenCalled()
    expect(decoder.configure).toHaveBeenCalledWith(config)
    expect(manager.state).toBe('Ready')
  })
})
