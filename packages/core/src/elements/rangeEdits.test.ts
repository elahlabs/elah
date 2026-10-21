import { describe, expect, it } from 'vitest'
import type { Clip } from '../types'
import {
  clipSourceWindowSec,
  collapseFrame,
  planCaptionRemoval,
  planMemberCuts,
  planSourceRanges,
  segmentIndex,
  sourceRangesToLocalFrames,
} from './rangeEdits'

const win = { from: 0, to: 10 }

describe('planSourceRanges', () => {
  it('sorts, merges ranges closer than 0.12 s, clamps to the window and drops ranges under 0.05 s', () => {
    const r = planSourceRanges(
      [
        { from: 6, to: 7 },
        { from: 1, to: 2 },
        { from: 2.1, to: 3 }, // 0.1 s after the previous one: merged
        { from: 4, to: 4.04 }, // too short
        { from: 9.5, to: 14 }, // overhangs the end: clamped
      ],
      win,
    )
    expect(r).toEqual({
      ok: true,
      ranges: [
        { from: 1, to: 3 },
        { from: 6, to: 7 },
        { from: 9.5, to: 10 },
      ],
    })
  })

  it('keeps two ranges that are exactly 0.12 s apart separate', () => {
    const r = planSourceRanges([{ from: 1, to: 2 }, { from: 2.12, to: 3 }], win)
    expect(r.ok && r.ranges).toHaveLength(2)
  })

  it('a tiny range beside a real one is absorbed into it', () => {
    const r = planSourceRanges([{ from: 1, to: 2 }, { from: 2.05, to: 2.08 }], win)
    expect(r).toEqual({ ok: true, ranges: [{ from: 1, to: 2.08 }] })
  })

  it('refuses when any range lies wholly outside the window, naming it', () => {
    const r = planSourceRanges([{ from: 1, to: 2 }, { from: 11, to: 12 }], win)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/11.*12.*outside the clip's source \(0.*10s\)/)
    expect(planSourceRanges([{ from: -3, to: -1 }], win).ok).toBe(false)
  })

  it('refuses when nothing usable is left', () => {
    expect(planSourceRanges([], win).ok).toBe(false)
    expect(planSourceRanges([{ from: 3, to: 2 }, { from: NaN, to: 4 }], win).ok).toBe(false)
    const tiny = planSourceRanges([{ from: 3, to: 3.03 }], win)
    expect(!tiny.ok && tiny.reason).toMatch(/shorter than/)
  })
})

describe('source window and local frames', () => {
  const clip = { sourceStartFrame: 60, durationFrames: 150, speed: 2 } as Pick<Clip, 'sourceStartFrame' | 'durationFrames' | 'speed'>

  it('reads the window a clip really plays: its trim start for as long as it consumes media', () => {
    expect(clipSourceWindowSec(clip, 30)).toEqual({ from: 2, to: 12 })
    expect(clipSourceWindowSec({ sourceStartFrame: 0, durationFrames: 90 }, 30)).toEqual({ from: 0, to: 3 })
  })

  it('maps source seconds to clip-local frames through the trim start and speed', () => {
    // Source 4–6 s is frames 120–180; minus the 60-frame trim start, over speed 2: local 30–60.
    expect(sourceRangesToLocalFrames([{ from: 4, to: 6 }], clip, 30)).toEqual([[30, 60]])
  })

  it('clamps to the clip and drops what rounds to nothing', () => {
    // The clip plays source 2–12 s. 0–3 s overhangs its start (local 0–15); 11.9–14 s overhangs its end (local 149–150).
    expect(sourceRangesToLocalFrames([{ from: 0, to: 3 }, { from: 11.9, to: 14 }], clip, 30)).toEqual([[0, 15], [149, 150]])
    expect(sourceRangesToLocalFrames([{ from: 4, to: 4.01 }], clip, 30)).toEqual([])
  })
})

describe('planMemberCuts', () => {
  it('lists the surviving pieces with the ripple shift of each', () => {
    const p = planMemberCuts(100, 400, [[130, 145], [190, 205], [280, 310]])
    expect(p.ranges).toEqual([[130, 145], [190, 205], [280, 310]])
    expect(p.kept).toEqual([
      { origStart: 100, origEnd: 130, shift: 0 },
      { origStart: 145, origEnd: 190, shift: 15 },
      { origStart: 205, origEnd: 280, shift: 30 },
      { origStart: 310, origEnd: 400, shift: 60 },
    ])
    expect(p.removed).toBe(60)
  })

  it('clamps cuts to the clip, and a cut on an edge leaves no piece there', () => {
    const p = planMemberCuts(100, 200, [[50, 120], [190, 260]])
    expect(p.ranges).toEqual([[100, 120], [190, 200]])
    expect(p.kept).toEqual([{ origStart: 120, origEnd: 190, shift: 20 }])
  })

  it('a clip the cuts miss is one whole piece', () => {
    expect(planMemberCuts(0, 50, [[60, 70]])).toEqual({ ranges: [], kept: [{ origStart: 0, origEnd: 50, shift: 0 }], removed: 0 })
  })

  it('collapseFrame and segmentIndex agree with the pieces', () => {
    const cuts: Array<[number, number]> = [[30, 45], [90, 105]]
    expect([0, 30, 40, 45, 90, 100, 105, 200].map((f) => collapseFrame(f, cuts))).toEqual([0, 30, 30, 30, 75, 75, 75, 170])
    expect([0, 45, 105].map((f) => segmentIndex(f, cuts))).toEqual([0, 1, 2])
  })
})

describe('planCaptionRemoval', () => {
  const cap = (id: string, startFrame: number, words: Array<[string, number, number]>) => ({
    id,
    trackId: 't',
    startFrame,
    durationFrames: Math.max(...words.map((w) => w[2])),
    words: words.map(([text, start, end]) => ({ text, start, end })),
  })

  it('drops words whose centre is inside a cut and follows the picture left', () => {
    const plan = planCaptionRemoval([cap('a', 100, [['one', 0, 20], ['two', 20, 40], ['three', 40, 60]])], [[115, 135]], true, () => [])
    // "two" spans 120–140: centre 130 is inside the cut. "three" (140–160) moves left by 20.
    expect(plan.removals).toEqual([])
    expect(plan.patches).toEqual([
      {
        clipId: 'a',
        trackId: 't',
        startFrame: 100,
        durationFrames: 40,
        content: 'one three',
        words: [
          { text: 'one', start: 0, end: 15 }, // its tail ran into the cut and is clipped to where the cut began
          { text: 'three', start: 20, end: 40 },
        ],
      },
    ])
  })

  it('without ripple the surviving words stay where they were', () => {
    const plan = planCaptionRemoval([cap('a', 100, [['one', 0, 20], ['two', 20, 40], ['three', 40, 60]])], [[120, 140]], false, () => [])
    expect(plan.patches[0]).toMatchObject({ startFrame: 100, durationFrames: 60, content: 'one three' })
    expect(plan.patches[0]!.words.map((w) => [w.start, w.end])).toEqual([[0, 20], [40, 60]])
  })

  it('removes a caption with no word left, and leaves one that cannot move without a collision', () => {
    const wholly = planCaptionRemoval([cap('a', 100, [['um', 0, 20]])], [[95, 125]], true, () => [])
    expect(wholly).toEqual({ patches: [], removals: ['a'], skipped: [] })

    const neighbour = { id: 'n', trackId: 't', startFrame: 100, durationFrames: 40 } as Clip
    const blocked = planCaptionRemoval([cap('b', 90, [['x', 0, 30]])], [[0, 5]], true, () => [neighbour])
    // Collapsing 5 frames puts "x" at 85–115, on top of the clip at 100–140.
    expect(blocked.skipped).toEqual(['b'])
    expect(blocked.patches).toEqual([])
  })
})
