import { describe, expect, it } from 'vitest'
import { encoderPrimingFrames } from '../encoderPriming'

/**
 * Measured on a clean single-clip export: the sound arrived 48 ms after its
 * picture, every time, with no drift — 2112 samples at 44.1 kHz. Dropping that
 * many frames off the front of the mix brought it to 0.
 */
describe('encoderPrimingFrames', () => {
  it('drops what an AAC encoder will put back', () => {
    expect(encoderPrimingFrames('aac', 44_100 * 10)).toBe(2112)
  })

  it('leaves codecs that declare their own pre-skip alone', () => {
    expect(encoderPrimingFrames('opus', 44_100 * 10)).toBe(0)
    expect(encoderPrimingFrames('vorbis', 44_100 * 10)).toBe(0)
  })

  it('never asks for more than the mix has', () => {
    expect(encoderPrimingFrames('aac', 500)).toBe(500)
    expect(encoderPrimingFrames('aac', 0)).toBe(0)
  })
})
