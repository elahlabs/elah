import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { CliError } from '../errors'
import { attachStderrTail } from './spawn'
import type { Container, VideoCodec } from '../format'
import type { FfmpegBinary } from './locate'

/**
 * PngFrameEncoder — the ffmpeg encode/mux process for `elah export`.
 *
 * Chrome still composites every frame with core's real renderer (so output
 * matches the editor); core's `png-sequence` export streams each finished
 * frame out as a PNG, and this pipes them into ffmpeg's stdin in order. The
 * project's audio mix (core's `renderAudioMix`, rendered in the page before
 * the first frame) arrives as a raw f32le file and is muxed in the same pass.
 *
 * This is the only place that owns ffmpeg's stdin, so it is the only place
 * backpressure is handled: `writeFrame` awaits 'drain', and the harness only
 * acknowledges a frame to the page once `writeFrame` resolves.
 *
 * `-movflags +faststart` needs a seekable output, which is why `outPath` is a
 * file rather than a stdout pipe.
 *
 * Ported from task-engine's media-export engine (ffmpeg/encoder.ts), with the
 * rawvideo RGBA input swapped for an image2pipe PNG input.
 */

/** ffmpeg encoders per codec, in order of preference; the first one the build has wins. */
export const FFMPEG_VIDEO_ENCODERS: Readonly<Record<VideoCodec, readonly string[]>> = {
  avc: ['libx264'],
  hevc: ['libx265'],
  av1: ['libsvtav1', 'libaom-av1'],
  vp9: ['libvpx-vp9'],
  vp8: ['libvpx'],
}

/** Audio per container, matching core's matrix: AAC in MP4, Opus in WebM. */
export const FFMPEG_AUDIO_ENCODERS: Readonly<Record<Container, string>> = {
  mp4: 'aac',
  webm: 'libopus',
}

/**
 * Per-encoder options. The AV1 encoders' defaults are tuned for archival and
 * run far below real time; these pick speed presets in line with what a
 * browser encoder does. `hvc1` is the HEVC sample entry Apple players need.
 */
const VIDEO_ENCODER_ARGS: Readonly<Record<string, readonly string[]>> = {
  libx265: ['-tag:v', 'hvc1'],
  libsvtav1: ['-preset', '8'],
  'libaom-av1': ['-cpu-used', '6', '-row-mt', '1'],
  'libvpx-vp9': ['-row-mt', '1'],
}

/** Same default as core's browser encoder, so the two paths size files alike. */
export const DEFAULT_VIDEO_BITRATE = 8_000_000
export const DEFAULT_AUDIO_BITRATE = 128_000

export interface EncoderAudioInput {
  /** Raw interleaved f32le PCM file. */
  path: string
  sampleRate: number
  channels: number
  bitrate: number
}

export interface PngEncoderInit {
  ffmpeg: FfmpegBinary
  outPath: string
  container: Container
  fps: number
  videoEncoder: string
  videoBitrate: number
  /** Used only when `audio` is set; see FFMPEG_AUDIO_ENCODERS. */
  audioEncoder: string
  audio: EncoderAudioInput | null
}

/**
 * Pure argv builder, testable without spawning.
 *
 * The colour conversion is pinned rather than inherited: swscale's default for
 * an untagged RGB input is BT.601 at limited range with "unspecified" written
 * to the stream, which players decode as BT.709 — the classic green/magenta
 * cast. Chrome's WebCodecs encoder tags HD as BT.709, so pinning it here also
 * keeps the ffmpeg and Chrome encoders from disagreeing on the same project.
 */
export function buildPngEncoderArgs(init: PngEncoderInit): string[] {
  const { container, fps, videoEncoder, videoBitrate, audioEncoder, audio, outPath } = init
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-c:v',
    'png',
    '-i',
    'pipe:0',
    ...(audio
      ? ['-f', 'f32le', '-ar', String(audio.sampleRate), '-ac', String(audio.channels), '-i', audio.path]
      : []),
    '-map',
    '0:v:0',
    ...(audio ? ['-map', '1:a:0'] : []),
    '-vf',
    'scale=in_range=full:out_range=tv:out_color_matrix=bt709',
    '-c:v',
    videoEncoder,
    ...(VIDEO_ENCODER_ARGS[videoEncoder] ?? []),
    '-b:v',
    String(videoBitrate),
    '-pix_fmt',
    'yuv420p',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
    ...(audio ? ['-c:a', audioEncoder, '-b:a', String(audio.bitrate)] : ['-an']),
    // Opus only runs at 48 kHz (or its submultiples); core's mix may be 44.1 kHz.
    ...(audio && container === 'webm' ? ['-ar', '48000'] : []),
    ...(container === 'mp4' ? ['-movflags', '+faststart'] : []),
    '-f',
    container,
    outPath,
  ]
}

/**
 * Interleave planar Float32 channels (core's `RenderedAudio.channels`) into
 * the f32le layout ffmpeg's raw audio demuxer reads.
 */
export function interleaveF32(channels: readonly Float32Array[], length: number): Buffer {
  const out = Buffer.alloc(length * channels.length * 4)
  const view = new Float32Array(out.buffer, out.byteOffset, length * channels.length)
  for (let c = 0; c < channels.length; c++) {
    const src = channels[c]!
    for (let i = 0; i < length; i++) view[i * channels.length + c] = src[i] ?? 0
  }
  return out
}

interface ExitInfo {
  code: number | null
}

export class PngFrameEncoder {
  readonly args: readonly string[]

  private readonly proc: ChildProcess
  private readonly exitPromise: Promise<ExitInfo>
  private readonly getStderrTail: () => string
  /** Latched once the process is known dead; every later write rethrows it. */
  private failed: CliError | null = null
  private framesWritten = 0

  private constructor(init: PngEncoderInit) {
    this.args = buildPngEncoderArgs(init)
    this.proc = spawn(init.ffmpeg.path, this.args, { stdio: ['pipe', 'ignore', 'pipe'] })

    // A dead ffmpeg makes stdin writes throw EPIPE; the real cause is the
    // stderr tail surfaced through exitPromise, so only swallow the EPIPE.
    this.proc.stdin!.on('error', () => {})
    this.getStderrTail = attachStderrTail(this.proc)

    // 'error' covers a spawn that never happened — without it writeFrame and
    // finish would wait forever for a 'close' that never comes.
    this.exitPromise = new Promise<ExitInfo>((resolve) => {
      this.proc.once('close', (code) => resolve({ code }))
      this.proc.once('error', () => resolve({ code: null }))
    })

    // Latch the failure the moment the process dies: writes to a closed pipe
    // don't fill the kernel buffer, so the drain race below may never run.
    void this.exitPromise.then(({ code }) => {
      if (code !== 0) this.captureFailure(code)
    })
  }

  static start(init: PngEncoderInit): PngFrameEncoder {
    return new PngFrameEncoder(init)
  }

  get frames(): number {
    return this.framesWritten
  }

  /**
   * Write one PNG frame, awaiting 'drain' when the pipe is full. Racing the
   * drain against the process exit turns a mid-export ffmpeg death into its
   * real error instead of a hang.
   */
  async writeFrame(png: Buffer): Promise<void> {
    if (this.failed) throw this.failed
    this.framesWritten++
    if (this.proc.stdin!.write(png)) return
    await Promise.race([
      once(this.proc.stdin!, 'drain'),
      this.exitPromise.then(({ code }) => {
        throw this.captureFailure(code)
      }),
    ])
  }

  /** End stdin and resolve when ffmpeg exits 0; reject with the stderr tail otherwise. */
  async finish(): Promise<void> {
    if (this.failed) throw this.failed
    this.proc.stdin!.end()
    const { code } = await this.exitPromise
    if (code !== 0) throw this.captureFailure(code)
  }

  /** SIGKILL and wait for exit. Safe after finish — a dead process is a no-op. */
  async abort(): Promise<void> {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return
    this.proc.kill('SIGKILL')
    await this.exitPromise
  }

  private captureFailure(code: number | null): CliError {
    if (this.failed) return this.failed
    this.failed = new CliError(
      `ffmpeg exited with code ${code ?? 'null'} while encoding\n` +
        `argv: ffmpeg ${this.args.join(' ')}\n` +
        `stderr:\n${this.getStderrTail() || '(empty)'}`
    )
    return this.failed
  }
}
