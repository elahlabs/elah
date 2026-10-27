import { describe, it, expect } from 'vitest'
import { CliError } from '../errors'
import { containerForPath, resolveOutputFormat } from '../format'

describe('containerForPath', () => {
  it('reads the container from the extension, case-insensitively', () => {
    expect(containerForPath('out.webm')).toBe('webm')
    expect(containerForPath('C:/clips/OUT.WEBM')).toBe('webm')
    expect(containerForPath('out.mp4')).toBe('mp4')
    expect(containerForPath('out.m4v')).toBe('mp4')
    expect(containerForPath('out.mov')).toBeUndefined()
    expect(containerForPath('out')).toBeUndefined()
  })
})

describe('resolveOutputFormat', () => {
  it('defaults to MP4/avc, and to vp9 for WebM', () => {
    expect(resolveOutputFormat({})).toEqual({ container: 'mp4', videoCodec: 'avc' })
    expect(resolveOutputFormat({ outPath: 'out.webm' })).toEqual({ container: 'webm', videoCodec: 'vp9' })
    expect(resolveOutputFormat({ container: 'webm' })).toEqual({ container: 'webm', videoCodec: 'vp9' })
  })

  it("accepts every codec core's matrix allows", () => {
    for (const videoCodec of ['avc', 'hevc', 'av1']) {
      expect(resolveOutputFormat({ videoCodec, outPath: 'out.mp4' })).toEqual({ container: 'mp4', videoCodec })
    }
    for (const videoCodec of ['vp9', 'vp8', 'av1']) {
      expect(resolveOutputFormat({ videoCodec, outPath: 'out.webm' })).toEqual({ container: 'webm', videoCodec })
    }
  })

  it('rejects VP9/VP8 in MP4 and points at WebM, as a usage error', () => {
    const err = (() => {
      try {
        resolveOutputFormat({ videoCodec: 'vp8', outPath: 'out.mp4' })
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).exitCode).toBe(2)
    expect((err as CliError).message).toMatch(/"vp8" is not valid in a MP4 container.*\.webm/s)
    expect(() => resolveOutputFormat({ videoCodec: 'vp9' })).toThrow(/--container webm/)
  })

  it('rejects avc/hevc in WebM', () => {
    expect(() => resolveOutputFormat({ videoCodec: 'avc', container: 'webm' })).toThrow(/not valid in a WEBM container/)
    expect(() => resolveOutputFormat({ videoCodec: 'hevc', outPath: 'out.webm' })).toThrow(/vp9 or vp8 or av1/)
  })

  it('rejects unknown values and a container that contradicts the file name', () => {
    expect(() => resolveOutputFormat({ videoCodec: 'h264' })).toThrow(/codec must be one of: avc, hevc, av1, vp9, vp8/)
    expect(() => resolveOutputFormat({ container: 'mkv' })).toThrow(/container must be one of: mp4, webm/)
    expect(() => resolveOutputFormat({ container: 'webm', outPath: 'out.mp4' })).toThrow(/does not match/)
  })

  it('lets --container decide when the file name has no known extension', () => {
    expect(resolveOutputFormat({ container: 'webm', outPath: 'render.bin' })).toEqual({
      container: 'webm',
      videoCodec: 'vp9',
    })
  })
})
