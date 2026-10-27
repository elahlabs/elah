import { describe, expect, it } from 'vitest'
import { isDrawableSequence, sequenceFrameIndex, sequenceFrameUrl, sequenceSourceKey } from './sequence'

describe('sequenceFrameIndex', () => {
  it('holds at the last frame without loop', () => {
    const seq = { frameCount: 5, fps: 10 }
    expect(sequenceFrameIndex(seq, 0, 30)).toBe(0)
    expect(sequenceFrameIndex(seq, 2, 30)).toBe(0)
    expect(sequenceFrameIndex(seq, 3, 30)).toBe(1)
    expect(sequenceFrameIndex(seq, 14, 30)).toBe(4)
    expect(sequenceFrameIndex(seq, 15, 30)).toBe(4)
    expect(sequenceFrameIndex(seq, 29, 30)).toBe(4)
  })

  it('wraps modulo frameCount with loop', () => {
    const seq = { frameCount: 5, fps: 10, loop: true }
    expect(sequenceFrameIndex(seq, 15, 30)).toBe(0)
    expect(sequenceFrameIndex(seq, 29, 30)).toBe(4)
  })

  it('converts through the sequence and project fps', () => {
    expect(sequenceFrameIndex({ frameCount: 5, fps: 12.5 }, 2, 25)).toBe(1)
    expect(sequenceFrameIndex({ frameCount: 1000, fps: 29.97 }, 100, 29.97)).toBe(100)
  })

  it('returns 0 for a degenerate frameCount', () => {
    expect(sequenceFrameIndex({ frameCount: 0, fps: 10 }, 5, 30)).toBe(0)
  })
})

describe('sequenceFrameUrl', () => {
  it('substitutes a plain {frame}', () => {
    expect(sequenceFrameUrl('f_{frame}.png', 7)).toBe('f_7.png')
  })

  it('zero-pads {frame:N} and applies startNumber', () => {
    expect(sequenceFrameUrl('f_{frame:4}.png', 7, 1)).toBe('f_0008.png')
  })

  it('replaces every placeholder in the template', () => {
    expect(sequenceFrameUrl('a{frame}/b{frame:3}', 5)).toBe('a5/b005')
  })

  it('never truncates a value wider than its pad width', () => {
    expect(sequenceFrameUrl('{frame:2}', 123)).toBe('123')
  })

  it('is a no-op with no placeholder', () => {
    expect(sequenceFrameUrl('still.png', 3)).toBe('still.png')
  })
})

describe('isDrawableSequence', () => {
  it('an animated-image with src is drawable', () => {
    expect(
      isDrawableSequence({ type: 'sequence', src: 'blob:g', sequence: { kind: 'animated-image', frameCount: 4, fps: 10 } }),
    ).toBe(true)
  })

  it('an animated-image without src is not drawable', () => {
    expect(
      isDrawableSequence({ type: 'sequence', sequence: { kind: 'animated-image', frameCount: 4, fps: 10 } }),
    ).toBe(false)
  })

  it('a frames sequence with a valid template is drawable', () => {
    expect(
      isDrawableSequence({
        type: 'sequence',
        sequence: { kind: 'frames', frameUrlTemplate: 'x_{frame}.png', frameCount: 4, fps: 10 },
      }),
    ).toBe(true)
  })

  it('a frames sequence with no placeholder is not drawable', () => {
    expect(
      isDrawableSequence({
        type: 'sequence',
        sequence: { kind: 'frames', frameUrlTemplate: 'x.png', frameCount: 4, fps: 10 },
      }),
    ).toBe(false)
  })

  it('a non-integer frameCount is not drawable', () => {
    expect(
      isDrawableSequence({ type: 'sequence', src: 'blob:g', sequence: { kind: 'animated-image', frameCount: 2.5, fps: 10 } }),
    ).toBe(false)
  })

  it('a zero fps is not drawable', () => {
    expect(
      isDrawableSequence({ type: 'sequence', src: 'blob:g', sequence: { kind: 'animated-image', frameCount: 4, fps: 0 } }),
    ).toBe(false)
  })

  it('a non-sequence type is never drawable', () => {
    expect(
      isDrawableSequence({ type: 'image', src: 'blob:g', sequence: { kind: 'animated-image', frameCount: 4, fps: 10 } }),
    ).toBe(false)
  })
})

describe('sequenceSourceKey', () => {
  it('keys an animated-image by its src', () => {
    expect(sequenceSourceKey({ kind: 'animated-image', src: 'blob:1' })).toBe('a:blob:1')
  })

  it('keys a frames sequence by its template and startNumber', () => {
    expect(sequenceSourceKey({ kind: 'frames', frameUrlTemplate: 'u/{frame}.png' })).toBe('f:u/{frame}.png#0')
  })
})
