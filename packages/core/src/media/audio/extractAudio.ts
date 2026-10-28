/**
 * Extract a trimmed, 16 kHz mono audio file from a media Blob, for speech-to-text
 * (LM-P4). A 10-minute local MOV becomes a few hundred KB of Ogg/Opus (or ~19 MB
 * of WAV where Opus encoding is unavailable) instead of the whole source upload.
 *
 * mediabunny is imported dynamically (same as `assets/hasAudio.ts`) so bundles
 * that never caption don't pull it in; `opts.mb` is the test seam.
 */

/** The slice of the mediabunny module this file uses. */
export type MediabunnyLike = Pick<
  typeof import('mediabunny'),
  'Input' | 'Output' | 'BlobSource' | 'BufferTarget' | 'ALL_FORMATS' | 'Conversion' | 'OggOutputFormat' | 'WavOutputFormat' | 'canEncodeAudio'
>

export interface ExtractAudioRange {
  startSec: number
  endSec: number
}

export interface ExtractAudioOptions {
  mb?: MediabunnyLike
  /** Default true: use Opus in Ogg when the browser can encode it, else WAV. */
  preferOpus?: boolean
  signal?: AbortSignal
}

export interface ExtractedAudio {
  blob: Blob
  ext: 'ogg' | 'wav'
  mime: string
  /** Length of the extracted range after clamping to the source, in seconds. */
  durationSec: number
}

/** Error message when the source has no audio track to extract. */
export const NO_AUDIO_TRACK = 'NO_AUDIO_TRACK'

export const TRANSCRIPTION_SAMPLE_RATE = 16000
const OPUS_BITRATE = 24_000

export async function extractAudioForTranscription(
  source: Blob,
  range: ExtractAudioRange,
  opts: ExtractAudioOptions = {},
): Promise<ExtractedAudio> {
  const { signal } = opts
  const abort = () => new DOMException('Aborted', 'AbortError')
  if (signal?.aborted) throw abort()
  if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) {
    throw new Error('extractAudioForTranscription: range must be finite')
  }

  const mb: MediabunnyLike = opts.mb ?? ((await import('mediabunny')) as unknown as MediabunnyLike)
  if (signal?.aborted) throw abort()

  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(source) })
  try {
    const total = await input.computeDuration()
    const start = Math.max(0, range.startSec)
    const end = Math.min(range.endSec, Number.isFinite(total) && total > 0 ? total : range.endSec)
    if (!(end > start)) throw new Error('extractAudioForTranscription: empty range')

    const channels = { numberOfChannels: 1, sampleRate: TRANSCRIPTION_SAMPLE_RATE }
    const useOpus =
      opts.preferOpus !== false &&
      (await mb.canEncodeAudio('opus', { ...channels, bitrate: OPUS_BITRATE }).catch(() => false))

    const target = new mb.BufferTarget()
    const output = new mb.Output({
      format: useOpus ? new mb.OggOutputFormat() : new mb.WavOutputFormat(),
      target,
    })
    const conversion = await mb.Conversion.init({
      input,
      output,
      trim: { start, end },
      video: { discard: true },
      audio: useOpus
        ? { ...channels, codec: 'opus', bitrate: OPUS_BITRATE }
        : { ...channels, codec: 'pcm-s16' },
    })
    if (!conversion.isValid) throw new Error(NO_AUDIO_TRACK)

    const onAbort = () => void conversion.cancel()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal?.aborted) onAbort()
      await conversion.execute()
    } catch (err) {
      if (signal?.aborted) throw abort()
      throw err
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) throw abort()

    const buffer = target.buffer
    if (!buffer) throw new Error('extractAudioForTranscription: no output produced')
    const mime = useOpus ? 'audio/ogg' : 'audio/wav'
    return {
      blob: new Blob([buffer], { type: mime }),
      ext: useOpus ? 'ogg' : 'wav',
      mime,
      durationSec: end - start,
    }
  } finally {
    input.dispose()
  }
}
