/**
 * Per-clip decode plans for export (EDX-P6).
 *
 * The exporter's rule is that each source is decoded SEQUENTIALLY through
 * `canvasesAtTimestamps` — random access per frame produced corrupt
 * green-band frames. A constant-speed clip already satisfies that with one
 * increasing timestamp per export frame. A time-remapped clip may not:
 *
 *   - ramps and freezes are non-decreasing → one generator over the DISTINCT
 *     timestamps; a repeated frame reuses the last canvas;
 *   - reverse / boomerang go backwards → the clip is cut into windows of
 *     `windowFrames` export frames; each window decodes its own frames in
 *     ascending order through a fresh generator (one seek per window) and
 *     serves them in timeline order.
 *
 * Pure over an injected `sink`, so the plan is testable without mediabunny.
 */

export interface CanvasSinkLike<C> {
  canvasesAtTimestamps(timestamps: number[]): AsyncGenerator<C | null, void, unknown>
}

export interface ClipFrameSource<C> {
  /** The canvas for the next export frame of this clip. Call once per frame, in order. */
  next(): Promise<C | null>
}

/** Timestamp (s) for a source frame: the frame's midpoint, matching the preview's rounding. */
export function frameTimestamp(sourceFrame: number, fps: number): number {
  return (sourceFrame + 0.5) / fps
}

export function isNonDecreasing(frames: ReadonlyArray<number>): boolean {
  for (let i = 1; i < frames.length; i++) if (frames[i]! < frames[i - 1]!) return false
  return true
}

/** The constant-speed plan, exactly as the exporter always computed it. */
export function constantSpeedTimestamps(
  sourceStartFrame: number,
  speed: number,
  durationFrames: number,
  fps: number,
): number[] {
  return Array.from({ length: durationFrames }, (_, i) => (sourceStartFrame + i * speed + 0.5) / fps)
}

/** One generator, one timestamp per export frame (today's path). */
export function sequentialSource<C>(sink: CanvasSinkLike<C>, timestamps: number[]): ClipFrameSource<C> {
  const gen = sink.canvasesAtTimestamps(timestamps)
  return {
    async next() {
      const r = await gen.next()
      return r.done ? null : (r.value ?? null)
    },
  }
}

/** Non-decreasing remap: decode each distinct frame once, repeat the last for holds. */
export function monotonicSource<C>(sink: CanvasSinkLike<C>, frames: ReadonlyArray<number>, fps: number): ClipFrameSource<C> {
  const distinct: number[] = []
  for (const f of frames) if (distinct.length === 0 || distinct[distinct.length - 1] !== f) distinct.push(f)
  const gen = sink.canvasesAtTimestamps(distinct.map((f) => frameTimestamp(f, fps)))
  let i = 0
  let currentFrame: number | null = null
  let current: C | null = null
  return {
    async next() {
      const want = frames[i++]
      if (want === undefined) return null
      if (want !== currentFrame) {
        const r = await gen.next()
        current = r.done ? null : (r.value ?? null)
        currentFrame = want
      }
      return current
    },
  }
}

/**
 * Any order: decode in windows. Each window's distinct frames are decoded
 * ascending into a small map, then served in timeline order; the map is
 * dropped when the window ends, so memory stays at `windowFrames` canvases.
 */
export function windowedSource<C>(
  sink: CanvasSinkLike<C>,
  frames: ReadonlyArray<number>,
  fps: number,
  windowFrames = 12,
): ClipFrameSource<C> {
  let i = 0
  let windowStart = -1
  let decoded = new Map<number, C | null>()
  const load = async (start: number) => {
    const slice = frames.slice(start, start + windowFrames)
    const distinct = [...new Set(slice)].sort((a, b) => a - b)
    const gen = sink.canvasesAtTimestamps(distinct.map((f) => frameTimestamp(f, fps)))
    const map = new Map<number, C | null>()
    for (const f of distinct) {
      const r = await gen.next()
      map.set(f, r.done ? null : (r.value ?? null))
    }
    await gen.return?.(undefined)
    decoded = map
    windowStart = start
  }
  return {
    async next() {
      if (i >= frames.length) return null
      if (windowStart < 0 || i >= windowStart + windowFrames) await load(i)
      return decoded.get(frames[i++]!) ?? null
    },
  }
}

/**
 * The frame source for one clip: `remapped` is the per-frame source frame
 * list for a time-remapped clip, or null for constant speed.
 */
export function clipFrameSource<C>(
  sink: CanvasSinkLike<C>,
  clip: { sourceStartFrame: number; speed?: number; durationFrames: number },
  remapped: ReadonlyArray<number> | null,
  fps: number,
): ClipFrameSource<C> {
  if (!remapped) return sequentialSource(sink, constantSpeedTimestamps(clip.sourceStartFrame, clip.speed ?? 1, clip.durationFrames, fps))
  return isNonDecreasing(remapped) ? monotonicSource(sink, remapped, fps) : windowedSource(sink, remapped, fps)
}
