import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { rollEdit, slideClip, slipBounds, slipClip } from './trimModes'

/** Roll, slide and slip (PV-T1), each one undo step or nothing. */

function setup() {
  const engine = new TimelineEngine({ fps: 30, initialTracks: [{ kind: 'video', name: 'V1' }] })
  const v1 = engine.getProject().tracks[0]!.id
  const clip = (name: string, start: number, dur: number, source: { duration?: number; start?: number } = {}) => {
    const c = engine.addClip({ trackId: v1, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: dur })
    engine.updateClip(c.id, v1, {
      sourceDurationFrames: source.duration ?? dur,
      ...(source.start !== undefined ? { sourceStartFrame: source.start } : {}),
    })
    return c.id
  }
  const get = (id: string) => engine.findClip(id)!.clip
  const layout = () => engine.getClipsOnTrack(v1).map((c) => [c.name, c.startFrame, c.durationFrames] as const)
  return { engine, v1, clip, get, layout }
}

describe('rollEdit', () => {
  it('moves the cut right: the left clip grows, the right clip starts later in its media', () => {
    const { engine, clip, get, layout } = setup()
    const a = clip('a', 0, 30, { duration: 60 })
    const b = clip('b', 30, 30, { duration: 60, start: 10 })

    expect(rollEdit(engine, a, b, 5)).toEqual({ ok: true, data: { cutFrame: 35 } })
    expect(layout()).toEqual([['a', 0, 35], ['b', 35, 25]])
    expect(get(b).sourceStartFrame).toBe(15)
    expect(engine.lastHistoryDescription()).toBe('Roll edit')
  })

  it('moves the cut left: the right clip reveals earlier media', () => {
    const { engine, clip, get, layout } = setup()
    const a = clip('a', 0, 30, { duration: 60 })
    const b = clip('b', 30, 30, { duration: 60, start: 10 })

    expect(rollEdit(engine, a, b, -5).ok).toBe(true)
    expect(layout()).toEqual([['a', 0, 25], ['b', 25, 35]])
    expect(get(b).sourceStartFrame).toBe(5)
  })

  it('refuses a roll past the media and changes nothing', () => {
    const { engine, clip } = setup()
    const a = clip('a', 0, 30) // no media after its end
    const b = clip('b', 30, 30, { duration: 60, start: 10 })
    const before = engine.getProject()

    expect(rollEdit(engine, a, b, 5)).toEqual({ ok: false, reason: 'media-limit' })
    expect(engine.getProject()).toBe(before)
  })

  it('refuses clips that do not share a cut', () => {
    const { engine, clip } = setup()
    const a = clip('a', 0, 30)
    const b = clip('b', 40, 30)
    expect(rollEdit(engine, a, b, 2)).toEqual({ ok: false, reason: 'not-adjacent' })
  })
})

describe('slideClip', () => {
  it('slides right between touching neighbours: the left grows, the right shrinks from its head', () => {
    const { engine, clip, get, layout } = setup()
    clip('L', 0, 30, { duration: 60 })
    const c = clip('C', 30, 30)
    const r = clip('R', 60, 30, { duration: 60, start: 10 })

    expect(slideClip(engine, c, 5)).toEqual({ ok: true, data: { startFrame: 35 } })
    expect(layout()).toEqual([['L', 0, 35], ['C', 35, 30], ['R', 65, 25]])
    expect(get(r).sourceStartFrame).toBe(15)
    expect(get(c).sourceStartFrame).toBe(0) // the slid clip's content is unchanged
  })

  it('slides left when the right neighbour has earlier media to reveal', () => {
    const { engine, clip, layout } = setup()
    clip('L', 0, 30, { duration: 60 })
    const c = clip('C', 30, 30)
    clip('R', 60, 30, { duration: 60, start: 10 })

    expect(slideClip(engine, c, -5).ok).toBe(true)
    expect(layout()).toEqual([['L', 0, 25], ['C', 25, 30], ['R', 55, 35]])
  })

  it('rolls back when a neighbour has no media to give', () => {
    const { engine, clip } = setup()
    clip('L', 0, 30) // cannot grow
    const c = clip('C', 30, 30)
    clip('R', 60, 30, { duration: 60, start: 10 })
    const before = engine.getProject()

    expect(slideClip(engine, c, 5)).toEqual({ ok: false, reason: 'media-limit' })
    expect(engine.getProject()).toBe(before)
  })

  it('moves into free space on a side with no touching neighbour', () => {
    const { engine, clip, layout } = setup()
    const c = clip('C', 30, 30)
    expect(slideClip(engine, c, -10).ok).toBe(true)
    expect(layout()).toEqual([['C', 20, 30]])
  })
})

describe('slipClip', () => {
  it('moves the media under a clip that stays put, clamped to what the source holds', () => {
    const { engine, clip, get, layout } = setup()
    const c = clip('C', 0, 30, { duration: 100, start: 10 })

    expect(slipClip(engine, c, 20)).toEqual({ ok: true, data: { sourceStartFrame: 30 } })
    expect(slipClip(engine, c, 500)).toEqual({ ok: true, data: { sourceStartFrame: 70 } })
    expect(slipClip(engine, c, -500)).toEqual({ ok: true, data: { sourceStartFrame: 0 } })
    expect(layout()).toEqual([['C', 0, 30]])
    expect(get(c).durationFrames).toBe(30)
  })

  it('refuses clips with no media to slip', () => {
    const { engine, v1 } = setup()
    const t = engine.addClip({ trackId: v1, type: 'text', name: 't', startFrame: 0, durationFrames: 30, text: { content: 'Hi' } })
    expect(slipClip(engine, t.id, 5)).toEqual({ ok: false, reason: 'not-slippable' })
  })

  it('never slips a split half later than it already is (its window length is all it knows)', () => {
    const { clip, get } = setup()
    const c = clip('C', 0, 30, { duration: 30, start: 12 })
    expect(slipBounds(get(c))).toEqual({ min: 0, max: 12 })
  })
})
describe('slipBounds with the real media length (PV-T5-1)', () => {
  const base = { id: 'c', trackId: 't', type: 'video' as const, name: 'c', src: 'a.mp4', startFrame: 0, sourceStartFrame: 20, sourceDurationFrames: 20, durationFrames: 20 }

  it('legacy: the window is the limit', () => {
    expect(slipBounds(base as never)).toEqual({ min: 0, max: 20 })
  })

  it('with assetFrames the content can slide anywhere it fits in the asset', () => {
    // 20 frames of content, 100 frames of media, currently at source frame 20.
    expect(slipBounds({ ...base, assetFrames: 100 } as never)).toEqual({ min: 0, max: 80 })
  })

  it('never slides past the end of the media, and never behind the current in-point', () => {
    // 90 frames of content in a 100-frame asset: the only fitting in-point is 10.
    expect(slipBounds({ ...base, durationFrames: 90, assetFrames: 100 } as never)).toEqual({ min: 0, max: 20 })
  })

  it('slides further with assetFrames than the legacy window allows', () => {
    const { engine, v1, clip, get } = setup()
    const id = clip('a', 0, 20, { duration: 20, start: 20 })
    engine.updateClip(id, v1, { assetFrames: 100 })
    expect(slipBounds(get(id))).toEqual({ min: 0, max: 80 })
    expect(slipClip(engine, id, 60).ok).toBe(true)
    expect(get(id).sourceStartFrame).toBe(80)
  })
})