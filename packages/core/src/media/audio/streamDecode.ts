/**
 * streamDecode — range-read decoded audio from a Blob without ever holding the
 * whole file (LM-P5).
 *
 * `decodeAudioData` needs the entire container in memory and returns the entire
 * track as PCM; a 10 GB podcast recording cannot afford either. mediabunny
 * reads the container through `BlobSource` (range reads on the backing File)
 * and decodes packets on demand through WebCodecs, so `readRange(a, b)` costs
 * memory proportional to `b - a`, not to the file.
 *
 * Everything here is DOM-free apart from mediabunny itself, which is imported
 * dynamically (as `assets/hasAudio.ts` does) and injectable as `opts.mb`, so
 * tests drive it with a fake and Node never needs WebCodecs.
 */

/** Sources above this many bytes take the streaming audio paths; below, the whole-file decode is kept. */
export const STREAM_AUDIO_ABOVE_BYTES = 64 * 1024 ** 2

/** The slice of mediabunny's audio sample this module reads. */
export interface AudioSampleLike {
  timestamp: number
  numberOfFrames: number
  numberOfChannels: number
  sampleRate: number
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): unknown
  close(): void
}

export interface AudioTrackLike {
  getSampleRate(): Promise<number>
  getNumberOfChannels(): Promise<number>
  computeDuration(): Promise<number>
}

export interface AudioSinkLike {
  samples(startTimestamp?: number, endTimestamp?: number): AsyncIterable<AudioSampleLike>
}

export interface AudioInputLike {
  getPrimaryAudioTrack(): Promise<AudioTrackLike | null>
  dispose(): void
}

/** The parts of the `mediabunny` module this file uses. */
export interface MediabunnyAudioLike {
  ALL_FORMATS: unknown
  Input: new (options: { formats: unknown; source: unknown }) => AudioInputLike
  BlobSource: new (blob: Blob) => unknown
  UrlSource?: new (url: string) => unknown
  AudioSampleSink: new (track: AudioTrackLike) => AudioSinkLike
}

export interface OpenAudioStreamOptions {
  /** Injectable mediabunny (tests). Defaults to a dynamic `import('mediabunny')`. */
  mb?: MediabunnyAudioLike
}

export interface ReadRangeOptions {
  /** Resample to this rate (linear interpolation). Default: the track's own rate. */
  targetSampleRate?: number
  /** Average every channel into one. */
  mono?: boolean
  /** Return at most this many leading channels (ignored when `mono`). */
  maxChannels?: number
}

export interface AudioRange {
  channels: Array<Float32Array<ArrayBuffer>>
  sampleRate: number
}

export interface AudioStream {
  /** Seconds, end of the last packet. */
  durationSec: number
  /** The track's native rate. */
  sampleRate: number
  numberOfChannels: number
  /**
   * Decoded PCM for `[startSec, endSec)`. Exactly `round(endSec*sr) - round(startSec*sr)`
   * frames at the native rate, so adjacent ranges tile with no gap or overlap.
   * Frames the file does not cover (before its start, past its end) are silence.
   */
  readRange(startSec: number, endSec: number, opts?: ReadRangeOptions): Promise<AudioRange>
  close(): void
}

export class NoAudioTrackError extends Error {
  constructor() {
    super('This file has no audio track')
    this.name = 'NoAudioTrackError'
  }
}

async function loadMediabunny(): Promise<MediabunnyAudioLike> {
  return (await import('mediabunny')) as unknown as MediabunnyAudioLike
}

/** Linear-interpolation resample of one channel. */
export function resampleLinear(
  input: Float32Array<ArrayBuffer>,
  fromRate: number,
  toRate: number,
): Float32Array<ArrayBuffer> {
  if (fromRate === toRate || input.length === 0) return input
  const outLength = Math.round((input.length * toRate) / fromRate)
  const out = new Float32Array(outLength)
  const ratio = fromRate / toRate
  const last = input.length - 1
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.min(last, Math.floor(pos))
    const i1 = Math.min(last, i0 + 1)
    const t = pos - i0
    out[i] = input[i0]! * (1 - t) + input[i1]! * t
  }
  return out
}

/**
 * Open the primary audio track of `source` for range reads. Throws
 * `NoAudioTrackError` when the container has none. Reads are serialised, so
 * overlapping calls (a prefetch racing a seek) never share a decoder.
 */
export async function openAudioStream(
  source: Blob | string,
  opts: OpenAudioStreamOptions = {},
): Promise<AudioStream> {
  const mb = opts.mb ?? (await loadMediabunny())
  const backing =
    typeof source === 'string'
      ? mb.UrlSource
        ? new mb.UrlSource(source)
        : (() => {
            throw new Error('openAudioStream: this mediabunny build has no UrlSource')
          })()
      : new mb.BlobSource(source)
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: backing })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    input.dispose()
  }

  let track: AudioTrackLike | null
  let sampleRate: number
  let numberOfChannels: number
  let durationSec: number
  try {
    track = await input.getPrimaryAudioTrack()
    if (!track) throw new NoAudioTrackError()
    sampleRate = await track.getSampleRate()
    numberOfChannels = await track.getNumberOfChannels()
    durationSec = await track.computeDuration()
  } catch (err) {
    close()
    throw err
  }
  const sink = new mb.AudioSampleSink(track)

  let queue: Promise<unknown> = Promise.resolve()

  const readNow = async (startSec: number, endSec: number, ro: ReadRangeOptions): Promise<AudioRange> => {
    if (closed) throw new Error('openAudioStream: stream is closed')
    const i0 = Math.round(startSec * sampleRate)
    const i1 = Math.max(i0, Math.round(endSec * sampleRate))
    const frames = i1 - i0
    const wanted = ro.mono ? 1 : Math.max(1, Math.min(numberOfChannels, ro.maxChannels ?? numberOfChannels))
    const readChannels = ro.mono ? numberOfChannels : wanted
    const planes: Array<Float32Array<ArrayBuffer>> = []
    for (let c = 0; c < readChannels; c++) planes.push(new Float32Array(frames))

    if (frames > 0) {
      for await (const sample of sink.samples(Math.max(0, startSec), endSec)) {
        try {
          const s0 = Math.round(sample.timestamp * sampleRate)
          const from = Math.max(i0, s0)
          const to = Math.min(i1, s0 + sample.numberOfFrames)
          if (to <= from) continue
          const tmp = new Float32Array(sample.numberOfFrames)
          for (let c = 0; c < readChannels; c++) {
            sample.copyTo(tmp, { planeIndex: Math.min(c, sample.numberOfChannels - 1), format: 'f32-planar' })
            planes[c]!.set(tmp.subarray(from - s0, to - s0), from - i0)
          }
        } finally {
          sample.close()
        }
      }
    }

    let channels = planes
    if (ro.mono && planes.length > 1) {
      const mixed = new Float32Array(frames)
      for (const p of planes) for (let i = 0; i < frames; i++) mixed[i]! += p[i]!
      for (let i = 0; i < frames; i++) mixed[i]! /= planes.length
      channels = [mixed]
    }
    const target = ro.targetSampleRate && ro.targetSampleRate > 0 ? ro.targetSampleRate : sampleRate
    if (target !== sampleRate) channels = channels.map((c) => resampleLinear(c, sampleRate, target))
    return { channels, sampleRate: target }
  }

  return {
    durationSec,
    sampleRate,
    numberOfChannels,
    readRange(startSec, endSec, ro = {}) {
      const run = queue.then(() => readNow(startSec, endSec, ro))
      queue = run.catch(() => undefined)
      return run
    },
    close,
  }
}

export const WAVEFORM_STREAM_CHUNK_SEC = 30

export interface StreamPeaksOptions extends OpenAudioStreamOptions {
  /** Seconds of audio decoded per step. Default 30. */
  chunkSec?: number
  /** Reuse an already-open stream (not closed here). */
  stream?: AudioStream
  signal?: AbortSignal
}

/**
 * Normalised (0..1) peaks of the first channel, `peakCount` buckets over the
 * whole track, computed by walking the stream in chunks with one running max
 * per bucket: memory is O(peakCount + chunk), whatever the file size. Matches
 * `computeWaveform`'s whole-buffer rule (bucket = floor(frames / peakCount)
 * samples, max of |x|, divided by the global max); samples past the last full
 * bucket join the final bucket. `null` when the track has no frames.
 */
export async function streamPeaks(
  source: Blob | string,
  peakCount: number,
  opts: StreamPeaksOptions = {},
): Promise<Float32Array | null> {
  const stream = opts.stream ?? (await openAudioStream(source, opts))
  try {
    const sr = stream.sampleRate
    const total = Math.round(stream.durationSec * sr)
    if (total <= 0) return null
    const bucketSize = Math.max(1, Math.floor(total / peakCount))
    const peaks = new Float32Array(peakCount)
    const chunkFrames = Math.max(1, Math.round((opts.chunkSec ?? WAVEFORM_STREAM_CHUNK_SEC) * sr))
    for (let from = 0; from < total; from += chunkFrames) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const to = Math.min(total, from + chunkFrames)
      const { channels } = await stream.readRange(from / sr, to / sr, { maxChannels: 1 })
      const data = channels[0]!
      for (let j = 0; j < data.length; j++) {
        const bucket = Math.min(peakCount - 1, Math.floor((from + j) / bucketSize))
        const v = Math.abs(data[j]!)
        if (v > peaks[bucket]!) peaks[bucket] = v
      }
    }
    let globalMax = 0
    for (let i = 0; i < peakCount; i++) if (peaks[i]! > globalMax) globalMax = peaks[i]!
    if (globalMax > 0) for (let i = 0; i < peakCount; i++) peaks[i]! /= globalMax
    return peaks
  } finally {
    if (!opts.stream) stream.close()
  }
}

/**
 * Largest source the whole-file decode may still be asked to handle. Past this a
 * source that cannot be streamed (no WebCodecs decoder for its codec) is
 * refused with a message instead of exhausting memory.
 */
export const WHOLE_FILE_DECODE_MAX_BYTES = 2 * 1024 ** 3
