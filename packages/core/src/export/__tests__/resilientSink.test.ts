import { describe, expect, it } from 'vitest'
import type { CanvasSinkLike } from '../clipFrames'
import { resilientCanvasSink } from '../resilientSink'

function decodeError(): Error {
  const e = new Error('Decoding error.')
  e.name = 'EncodingError'
  return e
}

/** A sink yielding the timestamp itself, throwing `err` after `failAfter` frames (if set). */
function makeFake(failAfter: number | null, err: unknown = decodeError()) {
  const calls: number[][] = []
  const closed: boolean[] = []
  const sink: CanvasSinkLike<number> = {
    async *canvasesAtTimestamps(ts: number[]) {
      calls.push(ts)
      const idx = closed.push(false) - 1
      try {
        for (let i = 0; i < ts.length; i++) {
          if (failAfter !== null && i === failAfter) throw err
          yield ts[i]!
        }
      } finally {
        closed[idx] = true
      }
    },
  }
  return { sink, calls, closed }
}

async function collect(gen: AsyncGenerator<number | null, void, unknown>) {
  const out: (number | null)[] = []
  for await (const v of gen) out.push(v)
  return out
}

const TS = [0, 1, 2, 3, 4, 5, 6, 7]

describe('resilientCanvasSink', () => {
  it('resumes on a new sink with exactly the remaining timestamps', async () => {
    const a = makeFake(3)
    const b = makeFake(null)
    const attempts: number[] = []
    const rebuilds: { attempt: number; resumeIndex: number }[] = []
    const sink = resilientCanvasSink<number>(
      (n) => {
        attempts.push(n)
        return n === 0 ? a.sink : b.sink
      },
      { onRebuild: (i) => rebuilds.push({ attempt: i.attempt, resumeIndex: i.resumeIndex }) },
    )
    const out = await collect(sink.canvasesAtTimestamps(TS))
    expect(out).toEqual(TS)
    expect(a.calls).toEqual([TS])
    expect(b.calls).toEqual([[3, 4, 5, 6, 7]])
    expect(attempts).toEqual([0, 1])
    expect(rebuilds).toEqual([{ attempt: 1, resumeIndex: 3 }])
  })

  it('passes attempts 1 then 2, then throws the ORIGINAL error when the budget is spent', async () => {
    const errs: Error[] = []
    const attempts: number[] = []
    const sink = resilientCanvasSink<number>((n) => {
      attempts.push(n)
      const e = decodeError()
      errs.push(e)
      return makeFake(1, e).sink
    })
    let thrown: unknown
    const got: number[] = []
    try {
      for await (const v of sink.canvasesAtTimestamps(TS)) got.push(v as number)
    } catch (e) {
      thrown = e
    }
    expect(attempts).toEqual([0, 1, 2])
    // Rethrown as-is (not wrapped): the very error object the last sink threw.
    expect(thrown).toBe(errs[2])
    expect(got).toEqual([0, 1, 2])
  })

  it('rethrows the original error object when no rebuild is allowed', async () => {
    const first = decodeError()
    const sink = resilientCanvasSink<number>(() => makeFake(2, first).sink, { maxRebuilds: 0 })
    await expect(collect(sink.canvasesAtTimestamps(TS))).rejects.toBe(first)
  })

  it('does not rebuild on an AbortError or a non-decode error', async () => {
    for (const err of [Object.assign(new Error('aborted'), { name: 'AbortError' }), new Error('disk on fire')]) {
      const attempts: number[] = []
      const sink = resilientCanvasSink<number>((n) => {
        attempts.push(n)
        return makeFake(2, err).sink
      })
      await expect(collect(sink.canvasesAtTimestamps(TS))).rejects.toBe(err)
      expect(attempts).toEqual([0])
    }
  })

  it('shares the rebuild budget across separate canvasesAtTimestamps calls', async () => {
    const attempts: number[] = []
    const sink = resilientCanvasSink<number>(
      (n) => {
        attempts.push(n)
        return makeFake(1).sink // every sink dies after one frame
      },
      { maxRebuilds: 2 },
    )
    // call 1 burns both rebuilds
    await expect(collect(sink.canvasesAtTimestamps(TS))).rejects.toBeDefined()
    expect(attempts).toEqual([0, 1, 2])
    // call 2 has none left: fails on the first error, builds nothing new
    await expect(collect(sink.canvasesAtTimestamps(TS))).rejects.toBeDefined()
    expect(attempts).toEqual([0, 1, 2])
  })

  it('closes the inner generator when the consumer stops early', async () => {
    const a = makeFake(null)
    const sink = resilientCanvasSink<number>(() => a.sink)
    const gen = sink.canvasesAtTimestamps(TS)
    expect((await gen.next()).value).toBe(0)
    expect((await gen.next()).value).toBe(1)
    await gen.return(undefined)
    expect(a.closed).toEqual([true])
  })
})
