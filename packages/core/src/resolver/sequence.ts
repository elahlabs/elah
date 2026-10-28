/**
 * Pure sequence clip helpers (PV-P8): the frame-index rule preview and export
 * share, and the URL/identity helpers built on top of it. No DOM, no state —
 * every function here is a plain expression of its inputs.
 */

import type { Clip, ClipSequence, SequenceKind } from '../types'

/** True when a stored sequence clip can be drawn. */
export function isDrawableSequence(clip: Pick<Clip, 'type' | 'src' | 'sequence'>): boolean {
  if (clip.type !== 'sequence') return false
  const seq = clip.sequence
  if (!seq) return false
  if (!Number.isInteger(seq.frameCount) || seq.frameCount < 1) return false
  if (!Number.isFinite(seq.fps) || seq.fps <= 0) return false
  if (seq.kind === 'animated-image') return typeof clip.src === 'string' && clip.src.length > 0
  if (seq.kind === 'frames') {
    return typeof seq.frameUrlTemplate === 'string' && /\{frame(:[1-9])?\}/.test(seq.frameUrlTemplate)
  }
  return false
}

/**
 * 0-based sequence frame for a clip-source frame (project frames, as
 * `sourceFrameFor` returns).
 *
 * `raw` converts the source frame — a count in the PROJECT's fps — into the
 * sequence's own fps, then floors it (a tiny epsilon guards a value that
 * lands a hair under an integer because of floating point). `loop` wraps
 * modulo `frameCount` (double-mod so a negative raw value still lands
 * in-range); without it the index holds at the last frame.
 */
export function sequenceFrameIndex(
  seq: Pick<ClipSequence, 'frameCount' | 'fps' | 'loop'>,
  sourceFrame: number,
  projectFps: number,
): number {
  const n = seq.frameCount
  if (!(n >= 1) || !(projectFps > 0)) return 0
  const raw = Math.floor((sourceFrame * seq.fps) / projectFps + 1e-6)
  return seq.loop ? ((raw % n) + n) % n : Math.min(n - 1, Math.max(0, raw))
}

const FRAME_PLACEHOLDER = /\{frame(?::([1-9]))?\}/g

/**
 * URL of sequence frame `index` (0-based): `{frame}` -> `String(index +
 * startNumber)`, `{frame:N}` -> zero-padded to N digits (never truncated,
 * even past N digits). Every placeholder in the template is replaced.
 */
export function sequenceFrameUrl(template: string, index: number, startNumber = 0): string {
  const n = index + startNumber
  return template.replace(FRAME_PLACEHOLDER, (_match, pad?: string) => (pad ? String(n).padStart(Number(pad), '0') : String(n)))
}

/**
 * Identity of the pixels a sequence item shows; a layer/export cache reopens
 * its source when this changes.
 */
export function sequenceSourceKey(item: {
  kind: SequenceKind
  src?: string
  frameUrlTemplate?: string
  startNumber?: number
}): string {
  return item.kind === 'animated-image' ? `a:${item.src ?? ''}` : `f:${item.frameUrlTemplate ?? ''}#${item.startNumber ?? 0}`
}
