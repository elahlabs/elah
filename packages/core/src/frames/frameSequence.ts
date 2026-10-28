/**
 * FrameSequence — an ordered set of visual frames addressed by integer index.
 *
 * The abstraction behind 360° product/property/model viewers, generated image
 * sets, storyboards, and timeline previews. It is deliberately *not* tied to
 * any of those: a sequence is frames + how to move through them. What the
 * frames depict is the caller's business.
 *
 * Pure and React-free (ARCHITECTURE P1). The controller that drives one lives
 * in ./FrameSequenceController; the React viewer lives in
 * the frame-sequence package.
 */

import { generateId } from '../utils/id'

/**
 * One responsive candidate for a frame. Mirrors what `<source srcset>` needs,
 * so a viewer can serve AVIF to browsers that take it and WebP to the rest
 * without the sequence knowing anything about markup.
 */
export interface FrameSource {
  src: string
  /** Intrinsic width in px — the `w` descriptor in a srcset. */
  width: number
  /** MIME type, e.g. 'image/avif'. Omit to let the browser sniff. */
  type?: string
}

export interface Frame {
  id: string
  /** Position in the sequence. Always equals the array index. */
  index: number
  /** The fallback/base source. Always set, even when `sources` is present. */
  src: string
  /** Responsive candidates, widest-first is not required — the viewer sorts. */
  sources?: FrameSource[]
}

/**
 * How index movement behaves at the ends of the sequence.
 *
 * - `none`     — clamp. Frame 0 and frame N-1 are walls.
 * - `wrap`     — modulo. Frame N-1 is followed by frame 0.
 * - `pingpong` — reverse at each end, so travel bounces 0→N-1→0.
 */
export type FrameLoopMode = 'none' | 'wrap' | 'pingpong'

export interface FrameSequence {
  id: string
  frames: Frame[]
  /** Playback rate when the sequence is autoplayed or scrubbed by the clock. */
  fps: number
  loop: FrameLoopMode
  /**
   * True only when the last frame joins back to the first without a visible
   * jump — i.e. a genuine closed 360° orbit.
   *
   * This is a fact about the *asset*, not a UI preference, and it is why it
   * lives on the sequence. A camera arc that stops at 200° looks broken when
   * wrapped (the subject snaps back), so callers building a sequence from a
   * non-closing shot should set `seamless: false` and choose `pingpong`.
   */
  seamless: boolean
  /** Human label, e.g. 'Riverside penthouse — living room'. */
  label?: string
  /** width / height of a frame. Lets a viewer reserve space before load. */
  aspectRatio?: number
}

export interface CreateFrameSequenceOptions {
  id?: string
  /**
   * Frames as bare sources or partial frames. `id` and `index` are filled in,
   * so callers can pass a plain manifest: `['a.webp', 'b.webp']`.
   */
  frames: Array<string | (Omit<Partial<Frame>, 'index'> & { src: string })>
  fps?: number
  loop?: FrameLoopMode
  seamless?: boolean
  label?: string
  aspectRatio?: number
}

/** Sequences are usually short orbits; 24 reads as smooth without being film. */
const DEFAULT_FPS = 24

/**
 * Build a `FrameSequence`, normalizing frames into `{ id, index, src }`.
 *
 * `loop` defaults from `seamless`: a closed orbit wraps, an open arc bounces.
 * That default is the whole reason `seamless` exists — it stops every caller
 * from having to remember the rule.
 */
export function createFrameSequence(options: CreateFrameSequenceOptions): FrameSequence {
  const seamless = options.seamless ?? false
  const frames: Frame[] = options.frames.map((entry, index) => {
    const partial = typeof entry === 'string' ? { src: entry } : entry
    return {
      id: partial.id ?? `frame-${String(index + 1).padStart(3, '0')}`,
      index,
      src: partial.src,
      ...(partial.sources ? { sources: partial.sources } : {}),
    }
  })

  return {
    id: options.id ?? generateId(),
    frames,
    fps: options.fps ?? DEFAULT_FPS,
    loop: options.loop ?? (seamless ? 'wrap' : 'pingpong'),
    seamless,
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.aspectRatio !== undefined ? { aspectRatio: options.aspectRatio } : {}),
  }
}

/**
 * Map any integer (including negative and out-of-range) onto a valid index,
 * according to the sequence's loop mode.
 *
 * This is the single place index movement is decided — drag, scrub, keyboard,
 * and the playback clock all funnel through it, so they cannot disagree about
 * what happens at the ends.
 */
export function normalizeFrameIndex(sequence: FrameSequence, index: number): number {
  const count = sequence.frames.length
  if (count === 0) return 0
  if (count === 1) return 0

  const i = Math.round(index)
  if (!Number.isFinite(i)) return 0

  switch (sequence.loop) {
    case 'wrap': {
      // `% count` alone yields negatives in JS for negative input.
      return ((i % count) + count) % count
    }
    case 'pingpong': {
      // Travel over a period of 2*(count-1): forward then back, with the two
      // endpoints visited once each so there is no stutter at the turn.
      const period = 2 * (count - 1)
      const t = ((i % period) + period) % period
      return t < count ? t : period - t
    }
    case 'none':
    default:
      return Math.max(0, Math.min(count - 1, i))
  }
}

/** The frame at `index`, normalized first. Throws only on an empty sequence. */
export function frameAt(sequence: FrameSequence, index: number): Frame {
  const frame = sequence.frames[normalizeFrameIndex(sequence, index)]
  if (!frame) {
    throw new Error(`FrameSequence "${sequence.id}" has no frames`)
  }
  return frame
}

/** Total frames. Named for symmetry with core's `getTotalFrames`. */
export function frameCount(sequence: FrameSequence): number {
  return sequence.frames.length
}
