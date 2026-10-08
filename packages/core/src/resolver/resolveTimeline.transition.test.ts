import { describe, expect, it } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import type { Clip, Project, Track } from '../types'

/**
 * Covers the crossfade. Measured in an exported file before this was fixed:
 * across the first half of a 20-frame fade the picture fell to 48% of its
 * brightness and then jumped back by 117% on the cut frame. The incoming clip
 * had no decoded frame yet, so the outgoing one dissolved into black; and for
 * the second half both clips carried the same zIndex, so a stable sort drew the
 * outgoing clip on top of the dissolve it was supposed to be disappearing into.
 */
const track: Track = {
  id: 'v',
  name: 'Video',
  kind: 'video',
  order: 0,
  height: 64,
  locked: false,
  disabled: false,
  muted: false,
  solo: false,
}

const clip = (over: Partial<Clip>): Clip => ({
  id: 'c',
  trackId: 'v',
  type: 'video',
  name: 'C',
  startFrame: 0,
  durationFrames: 90,
  sourceStartFrame: 0,
  sourceDurationFrames: 90,
  src: 'a.mp4',
  ...over,
})

// A ends at 90 and B starts there; the fade spans 80..99, straddling the cut.
const project = (kind: 'fade' | 'slide' = 'fade'): Project => ({
  id: 'p',
  fps: 30,
  stage: { width: 1080, height: 1920 },
  tracks: [track],
  clips: {
    v: [
      clip({ id: 'a', src: 'a.mp4', sourceStartFrame: 10 }),
      clip({ id: 'b', src: 'b.mp4', startFrame: 90, sourceStartFrame: 10 }),
    ],
  },
  transitions: [
    {
      id: 't',
      kind,
      fromClipId: 'a',
      toClipId: 'b',
      trackId: 'v',
      startFrame: 80,
      durationFrames: 20,
    },
  ],
  version: 1,
})

const videos = (frame: number, kind: 'fade' | 'slide' = 'fade') =>
  Object.fromEntries(resolveTimeline(frame, project(kind)).videos.map((v) => [v.id, v]))

describe('resolveTimeline — crossfade', () => {
  it('shows both clips through the whole window, the incoming one rising', () => {
    for (const [frame, t] of [[80, 0], [85, 0.25], [90, 0.5], [95, 0.75]] as const) {
      const v = videos(frame)
      expect(v.a, `frame ${frame} is missing the outgoing clip`).toBeDefined()
      expect(v.b, `frame ${frame} is missing the incoming clip`).toBeDefined()
      expect(v.a.opacity).toBe(1)
      expect(v.b.opacity).toBeCloseTo(t, 5)
    }
  })

  it('draws the incoming clip over the outgoing one on both sides of the cut', () => {
    for (const frame of [80, 85, 90, 95, 99]) {
      const v = videos(frame)
      expect(v.b.zIndex, `frame ${frame} stacks the dissolve the wrong way`).toBeGreaterThan(
        v.a.zIndex,
      )
    }
  })

  it('reads each clip out of its handles rather than freezing on an edge frame', () => {
    // The incoming clip starts at 90 with 10 frames of handle in front of it.
    expect(videos(80).b.sourceFrame).toBe(0)
    expect(videos(85).b.sourceFrame).toBe(5)
    // The outgoing clip has ended by 95, so it runs on past its trim window.
    expect(videos(95).a.sourceFrame).toBe(105)
  })

  it('leaves slide to the snapshot compositor', () => {
    const v = videos(85, 'slide')
    expect(v.a.opacity).toBe(0)
    expect(v.b.opacity).toBe(1)
  })
})
