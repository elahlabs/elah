import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

import { isRemoteUrl, resolveSource } from '../sources'
import { ExportServerError } from '../../errors'

const BASE_DIR = '/project/dir'

describe('isRemoteUrl', () => {
  it('is true for http and https URLs', () => {
    expect(isRemoteUrl('http://example.com/a.mp4')).toBe(true)
    expect(isRemoteUrl('https://example.com/a.mp4')).toBe(true)
  })

  it('is false for relative, absolute, file:// and in-memory sources', () => {
    expect(isRemoteUrl('media/a.mp4')).toBe(false)
    expect(isRemoteUrl('/abs/media/a.mp4')).toBe(false)
    expect(isRemoteUrl('file:///abs/media/a.mp4')).toBe(false)
    expect(isRemoteUrl('blob:https://example.com/uuid')).toBe(false)
    expect(isRemoteUrl('data:video/mp4;base64,AAA')).toBe(false)
  })
})

describe('resolveSource', () => {
  it('resolves a relative path against the base directory', () => {
    expect(resolveSource('media/a.mp4', BASE_DIR)).toBe(resolve(BASE_DIR, 'media/a.mp4'))
  })

  it('passes an absolute path through unchanged', () => {
    expect(resolveSource('/abs/media/a.mp4', BASE_DIR)).toBe('/abs/media/a.mp4')
  })

  it('converts a file:// URL to a filesystem path', () => {
    expect(resolveSource('file:///abs/media/a.mp4', BASE_DIR)).toBe('/abs/media/a.mp4')
  })

  it('passes http(s) URLs through unchanged, ignoring baseDir', () => {
    expect(resolveSource('http://example.com/a.mp4', BASE_DIR)).toBe('http://example.com/a.mp4')
    expect(resolveSource('https://example.com/a.mp4', BASE_DIR)).toBe('https://example.com/a.mp4')
  })

  it('throws SOURCE_UNSUPPORTED for blob: sources', () => {
    expect(() => resolveSource('blob:https://example.com/uuid', BASE_DIR)).toThrow(
      ExportServerError,
    )
    try {
      resolveSource('blob:https://example.com/uuid', BASE_DIR)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ExportServerError)
      expect((err as ExportServerError).code).toBe('SOURCE_UNSUPPORTED')
    }
  })

  it('throws SOURCE_UNSUPPORTED for data: sources', () => {
    expect(() => resolveSource('data:video/mp4;base64,AAA', BASE_DIR)).toThrow(ExportServerError)
  })
})
