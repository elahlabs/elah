import { describe, expect, it } from 'vitest'
import {
  NoAudioTrackError,
  openAudioStream,
  resampleLinear,
  streamPeaks,
} from '../streamDecode'
import { AudioChunkCache } from '../audioChunkCache'
import { fakeMediabunny, rampChannels } from './fakeMediabunny'

const blob = new Blob(['x'])

describe('openAudioStream.readRange (LM-P5)', () => {
  it('returns exactly the requested window of samples', async () => {
    const sr = 8000
    const ch = rampChannels(sr * 10)
    const { mb } = fakeMediabunny({ sampleRate: sr, channels: ch, frameSize: 1000 })
    const stream = await openAudioStream(blob, { mb })
    expect(stream.durationSec).toBeCloseTo(10)
    expect(stream.sampleRate).toBe(sr)

    // Deliberately not aligned to the 1000-frame packets.
    const { channels, sampleRate } = await stream.readRange(2.0625, 3.3125)
    expect(sampleRate).toBe(sr)
    const i0 = Math.round(2.0625 * sr)
    const i1 = Math.round(3.3125 * sr)
    expect(channels).toHaveLength(1)
    expect(channels[0]!.length).toBe(i1 - i0)
    expect(Array.from(channels[0]!)).toEqual(Array.from(ch[0]!.subarray(i0, i1)))
  })

  it('adjacent ranges tile with no gap and no overlap', async () => {
    const sr = 8000
    const ch = rampChannels(sr * 9)
    const { mb } = fakeMediabunny({ sampleRate: sr, channels: ch, frameSize: 700 })
    const stream = await openAudioStream(blob, { mb })
    const parts = []
    for (const [a, b] of [[0, 3], [3, 6], [6, 9]] as const) parts.push((await stream.readRange(a, b)).channels[0]!)
    const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      joined.set(p, at)
      at += p.length
    }
    expect(Array.from(joined)).toEqual(Array.from(ch[0]!))
  })

  it('pads past the end of the file with silence', async () => {
    const sr = 8000
    const { mb } = fakeMediabunny({ sampleRate: sr, channels: rampChannels(sr * 2) })
    const stream = await openAudioStream(blob, { mb })
    const { channels } = await stream.readRange(1.5, 3)
    expect(channels[0]!.length).toBe(Math.round(1.5 * sr))
    expect(channels[0]![sr / 2 - 1]).not.toBe(0)
    expect(channels[0]![sr / 2 + 5]).toBe(0)
  })

  it('downmixes to mono, limits channels, and resamples on request', async () => {
    const sr = 8000
    const ch = rampChannels(sr * 2, 2)
    const { mb } = fakeMediabunny({ sampleRate: sr, channels: ch })
    const stream = await openAudioStream(blob, { mb })

    const mono = (await stream.readRange(0, 1, { mono: true })).channels
    expect(mono).toHaveLength(1)
    expect(mono[0]![100]).toBeCloseTo((ch[0]![100]! + ch[1]![100]!) / 2, 6)

    expect((await stream.readRange(0, 1, { maxChannels: 1 })).channels).toHaveLength(1)
    expect((await stream.readRange(0, 1)).channels).toHaveLength(2)

    const half = await stream.readRange(0, 1, { targetSampleRate: 4000 })
    expect(half.sampleRate).toBe(4000)
    expect(half.channels[0]!.length).toBe(4000)
    expect(half.channels[0]![1000]).toBeCloseTo(ch[0]![2000]!, 4)
  })

  it('closes every sample it opens (bounded decoder memory) and disposes the input on close', async () => {
    const sr = 8000
    const { mb, log } = fakeMediabunny({ sampleRate: sr, channels: rampChannels(sr * 4), frameSize: 500 })
    const stream = await openAudioStream(blob, { mb })
    await stream.readRange(0, 4)
    expect(log.openSamples).toBe(0)
    expect(log.maxOpenSamples).toBe(1)
    stream.close()
    stream.close()
    expect(log.disposed).toBe(1)
    await expect(stream.readRange(0, 1)).rejects.toThrow('closed')
  })

  it('throws NoAudioTrackError and disposes the input when the file has no audio', async () => {
    const { mb, log } = fakeMediabunny({ sampleRate: 8000, channels: [new Float32Array(0)], noAudio: true })
    await expect(openAudioStream(blob, { mb })).rejects.toBeInstanceOf(NoAudioTrackError)
    expect(log.disposed).toBe(1)
  })
})

describe('resampleLinear', () => {
  it('is the identity at the same rate and interpolates otherwise', () => {
    const a = Float32Array.from([0, 1, 2, 3])
    expect(resampleLinear(a, 100, 100)).toBe(a)
    const up = resampleLinear(a, 100, 200)
    expect(up.length).toBe(8)
    expect(up[1]).toBeCloseTo(0.5)
    expect(up[2]).toBeCloseTo(1)
  })
})

describe('streamPeaks (LM-P5)', () => {
  /** The whole-buffer rule of computeWaveform, restated: channel 0, floor(N / P) per bucket, / global max. */
  function wholeBufferPeaks(channel: Float32Array, count: number): Float32Array {
    const peaks = new Float32Array(count)
    const bucket = Math.max(1, Math.floor(channel.length / count))
    let globalMax = 0
    for (let i = 0; i < count; i++) {
      let max = 0
      const end = Math.min(i * bucket + bucket, channel.length)
      for (let j = i * bucket; j < end; j++) max = Math.max(max, Math.abs(channel[j]!))
      peaks[i] = max
      globalMax = Math.max(globalMax, max)
    }
    if (globalMax > 0) for (let i = 0; i < count; i++) peaks[i]! /= globalMax
    return peaks
  }

  function signal(frames: number, sr: number): Float32Array<ArrayBuffer> {
    // A deterministic mix of tones with a loud negative transient and a smaller positive one.
    const a = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      a[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) - 0.1 * Math.sin((2 * Math.PI * 1500 * i) / sr)
    }
    a[Math.floor(frames * 0.37)] = -0.95
    a[Math.floor(frames * 0.81)] = 0.6
    return a
  }

  it('equals the whole-buffer peaks, bucket for bucket, for any chunking', async () => {
    const sr = 8000
    const frames = 256 * 400 // divisible by 256
    const sig = signal(frames, sr)
    const expected = wholeBufferPeaks(sig, 256)
    for (const chunkSec of [0.37, 1, 5, 100]) {
      const { mb } = fakeMediabunny({ sampleRate: sr, channels: [sig, sig.map((v) => v * 0.5)], frameSize: 960 })
      const got = await streamPeaks(blob, 256, { mb, chunkSec })
      expect(got).not.toBeNull()
      expect(Array.from(got!)).toEqual(Array.from(expected))
    }
  })

  it('keeps the per-bucket MAX, not a mean or the last value', async () => {
    const sr = 8000
    const frames = 256 * 40
    const sig = new Float32Array(frames).fill(0.1)
    // Two spikes in bucket 7, the larger first: max must win.
    sig[7 * 40 + 3] = -0.9
    sig[7 * 40 + 30] = 0.4
    const { mb } = fakeMediabunny({ sampleRate: sr, channels: [sig] })
    const peaks = (await streamPeaks(blob, 256, { mb, chunkSec: 0.2 }))!
    expect(peaks[7]).toBeCloseTo(1)
    expect(peaks[6]).toBeCloseTo(0.1 / 0.9)
  })

  it('reads sequential windows no larger than the chunk and closes its stream', async () => {
    const sr = 8000
    const { mb, log } = fakeMediabunny({ sampleRate: sr, channels: [signal(sr * 20, sr)] })
    await streamPeaks(blob, 256, { mb, chunkSec: 5 })
    expect(log.ranges).toHaveLength(4)
    for (const [a, b] of log.ranges) expect(b! - a!).toBeLessThanOrEqual(5.0001)
    expect(log.disposed).toBe(1)
  })

  it('is null for an empty track', async () => {
    const { mb } = fakeMediabunny({ sampleRate: 8000, channels: [new Float32Array(0)] })
    await expect(streamPeaks(blob, 256, { mb })).resolves.toBeNull()
  })
})

describe('AudioChunkCache (LM-P5)', () => {
  it('never holds more than maxChunks and evicts the least recently used', async () => {
    const cache = new AudioChunkCache<number>(3)
    const loads: number[] = []
    const load = (k: number) => () => {
      loads.push(k)
      return Promise.resolve(k * 10)
    }
    for (let k = 0; k < 10; k++) {
      await cache.get(k, load(k))
      expect(cache.size).toBeLessThanOrEqual(3)
    }
    expect(cache.keys()).toEqual([7, 8, 9])

    // Touch 7 so 8 becomes the oldest, then add one.
    await cache.get(7, load(7))
    await cache.get(10, load(10))
    expect(cache.keys()).toEqual([9, 7, 10])
    expect(loads.filter((k) => k === 7)).toHaveLength(1) // 7 was a hit
  })

  it('forgets a failed load so it can be retried', async () => {
    const cache = new AudioChunkCache<number>(2)
    await expect(cache.get(1, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await Promise.resolve()
    expect(cache.size).toBe(0)
    await expect(cache.get(1, () => Promise.resolve(5))).resolves.toBe(5)
  })
})
