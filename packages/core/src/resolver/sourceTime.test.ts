import { describe, expect, it } from 'vitest'
import {
  hasTimeRemap,
  lastSourceFrame,
  remappedSourceFrames,
  sourceFrameFor,
  sourceFramesAvailable,
  sourceWindowEnd,
  speedAt,
} from './sourceTime'
import { resolveTimeline } from './resolveTimeline'
import { applySpeedPreset, clearSpeedRemap, matchSpeedPreset, speedPresetKeys, SPEED_PRESET_NAMES } from '../elements/speedPresets'
import { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip } from '../types'

function video(extra: Partial<Clip> = {}): Clip {
  return {
    id: 'v',
    trackId: 't',
    type: 'video',
    name: 'v',
    src: 'blob:v',
    startFrame: 100,
    durationFrames: 61,
    sourceStartFrame: 20,
    sourceDurationFrames: 300,
    ...extra,
  } as Clip
}

describe('sourceFrameFor', () => {
  it('constant speed is unchanged', () => {
    expect(sourceFrameFor(video(), 100)).toBe(20)
    expect(sourceFrameFor(video(), 110)).toBe(30)
    expect(sourceFrameFor(video({ speed: 2 }), 110)).toBe(40)
    expect(sourceFrameFor(video({ speed: 0.5 }), 103)).toBe(21)
    expect(hasTimeRemap(video())).toBe(false)
    expect(remappedSourceFrames(video())).toBeNull()
  })

  it('a time channel drives the source frame, clamped to the window', () => {
    const c = video({
      keyframes: {
        channels: {
          time: {
            source: { kind: 'keyframes' },
            keys: [
              { id: 'a', frame: 0, value: 100, easing: 'linear' },
              { id: 'b', frame: 60, value: 40, easing: 'linear' },
            ],
          },
        },
      },
    })
    expect(hasTimeRemap(c)).toBe(true)
    expect(sourceFrameFor(c, 100)).toBe(100)
    expect(sourceFrameFor(c, 130)).toBe(70)
    expect(sourceFrameFor(c, 160)).toBe(40)
    const clamped = video({
      keyframes: {
        channels: {
          time: { source: { kind: 'keyframes' }, keys: [{ id: 'a', frame: 0, value: 5000, easing: 'linear' }] },
        },
      },
    })
    expect(sourceFrameFor(clamped, 100)).toBe(319)
  })

  it('ignores time keys on non-video clips', () => {
    const img = { ...video(), type: 'image' } as Clip
    const withKeys = {
      ...img,
      keyframes: { channels: { time: { source: { kind: 'keyframes' as const }, keys: [{ id: 'a', frame: 0, value: 5, easing: 'linear' as const }] } } },
    } as Clip
    expect(hasTimeRemap(withKeys)).toBe(false)
  })

  it('the resolver shows the remapped frame', () => {
    const c = video({ ...applySpeedPreset(video(), 'reverse') })
    const engine = new TimelineEngine({ fps: 30 })
    const t = engine.addTrack('video').id
    const project = engine.getProject()
    const p = { ...project, clips: { ...project.clips, [t]: [{ ...c, trackId: t }] } }
    const first = resolveTimeline(100, p).videos[0]!
    const last = resolveTimeline(160, p).videos[0]!
    expect(first.sourceFrame).toBe(80)
    expect(last.sourceFrame).toBe(20)
  })
})

describe('speed presets', () => {
  it('every preset stays inside the clip and the source window', () => {
    for (const name of SPEED_PRESET_NAMES) {
      const c = video({ ...applySpeedPreset(video(), name) })
      const frames = remappedSourceFrames(c)!
      expect(frames).toHaveLength(61)
      for (const f of frames) {
        expect(f).toBeGreaterThanOrEqual(20)
        expect(f).toBeLessThanOrEqual(319)
      }
      for (const k of c.keyframes!.channels.time!.keys) {
        expect(k.frame).toBeGreaterThanOrEqual(0)
        expect(k.frame).toBeLessThanOrEqual(60)
      }
    }
  })

  it('ramp up starts slow and ends fast', () => {
    const c = video({ ...applySpeedPreset(video(), 'speed-ramp-in') })
    expect(speedAt(c, 2)).toBeLessThan(0.5)
    expect(speedAt(c, 58)).toBeGreaterThan(1.5)
    expect(sourceFrameFor(c, 160)).toBe(80)
  })

  it('freeze holds the frame at the playhead, then continues', () => {
    const c = video({ ...applySpeedPreset(video(), 'freeze-at-playhead', { atFrame: 10, holdFrames: 20 }) })
    const frames = remappedSourceFrames(c)!
    expect(frames.slice(10, 31).every((f) => f === 30)).toBe(true)
    expect(frames[9]).toBe(29)
    expect(frames[60]).toBeGreaterThan(30)
  })

  it('reverse and boomerang go backwards; ramps never do', () => {
    const back = remappedSourceFrames(video({ ...applySpeedPreset(video(), 'reverse') }))!
    expect(back[0]).toBeGreaterThan(back[60]!)
    const boom = remappedSourceFrames(video({ ...applySpeedPreset(video(), 'boomerang') }))!
    expect(boom[30]).toBeGreaterThan(boom[0]!)
    expect(boom[60]).toBe(boom[0])
    const ramp = remappedSourceFrames(video({ ...applySpeedPreset(video(), 'slow-mo-middle') }))!
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]!)
  })

  it('replaces the previous remap, clears, matches, and ignores non-video', () => {
    const a = video({ ...applySpeedPreset(video(), 'reverse') })
    const b = { ...a, ...applySpeedPreset(a, 'speed-ramp-out') }
    expect(b.keyframes!.channels.time!.keys).toHaveLength(2)
    expect(matchSpeedPreset(b, b.keyframes!.channels.time!.keys)).toBe('speed-ramp-out')
    expect({ ...b, ...clearSpeedRemap(b) }.keyframes).toBeUndefined()
    expect(applySpeedPreset({ ...video(), type: 'image' } as Clip, 'reverse')).toEqual({})
    expect(speedPresetKeys(video(), 'reverse')[0]).toEqual({ frame: 0, value: 80 })
  })

  it('the engine refuses a constant speed on a remapped clip', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const t = engine.addTrack('video').id
    const c = engine.addClip({ trackId: t, type: 'video', name: 'v', src: 'blob:v', startFrame: 0, durationFrames: 60 } as never)
    const clip = engine.findClip(c.id)!.clip
    engine.updateClip(c.id, t, applySpeedPreset(clip, 'reverse'))
    engine.setClipSpeed(c.id, t, 2)
    expect(engine.findClip(c.id)!.clip.speed).toBeUndefined()
    engine.updateClip(c.id, t, clearSpeedRemap(engine.findClip(c.id)!.clip))
    engine.setClipSpeed(c.id, t, 2)
    expect(engine.findClip(c.id)!.clip.speed).toBe(2)
  })
})
describe('media length (PV-T5-1)', () => {
  it('sourceFramesAvailable falls back to the window when assetFrames is absent', () => {
    // Legacy: the start is ignored, because the window length is all an older
    // document knows.
    expect(sourceFramesAvailable({ sourceStartFrame: 20, sourceDurationFrames: 30 })).toBe(30)
    expect(sourceFramesAvailable({ sourceStartFrame: 20, sourceDurationFrames: 30 }, 0)).toBe(30)
  })

  it('sourceFramesAvailable measures from the in-point to the real media end', () => {
    expect(sourceFramesAvailable({ assetFrames: 100, sourceStartFrame: 20, sourceDurationFrames: 30 })).toBe(80)
    expect(sourceFramesAvailable({ assetFrames: 100, sourceStartFrame: 20, sourceDurationFrames: 30 }, 90)).toBe(10)
    // Past the end of the media there is nothing left, never a negative.
    expect(sourceFramesAvailable({ assetFrames: 100, sourceStartFrame: 20, sourceDurationFrames: 30 }, 120)).toBe(0)
  })

  it('lastSourceFrame is the window end for a legacy clip and the media end otherwise', () => {
    expect(lastSourceFrame({ sourceDurationFrames: 30 })).toBe(29)
    expect(lastSourceFrame({ assetFrames: 100, sourceDurationFrames: 30 })).toBe(99)
  })

  it('sourceWindowEnd is unchanged for a legacy clip', () => {
    expect(sourceWindowEnd(video({ assetFrames: undefined }))).toBe(319)
    expect(sourceWindowEnd(video({ sourceStartFrame: 10, sourceDurationFrames: 30 }))).toBe(39)
  })

  it('sourceWindowEnd reaches the real end of the media', () => {
    expect(sourceWindowEnd(video({ assetFrames: 100, sourceStartFrame: 20, sourceDurationFrames: 10 }))).toBe(99)
  })

  it('a remap may reach the media end, not just the window end', () => {
    const remapped = video({ assetFrames: 100, sourceStartFrame: 20, sourceDurationFrames: 10 })
    const keys = { channels: { time: { keys: [{ frame: 0, value: 95 }] } } }
    const withKeys = { ...remapped, keyframes: keys } as unknown as Clip
    expect(sourceFrameFor(withKeys, 100)).toBe(95)
    // The same clip without assetFrames still stops at the window end (29).
    const legacy = { ...remapped, assetFrames: undefined, keyframes: keys } as unknown as Clip
    expect(sourceFrameFor(legacy, 100)).toBe(29)
  })
})

describe('time remap on a compound (PV-P1)', () => {
  const withTimeKeys = (type: 'video' | 'compound') =>
    ({
      id: 'c',
      trackId: 't',
      type,
      name: 'C',
      startFrame: 100,
      durationFrames: 60,
      sourceStartFrame: 0,
      sourceDurationFrames: 60,
      keyframes: {
        channels: {
          time: { source: { kind: 'keyframes' as const }, keys: [{ id: 'a', frame: 0, value: 50, easing: 'linear' as const }, { id: 'b', frame: 10, value: 40, easing: 'linear' as const }] },
        },
      },
    }) as unknown as Clip

  it('maps timeline frames to nested frames exactly as video does', () => {
    const clip = withTimeKeys('compound')
    expect(hasTimeRemap(clip)).toBe(true)
    expect(sourceFrameFor(clip, clip.startFrame + 10)).toBe(40)
  })

  it('a video clip still takes one, unchanged', () => {
    const clip = withTimeKeys('video')
    expect(hasTimeRemap(clip)).toBe(true)
    expect(sourceFrameFor(clip, clip.startFrame + 10)).toBe(40)
  })
})
