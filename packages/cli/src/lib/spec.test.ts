import { describe, it, expect } from 'vitest'
import { specToProject, validateSpec, type BuildSpec, type ProbedAsset } from './spec'
import { CliError } from './errors'

const ASSETS = new Map<string, ProbedAsset>([
  ['main', { src: '/abs/main.mp4', durationSec: 10 }],
  ['music', { src: '/abs/music.mp3', durationSec: 30 }],
  ['logo', { src: '/abs/logo.png' }],
])

function build(clips: BuildSpec['clips'], extra: Partial<BuildSpec> = {}) {
  return specToProject({ clips, ...extra }, ASSETS)
}

describe('specToProject', () => {
  it('converts seconds to frames at the spec fps', () => {
    const p = build([{ track: 'video', asset: 'main', start: 0.5, duration: 2 }], { fps: 30 })
    const clip = Object.values(p.clips).flat()[0]
    expect(clip.startFrame).toBe(15)
    expect(clip.durationFrames).toBe(60)
  })

  it('defaults video duration to the media remainder after sourceStart', () => {
    const p = build([{ track: 'video', asset: 'main', start: 0, sourceStart: 4 }])
    const clip = Object.values(p.clips).flat()[0]
    expect(clip.durationFrames).toBe(180) // (10 - 4)s @ 30fps
    expect(clip.sourceStartFrame).toBe(120)
    // real media length recorded so later trims know the true bounds
    expect(clip.sourceDurationFrames).toBe(300)
  })

  it('rejects durations beyond the media remainder, naming the clip', () => {
    try {
      build([{ track: 'video', asset: 'main', start: 0, sourceStart: 8, duration: 5 }])
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('clips[0]')
      expect((err as CliError).message).toContain('exceeds')
    }
  })

  it('rejects sourceStart beyond the media length', () => {
    expect(() => build([{ track: 'audio', asset: 'music', start: 0, sourceStart: 31 }])).toThrow(/beyond the media length/)
  })

  it('surfaces engine overlap rejection with clip context', () => {
    try {
      build([
        { track: 'video', asset: 'main', start: 0, duration: 5 },
        { track: 'video', asset: 'main', start: 3, duration: 5 },
      ])
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('clips[1]')
    }
  })

  it('shares an elements track for non-overlapping text, allocates a second for overlaps', () => {
    const p = build([
      { track: 'text', text: 'One', start: 0, duration: 2 },
      { track: 'text', text: 'Two', start: 3, duration: 2 },
      { track: 'text', text: 'Overlap', start: 1, duration: 3 },
    ])
    const elementTracks = p.tracks.filter((t) => t.kind === 'elements')
    expect(elementTracks).toHaveLength(2)
    const first = p.clips[elementTracks[0].id]
    const second = p.clips[elementTracks[1].id]
    expect(first.map((c) => c.content)).toEqual(['One', 'Two'])
    expect(second.map((c) => c.content)).toEqual(['Overlap'])
  })

  it('first-fits overlapping audio onto extra audio tracks', () => {
    const p = build([
      { track: 'audio', asset: 'music', start: 0, duration: 5 },
      { track: 'audio', asset: 'music', start: 2, duration: 5 },
    ])
    expect(p.tracks.filter((t) => t.kind === 'audio')).toHaveLength(2)
  })

  it('maps x/y/scale onto a centered transform, omitting it when unset', () => {
    const p = build([
      { track: 'text', text: 'Placed', start: 0, duration: 1, x: 0.5, y: 0.85 },
      { track: 'text', text: 'Default', start: 2, duration: 1 },
    ])
    const clips = Object.values(p.clips).flat()
    expect(clips.find((c) => c.content === 'Placed')!.transform).toEqual({
      x: 0.5, y: 0.85, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 },
    })
    expect(clips.find((c) => c.content === 'Default')!.transform).toBeUndefined()
  })

  it('rejects unknown asset names', () => {
    expect(() => build([{ track: 'video', asset: 'ghost', start: 0 }])).toThrow(/unknown asset 'ghost'/)
  })

  it('requires explicit duration for images', () => {
    expect(() => build([{ track: 'image', asset: 'logo', start: 0 }])).toThrow(/explicit duration/)
  })
})

describe('validateSpec', () => {
  const valid = { clips: [{ track: 'text', text: 'x', start: 0, duration: 1 }] }

  it('accepts a minimal valid spec', () => {
    expect(validateSpec(valid).clips).toHaveLength(1)
  })

  it('rejects structural problems with path-addressed messages', () => {
    const cases: Array<[unknown, RegExp]> = [
      [[], /expected a JSON object/],
      [{ clips: [] }, /'clips' must be a non-empty array/],
      [{ fps: 29.97, ...valid }, /'fps' must be a positive integer/],
      [{ clips: [{ track: 'gif', start: 0 }] }, /clips\[0\]\.track/],
      [{ clips: [{ track: 'video', asset: 'a', start: -1 }] }, /clips\[0\]\.start/],
      [{ clips: [{ track: 'text', start: 0, duration: 1 }] }, /clips\[0\]\.text/],
      [{ clips: [{ track: 'text', text: 'x', start: 0 }] }, /text clips need an explicit duration/],
      [{ clips: [{ track: 'video', start: 0 }] }, /clips\[0\]\.asset/],
    ]
    for (const [spec, pattern] of cases) {
      expect(() => validateSpec(spec), JSON.stringify(spec)).toThrow(pattern)
    }
  })
})
