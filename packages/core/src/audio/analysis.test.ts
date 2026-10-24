import { describe, expect, it } from 'vitest'
import { analyzePcm } from './analysis'

/**
 * PV-P10b-1: analyzePcm on synthetic PCM. Every fixture is built from these
 * helpers so the expected numbers in this file are reproducible from the
 * helper definitions alone — no imported test audio.
 */

function tone(hz: number, seconds: number, amp: number, sr = 22050): Float32Array {
  const n = Math.round(seconds * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr)
  return out
}

function zeros(seconds: number, sr = 22050): Float32Array {
  return new Float32Array(Math.round(seconds * sr))
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Deterministic PRNG in [-1, 1). */
function lcg(seed: number): () => number {
  let x = seed
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0
    return (x / 2 ** 32) * 2 - 1
  }
}

/**
 * A click track: a decaying noise burst (256 samples, tau 40) at
 * `t = 0.25 + k * 60 / bpm` for every `t < seconds`. Every click uses a fresh
 * `lcg(1)`, so every click is the identical burst — the point is a strong,
 * repeatable broadband transient at a known time, not real percussion.
 */
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

function clickTimes(bpm: number, seconds: number): number[] {
  const intervalSec = 60 / bpm
  const times: number[] = []
  for (let k = 0; ; k++) {
    const t = 0.25 + k * intervalSec
    if (t >= seconds) break
    times.push(t)
  }
  return times
}

describe('analyzePcm — validation and the empty case', () => {
  it('an empty signal is an all-empty result', () => {
    const a = analyzePcm(new Float32Array(0), 22050, 30)
    expect(a.durationFrames).toBe(0)
    expect(a.beats).toEqual([])
    expect(a.onsets).toEqual([])
    expect(a.silences).toEqual([])
    expect(a.bpm).toBeUndefined()
    expect(a.tempoConfidence).toBe(0)
    expect(a.loudness).toHaveLength(0)
    expect(a.bands.low).toHaveLength(0)
  })

  it('throws RangeError for a sample rate below 8000', () => {
    expect(() => analyzePcm(new Float32Array(10), 4000, 30)).toThrow(RangeError)
  })

  it('throws RangeError for fps 0', () => {
    expect(() => analyzePcm(new Float32Array(10), 22050, 0)).toThrow(RangeError)
  })
})

describe('analyzePcm — envelopes, loudness, silences (fps 30)', () => {
  it('tone-silence-tone: durationFrames, silence range and loudness at representative frames', () => {
    const signal = concat(tone(440, 1, 0.5), zeros(1), tone(440, 1, 0.5))
    const a = analyzePcm(signal, 22050, 30)
    expect(a.durationFrames).toBe(90)
    expect(a.silences).toEqual([[30, 60]])
    expect(a.loudness[10]).toBeCloseTo(0.849, 2)
    expect(a.loudness[45]).toBe(0)
  })

  it('all zeros for 2s: one silence spanning the whole clip, loudness all zero', () => {
    const signal = zeros(2)
    const a = analyzePcm(signal, 22050, 30)
    expect(a.silences).toEqual([[0, 60]])
    expect(Array.from(a.loudness).every((v) => v === 0)).toBe(true)
  })

  it('band energy tracks the tone frequency', () => {
    const low = analyzePcm(tone(100, 1, 0.5), 22050, 30)
    for (let f = 5; f <= 25; f++) {
      expect(low.bands.low[f]).toBeGreaterThan(low.bands.mid[f] + 0.1)
      expect(low.bands.low[f]).toBeGreaterThan(low.bands.high[f] + 0.1)
    }
    const high = analyzePcm(tone(6000, 1, 0.5), 22050, 30)
    for (let f = 5; f <= 25; f++) {
      expect(high.bands.high[f]).toBeGreaterThan(high.bands.low[f] + 0.1)
    }
  })

  it('a 0.2s gap inside a tone (shorter than the 0.3s minimum) is not reported as silence', () => {
    const signal = concat(tone(440, 1, 0.5), zeros(0.2), tone(440, 1, 0.5))
    const a = analyzePcm(signal, 22050, 30)
    expect(a.silences).toEqual([])
  })
})

describe('analyzePcm — onsets, tempo and beats (fps 30)', () => {
  it('120 BPM click track for 16s is detected within tolerance', () => {
    const bpm = 120
    const seconds = 16
    const signal = clickTrack(bpm, seconds)
    const a = analyzePcm(signal, 22050, 30)

    expect(a.bpm).toBeGreaterThanOrEqual(119)
    expect(a.bpm).toBeLessThanOrEqual(121)
    expect(a.tempoConfidence).toBeGreaterThanOrEqual(0.1)

    const times = clickTimes(bpm, seconds)
    expect(times).toHaveLength(32)

    let matched = 0
    for (const t of times) {
      const target = Math.round(t * 30)
      if (a.beats.some((f) => Math.abs(f - target) <= 1)) matched++
    }
    expect(matched).toBeGreaterThanOrEqual(28)

    for (let i = 1; i < a.beats.length; i++) {
      expect(a.beats[i] - a.beats[i - 1]).toBeGreaterThanOrEqual(10)
    }

    for (const t of times) {
      const target = Math.round(t * 30)
      expect(a.onsets.some((f) => Math.abs(f - target) <= 1)).toBe(true)
    }
  })

  it('90 BPM click track for 20s is detected within tolerance', () => {
    const a = analyzePcm(clickTrack(90, 20), 22050, 30)
    expect(a.bpm).toBeGreaterThanOrEqual(89)
    expect(a.bpm).toBeLessThanOrEqual(91)
  })

  it('silence has no tempo', () => {
    const a = analyzePcm(zeros(5), 22050, 30)
    expect(a.bpm).toBeUndefined()
    expect(a.beats).toEqual([])
    expect(a.onsets).toEqual([])
    expect(a.tempoConfidence).toBe(0)
  })

  it('is deterministic: two runs on the same input are deep-equal', () => {
    const signal = clickTrack(120, 16)
    const a1 = analyzePcm(signal, 22050, 30)
    const a2 = analyzePcm(signal, 22050, 30)
    expect(a1).toEqual(a2)
  })

  it('cost: 128 BPM for 180s analyses fast enough in Node', () => {
    const signal = clickTrack(128, 180)
    const started = performance.now()
    analyzePcm(signal, 22050, 30)
    const elapsed = performance.now() - started
    // eslint-disable-next-line no-console
    console.log(`analyzePcm(128bpm, 180s) took ${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(2000)
  })
})
