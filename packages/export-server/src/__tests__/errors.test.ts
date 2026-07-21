import { describe, it, expect } from 'vitest'

import { ExportServerError } from '../errors'

describe('ExportServerError', () => {
  it('carries the code, message and name a consumer switches on', () => {
    const err = new ExportServerError('FFMPEG_NOT_FOUND', 'No ffmpeg binary found for export.')

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ExportServerError)
    expect(err.name).toBe('ExportServerError')
    expect(err.code).toBe('FFMPEG_NOT_FOUND')
    expect(err.message).toBe('No ffmpeg binary found for export.')
    expect(err.stderr).toBeUndefined()
  })

  it('survives instanceof checks across a throw/catch boundary', () => {
    const raise = () => {
      throw new ExportServerError('SOURCE_UNSUPPORTED', 'unsupported source')
    }

    try {
      raise()
      expect.unreachable()
    } catch (err) {
      expect(err instanceof ExportServerError).toBe(true)
      expect((err as ExportServerError).code).toBe('SOURCE_UNSUPPORTED')
    }
  })

  it('exposes the stderr tail when the failure came from a child process', () => {
    const err = new ExportServerError('ENCODE_FAILED', 'ffmpeg exited with code 1', {
      stderr: 'Unknown encoder ...',
    })

    expect(err.stderr).toBe('Unknown encoder ...')
  })

  it('chains the original error via the standard cause option', () => {
    const original = new Error('ENOENT: spawn ffmpeg')
    const err = new ExportServerError('FFMPEG_NOT_FOUND', 'ffmpeg not found', {
      cause: original,
    })

    expect(err.cause).toBe(original)
  })

  it('omits cause entirely when none is given, rather than setting it to undefined', () => {
    const err = new ExportServerError('PLAN_INVALID', 'plan invalid')

    expect('cause' in err).toBe(false)
  })

  it('keeps every ExportErrorCode member constructible (compile-time exhaustiveness)', () => {
    const codes = [
      'FFMPEG_NOT_FOUND',
      'FFMPEG_TOO_OLD',
      'ENCODER_MISSING',
      'EMPTY_PROJECT',
      'PLAN_INVALID',
      'PROBE_FAILED',
      'SOURCE_UNSUPPORTED',
      'FONT_LOAD_FAILED',
      'DECODE_FAILED',
      'ENCODE_FAILED',
      'OUTPUT_INVALID',
      'ABORTED',
    ] as const

    for (const code of codes) {
      expect(new ExportServerError(code, code).code).toBe(code)
    }
  })
})
