import { describe, expect, it } from 'vitest'
import { ExportCapabilityError } from '../exportErrors'
import { resolveExportFormat } from '../capabilities'

/**
 * The container/codec matrix ExportWorker.ts and exportVideo.ts both resolve
 * through before touching a worker, a GPU renderer or an asset fetch
 * (PV-P9a-1). `capabilities.test.ts` covers the WebM transparency gate; this
 * file covers the pure format matrix itself.
 */
describe('export format matrix (PV-P9a-1)', () => {
  it('no options at all resolves to exactly the pre-existing MP4/AVC/AAC default', () => {
    expect(resolveExportFormat({})).toEqual({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', mimeType: 'video/mp4' })
  })

  it('container: "mp4" explicitly is the same as omitting it', () => {
    expect(resolveExportFormat({ container: 'mp4' })).toEqual(resolveExportFormat({}))
  })

  it('container: "webm" defaults to VP9/Opus', () => {
    expect(resolveExportFormat({ container: 'webm' })).toEqual({
      container: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus',
      mimeType: 'video/webm',
    })
  })

  it('an explicit VP8 video codec is valid in WebM', () => {
    expect(resolveExportFormat({ container: 'webm', videoCodec: 'vp8' }).videoCodec).toBe('vp8')
  })

  it('rejects a video codec the container cannot carry', () => {
    expect(() => resolveExportFormat({ container: 'mp4', videoCodec: 'vp9' })).toThrow(ExportCapabilityError)
    expect(() => resolveExportFormat({ container: 'mp4', videoCodec: 'vp8' })).toThrow(ExportCapabilityError)
    expect(() => resolveExportFormat({ container: 'webm', videoCodec: 'avc' })).toThrow(ExportCapabilityError)
  })

  it('rejects an audio codec the container cannot carry', () => {
    expect(() => resolveExportFormat({ container: 'mp4', audioCodec: 'opus' })).toThrow(ExportCapabilityError)
    expect(() => resolveExportFormat({ container: 'webm', audioCodec: 'aac' })).toThrow(ExportCapabilityError)
  })

  it('transparent MP4 (the default container) always rejects, suggesting WebM or PNG', () => {
    let message = ''
    try {
      resolveExportFormat({ transparent: true })
    } catch (err) {
      message = String(err)
    }
    expect(message).toMatch(/WebM/)
    expect(message).toMatch(/PNG/)
    expect(() => resolveExportFormat({ container: 'mp4', transparent: true })).toThrow(ExportCapabilityError)
  })

  it('transparent WebM is not rejected by the format matrix itself — the alpha gate decides it', () => {
    expect(() => resolveExportFormat({ container: 'webm', transparent: true })).not.toThrow()
    expect(resolveExportFormat({ container: 'webm', transparent: true }).container).toBe('webm')
  })

  it('opaque (default) transparency never rejects for either real container', () => {
    expect(() => resolveExportFormat({ container: 'mp4' })).not.toThrow()
    expect(() => resolveExportFormat({ container: 'webm' })).not.toThrow()
  })

  it('png-sequence is typed but rejects until PV-P9a-2', () => {
    expect(() => resolveExportFormat({ container: 'png-sequence' })).toThrow(/PNG sequence support requires PV-P9a-2/)
  })

  it('every rejection is an ExportCapabilityError, so the UI can tell it apart from a crash', () => {
    const cases: Array<Parameters<typeof resolveExportFormat>[0]> = [
      { container: 'png-sequence' },
      { transparent: true },
      { container: 'mp4', videoCodec: 'vp9' },
      { container: 'webm', audioCodec: 'aac' },
    ]
    for (const options of cases) {
      expect(() => resolveExportFormat(options)).toThrow(ExportCapabilityError)
    }
  })
})
