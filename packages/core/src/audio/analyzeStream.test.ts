import { describe, expect, it } from 'vitest'
import { PcmAnalyzer, analyzePcm } from './analysis'
import { analyzeAudioStream } from './analyzeStream'
import { fakeMediabunny } from '../media/audio/__tests__/fakeMediabunny'

/** LM-P5: chunked analysis equals the whole-PCM analysis. */

function lcg(seed: number): () => number {
  let x = seed
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0
    return (x / 2 ** 32) * 2 - 1
  }
}

/** The click track of analysis.test.ts: a decaying noise burst every beat. */
function clickTrack(bpm: number, seconds: number, sr: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(seconds * sr))
  const interval = 60 / bpm
  for (let k = 0; ; k++) {
    const t = 0.25 + k * interval
    if (t >= seconds) break
    const start = Math.round(t * sr)
    const rand = lcg(1)
    for (let i = 0; i < 256; i++) {
      if (start + i >= out.length) break
      out[start + i] += 0.8 * rand() * Math.exp(-i / 40)
    }
  }
  return out
}

describe('PcmAnalyzer (LM-P5)', () => {
  it('is bit-identical to analyzePcm for any chunking, including chunks that straddle hops and frames', () => {
    const sr = 22050
    const pcm = clickTrack(120, 20, sr)
    const whole = analyzePcm(pcm, sr, 30)
    for (const size of [1, 97, 4410, 22050 * 3 + 7]) {
      const a = new PcmAnalyzer(sr, 30)
      for (let i = 0; i < pcm.length; i += size) a.push(pcm.subarray(i, Math.min(pcm.length, i + size)))
      expect(a.finish()).toEqual(whole)
    }
    expect(whole.bpm).toBeGreaterThanOrEqual(119)
    expect(whole.beats.length).toBeGreaterThan(20)
  })

  it('an empty analyzer finishes like empty PCM', () => {
    expect(new PcmAnalyzer(22050, 30).finish()).toEqual(analyzePcm(new Float32Array(0), 22050, 30))
  })
})

describe('analyzeAudioStream (LM-P5)', () => {
  it('matches analyzePcm on the same audio when read in small windows', async () => {
    const sr = 22050
    const pcm = clickTrack(120, 20, sr)
    const { mb, log } = fakeMediabunny({ sampleRate: sr, channels: [pcm], frameSize: 1024 })
    const streamed = await analyzeAudioStream(new Blob(['x']), 30, { mb, chunkSec: 3 })
    expect(streamed).toEqual(analyzePcm(pcm, sr, 30))
    expect(log.ranges.length).toBe(7)
    expect(log.disposed).toBe(1)
  })

  it('downmixes stereo and resamples a 44.1 kHz source to the analysis rate, finding the same tempo', async () => {
    const pcm44 = clickTrack(120, 20, 44100)
    const { mb } = fakeMediabunny({ sampleRate: 44100, channels: [pcm44, pcm44.map((v) => v * 0.9)], frameSize: 2048 })
    const streamed = await analyzeAudioStream(new Blob(['x']), 30, { mb, chunkSec: 4 })
    const reference = analyzePcm(clickTrack(120, 20, 22050), 22050, 30)
    expect(Math.abs((streamed.bpm ?? 0) - (reference.bpm ?? 0))).toBeLessThanOrEqual(1)
    // Same beats to within one frame each.
    expect(Math.abs(streamed.beats.length - reference.beats.length)).toBeLessThanOrEqual(1)
    const n = Math.min(streamed.beats.length, reference.beats.length)
    for (let i = 0; i < n; i++) expect(Math.abs(streamed.beats[i]! - reference.beats[i]!)).toBeLessThanOrEqual(1)
  })

  it('reports progress and honours an abort', async () => {
    const sr = 22050
    const { mb } = fakeMediabunny({ sampleRate: sr, channels: [clickTrack(120, 12, sr)] })
    const progress: number[] = []
    await analyzeAudioStream(new Blob(['x']), 30, { mb, chunkSec: 4, onProgress: (f) => progress.push(f) })
    expect(progress).toHaveLength(3)
    expect(progress[2]).toBeCloseTo(1)

    const ctl = new AbortController()
    ctl.abort()
    await expect(analyzeAudioStream(new Blob(['x']), 30, { mb, signal: ctl.signal })).rejects.toThrow('Aborted')
  })
})
