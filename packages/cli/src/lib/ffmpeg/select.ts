import { CliError } from '../errors'
import type { OutputFormat } from '../format'
import { FFMPEG_AUDIO_ENCODERS, FFMPEG_VIDEO_ENCODERS } from './encoder'
import type { FfmpegBinary } from './locate'

/** Who encodes the file: ffmpeg (preferred), Chrome's WebCodecs, or ffmpeg-if-usable. */
export type EncoderChoice = 'auto' | 'ffmpeg' | 'chrome'
export const ENCODER_CHOICES: readonly EncoderChoice[] = ['auto', 'ffmpeg', 'chrome']

export type EncoderDecision =
  | { encoder: 'ffmpeg'; ffmpeg: FfmpegBinary; videoEncoder: string; audioEncoder: string }
  /** `fallbackReason` is set when 'auto' wanted ffmpeg and could not use it. */
  | { encoder: 'chrome'; fallbackReason?: string }

/**
 * Decide the encoder for one render. Pure: `located` is the outcome of
 * `locateFfmpeg` (or an Error when it failed), so every branch is testable
 * without an ffmpeg on the machine. `format` is already valid for core's
 * container/codec matrix (format.ts). An explicit `'ffmpeg'` that cannot be
 * honoured throws; `'auto'` falls back to Chrome and says why.
 */
export function pickEncoder(
  choice: EncoderChoice,
  format: OutputFormat,
  located: FfmpegBinary | Error | undefined
): EncoderDecision {
  if (choice === 'chrome') return { encoder: 'chrome' }

  const usable = usableFfmpeg(format, located)
  if (typeof usable !== 'string') return { encoder: 'ffmpeg', ...usable }
  if (choice === 'ffmpeg') throw new CliError(usable)
  return { encoder: 'chrome', fallbackReason: usable }
}

/** The ffmpeg + encoders to use for `format`, or why there are none. */
function usableFfmpeg(
  format: OutputFormat,
  located: FfmpegBinary | Error | undefined
): { ffmpeg: FfmpegBinary; videoEncoder: string; audioEncoder: string } | string {
  if (!located) return 'ffmpeg was not looked up'
  if (located instanceof Error) return located.message
  const candidates = FFMPEG_VIDEO_ENCODERS[format.videoCodec]
  const videoEncoder = candidates.find((name) => located.encoders.has(name))
  if (!videoEncoder) {
    return `ffmpeg at '${located.path}' has no ${format.videoCodec} encoder (looked for ${candidates.join(', ')})`
  }
  const audioEncoder = FFMPEG_AUDIO_ENCODERS[format.container]
  if (!located.encoders.has(audioEncoder)) {
    return `ffmpeg at '${located.path}' has no '${audioEncoder}' audio encoder for ${format.container}`
  }
  return { ffmpeg: located, videoEncoder, audioEncoder }
}
