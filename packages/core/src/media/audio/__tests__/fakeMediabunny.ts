import type {
  AudioInputLike,
  AudioSampleLike,
  MediabunnyAudioLike,
} from '../streamDecode'

export interface FakeAudioFile {
  sampleRate: number
  /** One array per channel, all the same length. */
  channels: Float32Array[]
  /** Frames per decoded sample (like an AAC packet). Default 1024. */
  frameSize?: number
  /** Container with no audio track. */
  noAudio?: boolean
}

export interface FakeMbLog {
  /** Every `samples(start, end)` request, in order. */
  ranges: Array<[number | undefined, number | undefined]>
  opened: number
  disposed: number
  /** Samples yielded and not yet closed. */
  openSamples: number
  maxOpenSamples: number
}

/** A mediabunny stand-in that decodes `file` and records how it was read. */
export function fakeMediabunny(file: FakeAudioFile): { mb: MediabunnyAudioLike; log: FakeMbLog } {
  const log: FakeMbLog = { ranges: [], opened: 0, disposed: 0, openSamples: 0, maxOpenSamples: 0 }
  const frameSize = file.frameSize ?? 1024
  const total = file.channels[0]?.length ?? 0
  const sr = file.sampleRate

  const track = {
    getSampleRate: async () => sr,
    getNumberOfChannels: async () => file.channels.length,
    computeDuration: async () => total / sr,
  }

  class Input implements AudioInputLike {
    constructor() {
      log.opened++
    }
    async getPrimaryAudioTrack() {
      return file.noAudio ? null : track
    }
    dispose() {
      log.disposed++
    }
  }

  class Sink {
    async *samples(start?: number, end?: number): AsyncGenerator<AudioSampleLike> {
      log.ranges.push([start, end])
      const startFrame = Math.floor((start ?? 0) * sr)
      const endFrame = end === undefined ? total : Math.min(total, Math.ceil(end * sr))
      // Like the real sink: begin at the packet containing `start`.
      for (let f = Math.floor(startFrame / frameSize) * frameSize; f < endFrame; f += frameSize) {
        const n = Math.min(frameSize, total - f)
        log.openSamples++
        log.maxOpenSamples = Math.max(log.maxOpenSamples, log.openSamples)
        let closed = false
        yield {
          timestamp: f / sr,
          numberOfFrames: n,
          numberOfChannels: file.channels.length,
          sampleRate: sr,
          copyTo(dest, o) {
            dest.set(file.channels[o.planeIndex]!.subarray(f, f + n))
          },
          close() {
            if (!closed) {
              closed = true
              log.openSamples--
            }
          },
        }
      }
    }
  }

  const mb: MediabunnyAudioLike = {
    ALL_FORMATS: [],
    Input: Input as unknown as MediabunnyAudioLike['Input'],
    BlobSource: class {} as unknown as MediabunnyAudioLike['BlobSource'],
    AudioSampleSink: Sink as unknown as MediabunnyAudioLike['AudioSampleSink'],
  }
  return { mb, log }
}

/** A sample ramp: channel c, frame i holds (i + 1) / (n + 1) * (c + 1) / channels, all within (-1, 1). */
export function rampChannels(frames: number, channels = 1): Array<Float32Array<ArrayBuffer>> {
  return Array.from({ length: channels }, (_, c) => {
    const a = new Float32Array(frames)
    for (let i = 0; i < frames; i++) a[i] = (((i + 1) / (frames + 1)) * (c + 1)) / channels
    return a
  })
}
