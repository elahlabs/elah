import { describe, expect, it } from 'vitest'
import { computeStreamedWaveform, shouldStreamAudio } from './importFiles'
import { STREAM_AUDIO_ABOVE_BYTES } from '../media/audio/streamDecode'
import { fakeMediabunny } from '../media/audio/__tests__/fakeMediabunny'

describe('streamed waveform (LM-P5)', () => {
  it('streams only above the threshold, and the old 2 GiB skip is gone', () => {
    expect(shouldStreamAudio({ byteSize: STREAM_AUDIO_ABOVE_BYTES })).toBe(false)
    expect(shouldStreamAudio({ byteSize: STREAM_AUDIO_ABOVE_BYTES + 1 })).toBe(true)
    expect(shouldStreamAudio({ byteSize: 10 * 1024 ** 3 })).toBe(true)
  })

  it('computes 256 normalised peaks from a pinned Blob without any whole-file read', async () => {
    const sr = 8000
    const sig = new Float32Array(256 * 100).fill(0.05)
    sig[50 * 100 + 3] = 0.5
    const { mb, log } = fakeMediabunny({ sampleRate: sr, channels: [sig] })
    const peaks = await computeStreamedWaveform('blob:big', { mb, chunkSec: 0.5, blobFor: () => new Blob(['x']) })
    expect(peaks).not.toBeNull()
    expect(peaks!.length).toBe(256)
    expect(peaks![50]).toBeCloseTo(1)
    expect(Math.min(...peaks!)).toBeCloseTo(0.1)
    expect(log.ranges.length).toBeGreaterThan(1)
  })

  it('is null for a file with no audio track', async () => {
    const { mb } = fakeMediabunny({ sampleRate: 8000, channels: [new Float32Array(0)], noAudio: true })
    await expect(computeStreamedWaveform('blob:silent', { mb, blobFor: () => new Blob(['x']) })).resolves.toBeNull()
  })
})
