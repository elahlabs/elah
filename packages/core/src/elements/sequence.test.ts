import { describe, expect, it } from 'vitest'
import { createSequenceClip, sequenceCycleFrames } from './sequence'
import { effectsFor } from '../effects/registry'
import { baselineTransform } from './keyframes'

describe('createSequenceClip', () => {
  it('builds a sequence clip carrying src, sequence and the media defaults', () => {
    const clip = createSequenceClip({
      trackId: 't',
      startFrame: 3,
      durationFrames: 12,
      src: 'blob:g',
      sequence: { kind: 'animated-image', frameCount: 4, fps: 10, loop: true },
    })
    expect(clip.type).toBe('sequence')
    expect(clip.name).toBe('Sequence')
    expect(clip.src).toBe('blob:g')
    expect(clip.sourceStartFrame).toBe(0)
    expect(clip.sourceDurationFrames).toBe(12)
    expect(clip.sequence).toEqual({ kind: 'animated-image', frameCount: 4, fps: 10, loop: true })
  })

  it('omits src entirely when none is given (a frames sequence)', () => {
    const clip = createSequenceClip({
      trackId: 't',
      startFrame: 0,
      durationFrames: 12,
      sequence: { kind: 'frames', frameUrlTemplate: 'f/{frame}.png', frameCount: 4, fps: 10 },
    })
    expect('src' in clip).toBe(false)
  })
})

describe('sequenceCycleFrames', () => {
  it('converts one cycle at the sequence fps into project frames', () => {
    expect(sequenceCycleFrames({ frameCount: 4, fps: 10 }, 30)).toBe(12)
    expect(sequenceCycleFrames({ frameCount: 3, fps: 7 }, 30)).toBe(13)
  })

  it('never returns fewer than 1 frame', () => {
    expect(sequenceCycleFrames({ frameCount: 1, fps: 1000 }, 30)).toBe(1)
  })
})

describe('sequence effects and baseline', () => {
  it('offers the same effects as image clips', () => {
    expect(effectsFor('sequence').length).toBe(effectsFor('image').length)
  })

  it('baselineTransform treats a sequence exactly like an image', () => {
    const stage = { width: 1920, height: 1080 }
    const content = { width: 64, height: 64 }
    const sequenceClip = createSequenceClip({
      trackId: 't',
      startFrame: 0,
      durationFrames: 12,
      src: 'blob:g',
      sequence: { kind: 'animated-image', frameCount: 4, fps: 10 },
    })
    const imageClip = { ...sequenceClip, type: 'image' as const }
    expect(baselineTransform(sequenceClip, { stage, content })).toEqual(baselineTransform(imageClip, { stage, content }))
  })
})
