/**
 * ClipDecoder — one ffmpeg decode process per video clip, plus the cursor
 * that turns "the source presentation index I want" into "the next raw
 * frame off the pipe". This is the Node replacement for mediabunny's
 * `sink.canvasesAtTimestamps()` generator that the browser exporter uses
 * (`packages/core/src/export/ExportWorker.ts:284`).
 *
 * One process per CLIP, not per source file: two clips trimmed from the same
 * source need independent forward-only cursors, exactly as ExportWorker gives
 * each clip its own generator. The caller (plan.ts / the frame loop) is
 * responsible for opening a clip's decoder lazily on its first active frame
 * and closing it on its last, so process count tracks simultaneously-active
 * clips rather than total clips in the project.
 *
 * Frame accuracy rests entirely on `-fps_mode passthrough`: it forbids ffmpeg
 * from duplicating or dropping frames to hit a constant rate, so raw frame
 * `j` off the pipe IS source presentation frame `startIndex + j`. Every dup
 * and every drop is therefore decided in JS, one export frame at a time, from
 * the explicit `sourceIndices` the caller pre-computed against the real PTS
 * index (see plan.ts's `mapSourceFramesToIndices`) — never by `-vf fps=` or
 * `-r`, which would move that decision inside ffmpeg where it is invisible,
 * unauditable, and rounds differently from the resolver.
 *
 * Seek is `-ss` BEFORE `-i`, deliberately (see `buildDecoderArgs`'s doc for
 * why the midpoint lands exactly on the wanted frame). Output seek (`-ss`
 * after `-i`) was rejected because it decodes from the start of the file for
 * every clip, which is ruinous for a clip trimmed far into a long source.
 *
 * Known limitation: `-map 0:v:0` selects the first video stream, matching
 * mediabunny's `getPrimaryVideoTrack()` for every common container but not
 * guaranteed for exotic multi-track files.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

import { ExportServerError } from '../errors'
import { attachStderrTail } from './spawn'
import { RawFrameReader } from './rawFrames'

import type { FfmpegBinary, DecodedFrame, VideoFrameIndex } from '../types'

export interface ClipDecoderInit {
  ffmpeg: FfmpegBinary
  /** Resolved source: absolute path or http(s) URL. */
  source: string
  index: VideoFrameIndex
  /** Source presentation indices, one per export frame this clip covers. Non-decreasing; -1 = no frame. */
  sourceIndices: Int32Array
  /** Pixel dimensions ffmpeg is asked to emit (may be < display dims when decodeMaxHeight is set). */
  decodeWidth: number
  decodeHeight: number
  /** Geometry dimensions handed to resolveDrawRect — always the TRUE display dims. */
  displayWidth: number
  displayHeight: number
  signal?: AbortSignal
}

/**
 * The value of the first non-negative entry in `sourceIndices` — i.e. `k0`,
 * the source presentation index of this clip's first visible frame. Scanning
 * in order (rather than e.g. `Math.min`) matters only in that it stops at the
 * first match; the plan's monotonicity guarantee means every later
 * non-negative entry is >= this one anyway. Returns -1 when every entry is -1
 * (a clip that is opened but never actually shows a frame — degenerate, but
 * handled rather than assumed away: `computeSeekTime` treats -1 the same as
 * 0, so the process still spawns cleanly with no seek).
 */
function firstNonNegativeSourceIndex(sourceIndices: Int32Array): number {
  for (let i = 0; i < sourceIndices.length; i++) {
    const value = sourceIndices[i]
    if (value >= 0) return value
  }
  return -1
}

/**
 * The `-ss` seek target, in seconds: the midpoint between the PTS of the
 * frame before `k0` and the PTS of `k0` itself.
 *
 * `-ss` before `-i` uses `accurate_seek` (ffmpeg's input-seek default): it
 * decodes from the keyframe at or before the seek time and DISCARDS frames
 * whose PTS is below it, so the first emitted frame is the first one at or
 * after the seek time. Landing exactly on `timestamps[k0]` would risk that
 * frame being discarded by float rounding in `seekTime.toFixed(6)`; landing
 * on the midpoint gives a full half-frame of margin on both sides, so no
 * amount of formatting error can make ffmpeg emit `k0 - 1` or skip `k0`. The
 * only cost is that ffmpeg may begin decoding one extra GOP earlier, once per
 * clip — far cheaper than output-seek's "decode from the start of the file".
 *
 * The two time bases are NOT the same origin, which is the subtle part.
 * mediabunny reports absolute track presentation timestamps: its own docs note
 * the first one "may be positive or even negative. A negative starting
 * timestamp means the track's timing has been offset". ffmpeg's input `-ss`,
 * by contrast, is relative to the container's `start_time` — it adds
 * `start_time` back before seeking. Passing an absolute PTS straight through
 * therefore overshoots by `start_time` on any source whose first packet is not
 * at 0 (MPEG-TS captures, MP4s with an edit list, anything remuxed with
 * `-copyts`), and because `ClipDecoder` only counts frames after the seek, the
 * clip renders the wrong source content for its ENTIRE duration with no error.
 * Rebasing against `timestamps[0]` puts the request back in ffmpeg's base. A
 * negative first timestamp is clamped to 0: ffmpeg has no negative input seek,
 * and the offset is already folded into the container's own start_time.
 */
function computeSeekTime(timestamps: Float64Array, k0: number): number {
  if (k0 <= 0) return 0
  const base = timestamps[0] > 0 ? timestamps[0] : 0
  return Math.max(0, (timestamps[k0 - 1] + timestamps[k0]) / 2 - base)
}

/**
 * Pure argv builder — no spawning, so it is snapshot-testable on its own.
 *
 * `-fps_mode passthrough` is the single most important flag on this command
 * line: it is what makes "raw frame `j` off the pipe is source presentation
 * frame `startIndex + j`" true, and therefore what makes the whole cursor in
 * `ClipDecoder.next()` valid. Never add `-vf fps=` or `-r` here.
 */
export function buildDecoderArgs(init: ClipDecoderInit): string[] {
  const { source, index, sourceIndices, decodeWidth, decodeHeight } = init
  const k0 = firstNonNegativeSourceIndex(sourceIndices)
  const seekTime = computeSeekTime(index.timestamps, k0)

  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error']
  if (seekTime !== 0) args.push('-ss', seekTime.toFixed(6))
  args.push(
    '-i', source,
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `scale=${decodeWidth}:${decodeHeight}:flags=bicubic`,
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  )
  return args
}

export class ClipDecoder {
  /** ffmpeg argv, exposed for tests and error messages. */
  readonly args: readonly string[]

  private readonly child: ChildProcess
  private readonly reader: RawFrameReader
  private readonly getStderrTail: () => string
  /** Rejects with a DECODE_FAILED error iff the process exits abnormally; never resolves. Raced against every reader.read(). */
  private readonly failureSignal: Promise<never>

  /** Retained only so terminate() can detach the abort listener it registered. */
  private abortSignal: AbortSignal | null = null
  private onAbort: (() => void) | null = null

  private readonly source: string
  private readonly sourceIndices: Int32Array
  private readonly decodeWidth: number
  private readonly decodeHeight: number
  private readonly displayWidth: number
  private readonly displayHeight: number

  /** Index into `sourceIndices` of the next export frame `next()` will serve. */
  private step = 0
  /** The source presentation index of the frame currently held (starts one before the clip's first wanted frame). */
  private cursor: number
  /** The most recently read raw frame — re-returned as-is on a duplicate (`want === cursor`). */
  private held: Uint8ClampedArray | null = null
  /** Set once the source has run dry; every subsequent next() short-circuits to null. */
  private exhausted = false
  /** Distinguishes an intentional close() kill from a real crash, for the exit handler below. */
  private killedByUs = false
  private closePromise: Promise<void> | null = null

  private constructor(init: ClipDecoderInit) {
    this.source = init.source
    this.sourceIndices = init.sourceIndices
    this.decodeWidth = init.decodeWidth
    this.decodeHeight = init.decodeHeight
    this.displayWidth = init.displayWidth
    this.displayHeight = init.displayHeight

    const startIndex = firstNonNegativeSourceIndex(init.sourceIndices)
    this.cursor = startIndex - 1

    this.args = buildDecoderArgs(init)
    this.child = spawn(init.ffmpeg.path, this.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    // Shared with encoder.ts so neither module reinvents stderr capture.
    this.getStderrTail = attachStderrTail(this.child)
    this.reader = new RawFrameReader(this.child.stdout!, this.decodeWidth * this.decodeHeight * 4)

    // A crashed ffmpeg still closes stdout cleanly, which RawFrameReader
    // would otherwise read as ordinary end-of-source (a short clip, not an
    // error). This promise turns a non-zero/abnormal exit into an explicit
    // rejection so callers can tell "source ran out" from "ffmpeg died" —
    // raced against reader.read() in next()'s pull loop. It deliberately
    // never resolves on a clean exit: the real EOF path is left to
    // RawFrameReader's own 'end' handling.
    this.failureSignal = new Promise<never>((_, reject) => {
      this.child.once('close', (code, signal) => {
        if (this.killedByUs) return
        if (code === 0 && signal === null) return
        reject(this.decodeError(code, signal))
      })
    })
    // Silence "unhandled rejection" when a clip finishes normally and this
    // promise is left permanently pending-then-garbage-collected, or when it
    // rejects between next() calls with nothing currently racing it.
    this.failureSignal.catch(() => {})

    // Detached in terminate(). Decoders are opened and closed per clip against
    // one long-lived export signal, so leaving these attached would grow the
    // listener count with the project's clip count — Node warns at 10 on an
    // AbortSignal, turning a healthy 11-clip render into a spurious
    // MaxListenersExceededWarning on a server's stderr — and would keep every
    // closed decoder reachable from the signal for the whole export.
    if (init.signal) {
      if (init.signal.aborted) void this.close()
      else {
        this.abortSignal = init.signal
        this.onAbort = () => void this.close()
        init.signal.addEventListener('abort', this.onAbort, { once: true })
      }
    }
  }

  static open(init: ClipDecoderInit): ClipDecoder {
    return new ClipDecoder(init)
  }

  /**
   * Advances one export frame. Returns null when the source ran out or the
   * step maps to -1 (target before this clip's first source frame — the same
   * case mediabunny's `CanvasSink` returns null for).
   *
   * The returned `data` is a view owned by the underlying `RawFrameReader`
   * and is invalidated by the next `next()` call — the compositor must draw
   * it immediately, and the transition snapshot store must copy it if it
   * needs to survive past that point.
   *
   * This is the Node analogue of `ExportWorker.ts:322-327`'s per-frame
   * `decoder.gen.next()` advance, and the dup/drop kernel the whole package's
   * frame-accuracy strategy rests on:
   *   - `want === cursor` re-returns the held frame — a DUPLICATE, because the
   *     source is slower than the project rate at this point.
   *   - `want > cursor` pulls and discards intermediate frames — a DROP,
   *     because the source is faster than the project rate.
   *   - `want < cursor` is impossible under the plan's non-decreasing
   *     guarantee; if it ever happens this throws rather than seeking
   *     backwards, which `-fps_mode passthrough` + a forward-only pipe cannot
   *     do anyway.
   */
  async next(): Promise<DecodedFrame | null> {
    if (this.step >= this.sourceIndices.length) {
      throw new ExportServerError(
        'DECODE_FAILED',
        `ClipDecoder.next() called past the end of its plan for '${this.source}' ` +
        `(${this.sourceIndices.length} frame(s) planned)`,
      )
    }
    const want = this.sourceIndices[this.step]
    this.step++

    if (want < 0) return null

    if (want < this.cursor) {
      throw new ExportServerError(
        'DECODE_FAILED',
        `non-monotonic source index for '${this.source}': requested ${want} ` +
        `after the decoder cursor already reached ${this.cursor}`,
      )
    }

    if (this.exhausted) return null

    while (this.cursor < want) {
      const frame = await Promise.race([this.reader.read(), this.failureSignal])
      if (frame === null) {
        this.exhausted = true
        return null
      }
      this.held = frame
      this.cursor++
    }

    if (!this.held) return null
    return {
      data: this.held,
      width: this.decodeWidth,
      height: this.decodeHeight,
      displayWidth: this.displayWidth,
      displayHeight: this.displayHeight,
    }
  }

  /** Kills the process, drains stderr, releases the reader. Idempotent. */
  async close(): Promise<void> {
    if (!this.closePromise) this.closePromise = this.terminate()
    return this.closePromise
  }

  private async terminate(): Promise<void> {
    this.killedByUs = true
    if (this.abortSignal && this.onAbort) {
      this.abortSignal.removeEventListener('abort', this.onAbort)
      this.abortSignal = null
      this.onAbort = null
    }
    this.reader.destroy()
    // SIGKILL, not SIGTERM: ffmpeg blocked writing to a full stdout pipe (the
    // export loop stalled, or an abort mid-export) does not reliably act on
    // SIGTERM, and teardown must not hang.
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGKILL')
    }
    await new Promise<void>(resolve => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve()
        return
      }
      this.child.once('close', () => resolve())
    })
  }

  private decodeError(code: number | null, signal: NodeJS.Signals | null): ExportServerError {
    const reason = signal ? `signal ${signal}` : `code ${code}`
    const stderr = this.getStderrTail()
    return new ExportServerError(
      'DECODE_FAILED',
      `ffmpeg exited with ${reason} while decoding '${this.source}'\n` +
      `argv: ffmpeg ${this.args.join(' ')}\n` +
      `stderr:\n${stderr || '(empty)'}`,
      { stderr },
    )
  }
}
