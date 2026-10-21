import { describe, expect, it } from 'vitest'
import { ExportCapabilityError } from '../exportErrors'
import {
  EXPORT_OFFER_HEVC,
  ensureVideoCodecSupport,
  offeredVideoCodecs,
  probeVideoCodecSupport,
  resolveExportFormat,
  type IsConfigSupported,
} from '../capabilities'

const yesTo = (...codecPrefixes: string[]): IsConfigSupported => async (c) => ({
  supported: codecPrefixes.some((p) => c.codec.startsWith(p)),
})

describe('REN-5 format matrix: hevc, av1, gif', () => {
  it('hevc is MP4-only; av1 is MP4 or WebM; defaults are unchanged', () => {
    expect(resolveExportFormat({ videoCodec: 'hevc' }).videoCodec).toBe('hevc')
    expect(resolveExportFormat({ container: 'mp4', videoCodec: 'av1' }).container).toBe('mp4')
    expect(resolveExportFormat({ container: 'webm', videoCodec: 'av1' }).audioCodec).toBe('opus')
    expect(() => resolveExportFormat({ container: 'webm', videoCodec: 'hevc' })).toThrow(ExportCapabilityError)
    expect(resolveExportFormat({}).videoCodec).toBe('avc')
    expect(resolveExportFormat({ container: 'webm' }).videoCodec).toBe('vp9')
  })

  it('MP4 transparency still rejects, for every MP4 codec', () => {
    for (const videoCodec of ['avc', 'hevc', 'av1'] as const) {
      expect(() => resolveExportFormat({ container: 'mp4', videoCodec, transparent: true })).toThrow(/MP4 cannot carry transparency/)
    }
  })

  it('transparent AV1 WebM rejects (the alpha round trip only verifies VP9)', () => {
    expect(() => resolveExportFormat({ container: 'webm', videoCodec: 'av1', transparent: true })).toThrow(/AV1/)
    expect(() => resolveExportFormat({ container: 'webm', transparent: true })).not.toThrow()
  })

  it('gif resolves to image/gif with no codecs of its own', () => {
    expect(resolveExportFormat({ container: 'gif' }).mimeType).toBe('image/gif')
  })

  it('gif rejects audio options, a video codec, and transparency', () => {
    expect(() => resolveExportFormat({ container: 'gif', audioCodec: 'aac' })).toThrow(ExportCapabilityError)
    expect(() => resolveExportFormat({ container: 'gif', audioBitrate: 128_000 })).toThrow(/no audio/)
    expect(() => resolveExportFormat({ container: 'gif', videoCodec: 'avc' })).toThrow(ExportCapabilityError)
    expect(() => resolveExportFormat({ container: 'gif', transparent: true })).toThrow(ExportCapabilityError)
  })
})

describe('REN-5 codec support probe', () => {
  it('reports per-codec answers and treats a throwing or missing probe as unsupported', async () => {
    const r = await probeVideoCodecSupport(['avc', 'hevc', 'av1'], 1920, 1080, yesTo('avc1', 'av01'))
    expect(r).toMatchObject({ avc: true, hevc: false, av1: true })
    const thrown = await probeVideoCodecSupport(['av1'], 640, 360, async () => {
      throw new Error('boom')
    })
    expect(thrown.av1).toBe(false)
    expect((await probeVideoCodecSupport(['av1'], 640, 360, null)).av1).toBe(false)
  })

  it('passes the real dimensions to the encoder', async () => {
    let seen: { width: number; height: number } | null = null
    await probeVideoCodecSupport(['av1'], 3840, 2160, async (c) => {
      seen = { width: c.width, height: c.height }
      return { supported: true }
    })
    expect(seen).toEqual({ width: 3840, height: 2160 })
  })

  it('rejects hevc and av1 exports the probe says no to, naming the codec', async () => {
    const hevc = resolveExportFormat({ videoCodec: 'hevc' })
    await expect(ensureVideoCodecSupport(hevc, 1280, 720, yesTo('avc1'))).rejects.toThrow(/HEVC/)
    const av1 = resolveExportFormat({ container: 'webm', videoCodec: 'av1' })
    await expect(ensureVideoCodecSupport(av1, 1280, 720, yesTo('avc1'))).rejects.toThrow(/AV1/)
    await expect(ensureVideoCodecSupport(av1, 1280, 720, null)).rejects.toBeInstanceOf(ExportCapabilityError)
    await expect(ensureVideoCodecSupport(av1, 1280, 720, yesTo('av01'))).resolves.toBeUndefined()
  })

  it('never probes AVC, VP9 or GIF', async () => {
    const never: IsConfigSupported = async () => {
      throw new Error('should not be called')
    }
    await expect(ensureVideoCodecSupport(resolveExportFormat({}), 640, 360, never)).resolves.toBeUndefined()
    await expect(ensureVideoCodecSupport(resolveExportFormat({ container: 'webm' }), 640, 360, never)).resolves.toBeUndefined()
    await expect(ensureVideoCodecSupport(resolveExportFormat({ container: 'gif' }), 640, 360, never)).resolves.toBeUndefined()
  })
})

describe('REN-5 offered codecs (UI list)', () => {
  it('HEVC is hidden by default even when the browser supports it', () => {
    expect(EXPORT_OFFER_HEVC).toBe(false)
    expect(offeredVideoCodecs('mp4', { av1: true, hevc: true })).toEqual(['avc', 'av1'])
  })

  it('lists HEVC only when offered AND supported; AV1 only when supported', () => {
    expect(offeredVideoCodecs('mp4', { av1: true, hevc: true }, true)).toEqual(['avc', 'hevc', 'av1'])
    expect(offeredVideoCodecs('mp4', { hevc: false, av1: false }, true)).toEqual(['avc'])
    expect(offeredVideoCodecs('webm', { av1: false })).toEqual(['vp9', 'vp8'])
    expect(offeredVideoCodecs('webm', { av1: true })).toEqual(['vp9', 'vp8', 'av1'])
    expect(offeredVideoCodecs('gif', {})).toEqual([])
  })
})
