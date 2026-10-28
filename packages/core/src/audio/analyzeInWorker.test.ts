import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzePcm } from './analysis'
import { analyzePcmInWorker } from './analyzeInWorker'

/**
 * PV-P10b-2: `analyzePcmInWorker`'s fallback path. Node has no `Worker`, so
 * every one of these exercises `viaWorker: false` — the real worker path is
 * proven in the browser (Result / dev harness), not here.
 *
 * The click-track helper is copied from PV-P10b-1's `audio/analysis.test.ts`
 * so this file's fixtures are reproducible from the helper definitions alone.
 */

function zeros(seconds: number, sr = 22050): Float32Array {
  return new Float32Array(Math.round(seconds * sr))
}

function lcg(seed: number): () => number {
  let x = seed
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0
    return (x / 2 ** 32) * 2 - 1
  }
}

function clickTrack(bpm: number, seconds: number, sr = 22050): Float32Array {
  const out = zeros(seconds, sr)
  const intervalSec = 60 / bpm
  for (let k = 0; ; k++) {
    const t = 0.25 + k * intervalSec
    if (t >= seconds) break
    const start = Math.round(t * sr)
    const rand = lcg(1)
    for (let i = 0; i < 256; i++) {
      const idx = start + i
      if (idx >= out.length) break
      out[idx] += 0.8 * rand() * Math.exp(-i / 40)
    }
  }
  return out
}

describe('analyzePcmInWorker — fallback (Node has no Worker)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves with viaWorker: false and an analysis deep-equal to analyzePcm on a copy of the same input', async () => {
    const signal = clickTrack(120, 16)
    const copy = signal.slice()
    const result = await analyzePcmInWorker(signal, 22050, 30)
    expect(result.viaWorker).toBe(false)
    expect(result.analysis).toEqual(analyzePcm(copy, 22050, 30))
  })

  it('still resolves with viaWorker: false when the Worker constructor throws', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('no workers')
        }
      },
    )
    const signal = clickTrack(120, 16)
    const copy = signal.slice()
    const result = await analyzePcmInWorker(signal, 22050, 30)
    expect(result.viaWorker).toBe(false)
    expect(result.analysis).toEqual(analyzePcm(copy, 22050, 30))
  })

  it('an already-aborted signal rejects with AbortError, even without a Worker', async () => {
    const controller = new AbortController()
    controller.abort()
    const signal = clickTrack(120, 4)
    await expect(analyzePcmInWorker(signal, 22050, 30, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
