import { describe, it, expect } from 'vitest'
import { LARGE_LOCAL_SOURCE_BYTES, shouldDecodeWaveform } from './importFiles'

describe('shouldDecodeWaveform (LM-P1)', () => {
  it('is 2 GiB', () => {
    expect(LARGE_LOCAL_SOURCE_BYTES).toBe(2 * 1024 ** 3)
  })

  it('decodes ordinary and unknown-size sources', () => {
    expect(shouldDecodeWaveform({ byteSize: 0 })).toBe(true)
    expect(shouldDecodeWaveform({ byteSize: 50 * 1024 ** 2 })).toBe(true)
  })

  it('decodes a source of exactly the limit', () => {
    expect(shouldDecodeWaveform({ byteSize: LARGE_LOCAL_SOURCE_BYTES })).toBe(true)
  })

  it('skips a source over the limit', () => {
    expect(shouldDecodeWaveform({ byteSize: LARGE_LOCAL_SOURCE_BYTES + 1 })).toBe(false)
    expect(shouldDecodeWaveform({ byteSize: 10 * 1024 ** 3 })).toBe(false)
  })
})
