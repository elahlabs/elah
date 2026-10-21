/**
 * A CanvasSink wrapper that survives the browser's WebCodecs decoder dying
 * mid-stream.
 *
 * Measured on a Canon camera MOV (H.264 Constrained Baseline, level 5.0,
 * 1920x1088 coded, 25 fps, ~43 Mbit/s, keyframe every 12 frames): ffmpeg
 * strict-decodes all 1136 frames, yet decoding it through mediabunny's default
 * CanvasSink configuration threw `EncodingError: Decoding error.` in 3 of 6
 * runs, each at a DIFFERENT frame (612, 624, 468). A forced software decoder
 * passed 3/3, a forced hardware decoder 2/2, and decoding fresh from frame 600
 * passed. So the failure is an intermittent decoder death, not a bad file, and
 * one thrown error used to kill the whole export.
 *
 * Recovery: when the inner generator throws a decode error, build a NEW sink
 * (the caller varies the decoder configuration per attempt) and carry on with
 * the timestamps the consumer has not yet received. mediabunny seeks to the
 * preceding keyframe on its own, so the resumed run is bit-exact.
 *
 * Why not simply force software decoding for everything: Chrome decodes HEVC
 * (iPhone footage) only in hardware, so a software-only sink would break those
 * files. The default configuration stays attempt 0 and only a failure escalates.
 *
 * The rebuild budget belongs to the wrapper (one per source), not to a call, so
 * a hopeless file cannot loop forever; when it runs out the ORIGINAL error is
 * rethrown. Pure: no mediabunny import, testable with fakes.
 */

import type { CanvasSinkLike } from './clipFrames'

export interface ResilientSinkOptions {
  /** Rebuilds allowed over the wrapper's lifetime. Default 2. */
  maxRebuilds?: number
  /** Called when a decode error is being recovered from. `resumeIndex` = frames already delivered. */
  onRebuild?: (info: { attempt: number; resumeIndex: number; error: unknown }) => void
  /** Which errors are worth a rebuild. Default: `EncodingError` or a "decod…" message; never AbortError. */
  isRecoverable?: (err: unknown) => boolean
}

export function isDecodeError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  if (name === 'AbortError') return false
  if (name === 'EncodingError') return true
  return err instanceof Error && /decod/i.test(err.message)
}

export function resilientCanvasSink<C>(
  makeSink: (attempt: number) => CanvasSinkLike<C>,
  opts: ResilientSinkOptions = {},
): CanvasSinkLike<C> {
  const maxRebuilds = opts.maxRebuilds ?? 2
  const isRecoverable = opts.isRecoverable ?? isDecodeError
  let sink = makeSink(0)
  let rebuilds = 0

  return {
    async *canvasesAtTimestamps(timestamps: number[]) {
      let yielded = 0
      let inner = sink.canvasesAtTimestamps(timestamps)
      try {
        for (;;) {
          try {
            const r = await inner.next()
            if (r.done) return
            yielded++
            yield r.value
          } catch (err) {
            if (!isRecoverable(err) || rebuilds >= maxRebuilds) throw err
            rebuilds++
            opts.onRebuild?.({ attempt: rebuilds, resumeIndex: yielded, error: err })
            await inner.return?.(undefined).catch(() => {})
            sink = makeSink(rebuilds)
            inner = sink.canvasesAtTimestamps(timestamps.slice(yielded))
          }
        }
      } finally {
        // Consumer stopped early (or we are finishing): close the live inner generator.
        await inner.return?.(undefined).catch(() => {})
      }
    },
  }
}
