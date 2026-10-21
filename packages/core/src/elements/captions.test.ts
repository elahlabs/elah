import { describe, expect, it } from 'vitest'
import { captionClipsFromTranscript, distributeWordsEvenly, estimateWordTimings, type TranscriptWord } from './captions'
import { captionWordState } from '../renderer/gpu/layers/textPaint'

const HELLO_WORLD: TranscriptWord[] = [
  { text: 'Hello', startSeconds: 0, endSeconds: 0.5 },
  { text: 'world', startSeconds: 0.5, endSeconds: 1 },
]

describe('captionClipsFromTranscript', () => {
  it('groups two close words into one 30-frame clip with clip-local word bounds', () => {
    const clips = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1' })
    expect(clips).toHaveLength(1)
    const [clip] = clips
    expect(clip!.startFrame).toBe(0)
    expect(clip!.durationFrames).toBe(30)
    expect(clip!.trackId).toBe('t1')
    expect(clip!.type).toBe('text')
    expect(clip!.content).toBe('Hello world')
    expect(clip!.words).toEqual([
      { text: 'Hello', start: 0, end: 15 },
      { text: 'world', start: 15, end: 30 },
    ])
    // Default mode is 'static': no captionMode is stored, matching captionModePatch.
    expect(clip!.captionMode).toBeUndefined()
  })

  it('offsets the clip by startFrame without changing the local word bounds', () => {
    const [clip] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', startFrame: 60 })
    expect(clip!.startFrame).toBe(60)
    expect(clip!.durationFrames).toBe(30)
    expect(clip!.words).toEqual([
      { text: 'Hello', start: 0, end: 15 },
      { text: 'world', start: 15, end: 30 },
    ])
  })

  it('splits into two groups when the gap between words exceeds maxGapSeconds', () => {
    const words: TranscriptWord[] = [
      { text: 'Hello', startSeconds: 0, endSeconds: 0.5 },
      { text: 'world', startSeconds: 1.2, endSeconds: 1.7 }, // gap = 0.7 > default 0.6
    ]
    const clips = captionClipsFromTranscript(words, { fps: 30, trackId: 't1' })
    expect(clips).toHaveLength(2)
    expect(clips[0]!.content).toBe('Hello')
    expect(clips[1]!.content).toBe('world')
  })

  it('does not split when the gap is comfortably under maxGapSeconds', () => {
    const words: TranscriptWord[] = [
      { text: 'Hello', startSeconds: 0, endSeconds: 0.5 },
      { text: 'world', startSeconds: 1, endSeconds: 1.5 }, // gap = 0.5, under the default 0.6
    ]
    const clips = captionClipsFromTranscript(words, { fps: 30, trackId: 't1' })
    expect(clips).toHaveLength(1)
  })

  it('splits every maxWords-th word into a new group', () => {
    const words: TranscriptWord[] = Array.from({ length: 7 }, (_, i) => ({
      text: `w${i}`,
      startSeconds: i * 0.2,
      endSeconds: i * 0.2 + 0.15,
    }))
    const clips = captionClipsFromTranscript(words, { fps: 30, trackId: 't1' })
    expect(clips).toHaveLength(2)
    expect(clips[0]!.content!.split(' ')).toHaveLength(6)
    expect(clips[1]!.content!.split(' ')).toHaveLength(1)
  })

  it('splits after a word ending in sentence punctuation even under maxWords and the gap threshold', () => {
    const words: TranscriptWord[] = [
      { text: 'Hi.', startSeconds: 0, endSeconds: 0.3 },
      { text: 'World', startSeconds: 0.3, endSeconds: 0.6 },
    ]
    const clips = captionClipsFromTranscript(words, { fps: 30, trackId: 't1' })
    expect(clips).toHaveLength(2)
    expect(clips[0]!.content).toBe('Hi.')
    expect(clips[1]!.content).toBe('World')
  })

  it('stores the requested captionMode, unless it is the static default', () => {
    const [karaoke] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', mode: 'karaoke' })
    expect(karaoke!.captionMode).toBe('karaoke')
    const [reveal] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', mode: 'reveal' })
    expect(reveal!.captionMode).toBe('reveal')
    const [staticMode] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', mode: 'static' })
    expect(staticMode!.captionMode).toBeUndefined()
  })

  it('feeds the existing karaoke/highlight/reveal styles their local word timings without any renderer change', () => {
    const [clip] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', mode: 'highlight' })
    expect(clip!.captionMode).toBe('highlight')
    // Before "world" starts (frame 5), "Hello" is the active word.
    expect(captionWordState('highlight', clip!.words![0], 5, '#ff0').color).toBe('#ff0')
    expect(captionWordState('highlight', clip!.words![1], 5, '#ff0').color).toBeUndefined()
    // Once "world" starts (frame 20), it becomes the active word.
    expect(captionWordState('highlight', clip!.words![1], 20, '#ff0').color).toBe('#ff0')
    expect(captionWordState('highlight', clip!.words![0], 20, '#ff0').color).toBeUndefined()
  })

  it('rejects a negative word start', () => {
    expect(() =>
      captionClipsFromTranscript([{ text: 'a', startSeconds: -0.1, endSeconds: 0.2 }], { fps: 30, trackId: 't1' }),
    ).toThrow(/negative start/)
  })

  it('rejects a reversed or zero-length word span', () => {
    expect(() =>
      captionClipsFromTranscript([{ text: 'a', startSeconds: 1, endSeconds: 1 }], { fps: 30, trackId: 't1' }),
    ).toThrow(/reversed or zero-length/)
  })

  it('rejects overlapping words', () => {
    const words: TranscriptWord[] = [
      { text: 'a', startSeconds: 0, endSeconds: 1 },
      { text: 'b', startSeconds: 0.5, endSeconds: 1.5 },
    ]
    expect(() => captionClipsFromTranscript(words, { fps: 30, trackId: 't1' })).toThrow(/overlaps or precedes/)
  })

  it('rejects a transcript that is out of order rather than sorting it', () => {
    const words: TranscriptWord[] = [
      { text: 'a', startSeconds: 1, endSeconds: 2 },
      { text: 'b', startSeconds: 0, endSeconds: 0.5 },
    ]
    expect(() => captionClipsFromTranscript(words, { fps: 30, trackId: 't1' })).toThrow(/overlaps or precedes/)
  })

  it('rejects an all-whitespace word', () => {
    expect(() =>
      captionClipsFromTranscript([{ text: '   ', startSeconds: 0, endSeconds: 0.2 }], { fps: 30, trackId: 't1' }),
    ).toThrow(/whitespace/)
  })

  it('rejects a non-finite fps', () => {
    expect(() => captionClipsFromTranscript(HELLO_WORLD, { fps: Number.NaN, trackId: 't1' })).toThrow(/fps/)
    expect(() => captionClipsFromTranscript(HELLO_WORLD, { fps: Infinity, trackId: 't1' })).toThrow(/fps/)
    expect(() => captionClipsFromTranscript(HELLO_WORLD, { fps: 0, trackId: 't1' })).toThrow(/fps/)
  })

  it('rejects maxWords below 1', () => {
    expect(() => captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', maxWords: 0 })).toThrow(/maxWords/)
  })

  it('returns no clips for an empty transcript rather than throwing', () => {
    expect(captionClipsFromTranscript([], { fps: 30, trackId: 't1' })).toEqual([])
  })

  it('clamps a squeezed final word to the clip’s own last frame, never past it', () => {
    // w1 is a very short word right at the boundary maxWords forces between
    // this group and the next; the boundary-share rule clamps this group's
    // end down to 21, but w1's own quantized start also floors to 21 — the
    // exact edge where a naive clamp would push its local `end` to 22, one
    // frame past this 21-frame clip.
    const words: TranscriptWord[] = [
      { text: 'w0', startSeconds: 0, endSeconds: 0.7 },
      { text: 'w1', startSeconds: 0.7, endSeconds: 0.705 },
      { text: 'w2', startSeconds: 0.71, endSeconds: 0.9 },
    ]
    const clips = captionClipsFromTranscript(words, { fps: 30, trackId: 't1', maxWords: 2 })
    expect(clips).toHaveLength(2)
    const [first] = clips
    expect(first!.durationFrames).toBe(21)
    expect(first!.words).toEqual([
      { text: 'w0', start: 0, end: 21 },
      { text: 'w1', start: 20, end: 21 },
    ])
    for (const w of first!.words!) {
      expect(w.end).toBeLessThanOrEqual(first!.durationFrames)
      expect(w.start).toBeLessThan(w.end)
    }
  })

  it('throws rather than silently dropping a group left zero frames long by quantization', () => {
    // Forcing every word into its own group (maxWords: 1) lets a very short
    // first word's ceil'd end land past the next group's floor'd start; the
    // shared-boundary rule then clamps the first group to zero length.
    const words: TranscriptWord[] = [
      { text: 'Hi.', startSeconds: 1.0, endSeconds: 1.001 },
      { text: 'world', startSeconds: 1.001, endSeconds: 1.5 },
    ]
    expect(() => captionClipsFromTranscript(words, { fps: 30, trackId: 't1', maxWords: 1 })).toThrow(
      /zero length after quantization/,
    )
  })
})

describe('distributeWordsEvenly', () => {
  it('spreads three words over ten frames as 0..3, 3..6, 6..10', () => {
    expect(distributeWordsEvenly('one two three', 10)).toEqual([
      { text: 'one', start: 0, end: 3 },
      { text: 'two', start: 3, end: 6 },
      { text: 'three', start: 6, end: 10 },
    ])
  })

  it('rejects fewer frames than words', () => {
    expect(() => distributeWordsEvenly('one two three', 2)).toThrow(/at least 3 frames/)
  })

  it('returns an empty array for empty text', () => {
    expect(distributeWordsEvenly('', 10)).toEqual([])
  })
})

describe('estimateWordTimings (unchanged by this ticket)', () => {
  it('still spreads a line over its words in proportion to length, ending exactly at the duration', () => {
    const words = estimateWordTimings('hi world', 20)
    expect(words.map((w) => w.text)).toEqual(['hi', 'world'])
    expect(words.at(-1)!.end).toBe(20)
    expect(words[0]!.start).toBe(0)
  })
})

describe('captionClipsFromTranscript position', () => {
  it('defaults to the bottom of the frame', () => {
    const [clip] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1' })
    expect(clip!.transform).toEqual({ x: 0.5, y: 0.86, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } })
  })

  it("position 'centre' restores the middle of the frame", () => {
    const [clip] = captionClipsFromTranscript(HELLO_WORLD, { fps: 30, trackId: 't1', position: 'centre' })
    expect(clip!.transform!.y).toBe(0.5)
  })
})
