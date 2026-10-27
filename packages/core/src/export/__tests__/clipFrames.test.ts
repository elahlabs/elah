import { describe, expect, it } from 'vitest'
import {
  clipFrameSource,
  constantSpeedTimestamps,
  frameTimestamp,
  isNonDecreasing,
  type CanvasSinkLike,
} from '../clipFrames'

/** A fake sink whose "canvas" is the requested source frame, recording every generator it opens. */
function fakeSink(fps: number) {
  const calls: number[][] = []
  const sink: CanvasSinkLike<number> = {
    async *canvasesAtTimestamps(ts: number[]) {
      calls.push(ts)
      let last = -Infinity
      for (const t of ts) {
        // The real sink requires increasing timestamps within one generator.
        if (t < last) throw new Error('timestamps went backwards inside one generator')
        last = t
        yield Math.round(t * fps - 0.5)
      }
    },
  }
  return { sink, calls }
}

async function drain(src: { next(): Promise<number | null> }, n: number) {
  const out: (number | null)[] = []
  for (let i = 0; i < n; i++) out.push(await src.next())
  return out
}

describe('clipFrameSource', () => {
  const fps = 30

  it('constant speed keeps the historical timestamps exactly', async () => {
    const { sink, calls } = fakeSink(fps)
    const src = clipFrameSource(sink, { sourceStartFrame: 10, speed: 2, durationFrames: 4 }, null, fps)
    expect(await drain(src, 4)).toEqual([10, 12, 14, 16])
    expect(calls).toEqual([constantSpeedTimestamps(10, 2, 4, fps)])
    expect(calls[0]![0]).toBe((10 + 0.5) / 30)
  })

  it('a freeze decodes each distinct frame once', async () => {
    const { sink, calls } = fakeSink(fps)
    const frames = [5, 6, 7, 7, 7, 7, 8, 9]
    const src = clipFrameSource(sink, { sourceStartFrame: 5, durationFrames: frames.length }, frames, fps)
    expect(await drain(src, frames.length)).toEqual(frames)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.map((t) => Math.round(t * fps - 0.5))).toEqual([5, 6, 7, 8, 9])
  })

  it('reverse decodes ascending inside windows and serves in timeline order', async () => {
    const { sink, calls } = fakeSink(fps)
    const frames = Array.from({ length: 30 }, (_, i) => 100 - i)
    const src = clipFrameSource(sink, { sourceStartFrame: 71, durationFrames: 30 }, frames, fps)
    expect(await drain(src, 30)).toEqual(frames)
    // 30 frames in windows of 12 → 3 generators, each ascending.
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(isNonDecreasing(c)).toBe(true)
  })

  it('boomerang (up then down) works through the windowed path', async () => {
    const { sink } = fakeSink(fps)
    const frames = [0, 2, 4, 6, 8, 6, 4, 2, 0]
    const src = clipFrameSource(sink, { sourceStartFrame: 0, durationFrames: frames.length }, frames, fps)
    expect(await drain(src, frames.length)).toEqual(frames)
  })

  it('returns null past the end', async () => {
    const { sink } = fakeSink(fps)
    const src = clipFrameSource(sink, { sourceStartFrame: 0, durationFrames: 2 }, [3, 3], fps)
    expect(await drain(src, 3)).toEqual([3, 3, null])
  })

  it('timestamps are frame midpoints', () => {
    expect(frameTimestamp(0, 30)).toBeCloseTo(1 / 60)
  })
})
