/**
 * FrameEncoder — the single encode/mux process.
 *
 * Rawvideo RGBA goes in on stdin (one export frame at a time, in presentation
 * order); the audio filter graph (built by audio.ts, see AudioMixSpec) is
 * spliced in as extra ffmpeg inputs + `-filter_complex`; MP4 comes out on
 * disk. This is the only place in the package that owns a child process's
 * stdin, so it is also the only place backpressure has to be handled —
 * constraint 5 of the package brief: skipping the `drain` wait would buffer
 * the entire export in memory, the exact failure this package exists to avoid.
 *
 * `-movflags +faststart` requires a seekable output, which is why `outPath`
 * is a file path rather than a stdout pipe returning a Buffer — a
 * fragmented-MP4 stdout stream cannot carry a moov-atom rewrite.
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'

import type { FfmpegBinary, AudioMixSpec } from '../types'
import { ExportServerError } from '../errors'
import { attachStderrTail } from './spawn'

export interface EncoderAudio {
  spec: AudioMixSpec
  encoder: string
  bitrate: number
}

export interface EncoderInit {
  ffmpeg: FfmpegBinary
  outPath: string
  width: number
  height: number
  fps: number
  videoEncoder: string
  videoBitrate: number
  audio: EncoderAudio | null
  extraOutputArgs?: string[]
  signal?: AbortSignal
}

/**
 * Pure argv builder — no spawning, so it is snapshot-testable on its own.
 *
 * Order matters: audio inputs are appended after the rawvideo pipe (index 0),
 * so they land at input index 1..N, matching the index `AudioMixSpec`'s
 * filter graph was written against. `-b:v` (not CRF) so `videoBitrate` means
 * the same thing here as it does in the browser exporter's ExportOptions.
 * `extraOutputArgs` is spliced in last so a caller can override anything
 * upstream of it (e.g. `['-preset', 'veryfast']`, `['-crf', '18', '-b:v', '0']`).
 *
 * The colour conversion is pinned rather than inherited. swscale's default for
 * an untagged rgba input is BT.601 coefficients at limited range, and it writes
 * "unspecified" into the bitstream — so players fall back to their usual
 * heuristic and decode HD as BT.709, inverting a matrix that was never applied.
 * That is the classic green/magenta cast on saturated colour. Chrome's
 * WebCodecs path tags HD as BT.709, so inheriting the default would also mean
 * the same project exports differently in the editor and on the server, which
 * is the one property this package exists to guarantee. `scale` does the
 * conversion (its `w`/`h` default to the input's, so this is colour-only),
 * `in_range=full` states what rgba actually is, and the `-color*` flags tag the
 * muxed stream with what was done to it.
 */
export function buildEncoderArgs(init: EncoderInit): string[] {
  const { width, height, fps, videoEncoder, videoBitrate, audio, extraOutputArgs, outPath } = init
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    ...(audio ? audio.spec.inputs.flatMap(i => ['-i', i.source]) : []),
    ...(audio ? ['-filter_complex', audio.spec.filterComplex, '-map', audio.spec.outLabel] : []),
    '-map', '0:v:0',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709',
    '-c:v', videoEncoder, '-b:v', String(videoBitrate), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    ...(audio
      ? ['-c:a', audio.encoder, '-b:a', String(audio.bitrate), '-ar', String(audio.spec.sampleRate), '-ac', String(audio.spec.channels)]
      : ['-an']),
    '-movflags', '+faststart',
    ...(extraOutputArgs ?? []),
    '-f', 'mp4', outPath,
  ]
}

/** Resolution of the process's terminal event — the only thing writeFrame's drain race and finish() both need. */
interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
}

export class FrameEncoder {
  readonly args: readonly string[]

  private readonly proc: ReturnType<typeof spawn>
  private readonly exitPromise: Promise<ExitInfo>
  private readonly getStderrTail: () => string
  /** Set once the process is known to be unusable; every subsequent writeFrame rethrows it instead of writing into a dead pipe. */
  private failed: Error | null = null

  private constructor(init: EncoderInit) {
    this.args = buildEncoderArgs(init)
    this.proc = spawn(init.ffmpeg.path, this.args, { stdio: ['pipe', 'ignore', 'pipe'] })

    // A dead ffmpeg makes writes to stdin throw EPIPE. The real cause is
    // always the stderr tail + exit code surfaced through exitPromise, so
    // this handler exists only to stop the EPIPE itself from crashing the
    // process as an unhandled 'error' on a Writable.
    this.proc.stdin!.on('error', () => {})

    // Shared with decoder.ts so neither module reinvents stderr capture.
    this.getStderrTail = attachStderrTail(this.proc)

    // Resolve on whichever terminal event fires first. 'error' covers a spawn
    // that never happened at all (e.g. a race between ffmpeg discovery and
    // the binary disappearing) — without this branch a failed spawn would
    // hang writeFrame/finish forever waiting for a 'close' that never comes.
    this.exitPromise = new Promise<ExitInfo>(resolve => {
      this.proc.once('close', (code, signal) => resolve({ code, signal }))
      this.proc.once('error', () => resolve({ code: null, signal: null }))
    })

    // Latch the failure the moment the process dies, independently of the
    // drain race in writeFrame. Writes to a closed pipe do NOT fill the kernel
    // buffer, so stdin.write() keeps returning true and the drain race is
    // never reached — without this, an ffmpeg that died at frame 20 of 20,000
    // would let the loop resolve, decode and composite every remaining frame
    // into a dead pipe before finish() finally surfaced the error.
    void this.exitPromise.then(({ code }) => {
      if (code !== 0) this.captureFailure(code)
    })

    if (init.signal) {
      if (init.signal.aborted) this.abort()
      else init.signal.addEventListener('abort', () => this.abort(), { once: true })
    }
  }

  static start(init: EncoderInit): FrameEncoder {
    return new FrameEncoder(init)
  }

  /**
   * Writes one RGBA frame, awaiting 'drain' when the pipe is full.
   *
   * `Buffer.from(frame.buffer, ...)` is a view, not a copy — the caller's
   * `Uint8ClampedArray` must not be mutated again until this resolves.
   *
   * Race handled: if ffmpeg dies while we are awaiting 'drain', the pipe
   * closes and 'drain' never fires, which would otherwise hang the export
   * forever. Racing against `exitPromise` guarantees this call always
   * settles, turning a silent hang into the real ENCODE_FAILED error.
   */
  async writeFrame(frame: Uint8ClampedArray): Promise<void> {
    if (this.failed) throw this.failed
    const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
    if (this.proc.stdin!.write(buf)) return
    await Promise.race([
      once(this.proc.stdin!, 'drain'),
      this.exitPromise.then(({ code }) => {
        throw this.captureFailure(code)
      }),
    ])
  }

  /** Ends stdin and resolves when ffmpeg exits 0; rejects with the stderr tail otherwise. */
  async finish(): Promise<void> {
    if (this.failed) throw this.failed
    this.proc.stdin!.end()
    const { code } = await this.exitPromise
    if (code !== 0) throw this.captureFailure(code)
  }

  /** SIGKILLs the process. Safe to call after finish() — killing an already-exited process is a no-op. */
  abort(): void {
    this.proc.kill('SIGKILL')
  }

  /** Builds and caches the terminal error so every future writeFrame call rethrows the same one instead of racing exitPromise again. */
  private captureFailure(code: number | null): ExportServerError {
    if (this.failed) return this.failed as ExportServerError
    const err = new ExportServerError(
      'ENCODE_FAILED',
      `ffmpeg exited with code ${code ?? 'null'}\n` +
      `argv: ffmpeg ${this.args.join(' ')}\n` +
      `stderr:\n${this.getStderrTail() || '(empty)'}`,
    )
    this.failed = err
    return err
  }
}
