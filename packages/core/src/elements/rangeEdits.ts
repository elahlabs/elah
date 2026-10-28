/**
 * Range cuts (CHAT-5a): pure helpers behind the `removeRanges` op. No engine in here, so every rule is testable on
 * plain numbers; `ops/apply.ts` runs the plan these functions make inside the plan's one batch.
 *
 * Three jobs:
 *   - `planSourceRanges` turns a model's SOURCE-second ranges into a clean, sorted, merged list inside the clip's
 *     source window (or says why it cannot).
 *   - `sourceRangesToLocalFrames` / `planMemberCuts` turn that list into timeline frames and say which pieces of a
 *     clip survive and how far each moves left when the gaps close.
 *   - `planCaptionRemoval` re-times the captions linked to the clip: words inside a cut are dropped, the rest
 *     follow the picture.
 */

import type { CaptionWord, Clip } from '../types'
import { findOverlaps } from '../utils/frames'

export interface SecondsRange {
  from: number
  to: number
}

/** Ranges closer together than this are one range (a breath between two cuts is not worth keeping). */
export const RANGE_MERGE_GAP_SEC = 0.12
/** A range shorter than this, after merging and clamping, is not worth a cut. */
export const RANGE_MIN_SEC = 0.05
/** Most ranges one op may carry. */
export const MAX_REMOVE_RANGES = 200

const EPS = 1e-9

/** The source seconds a clip actually plays: from its trim start for as long as it consumes media. */
export function clipSourceWindowSec(
  clip: Pick<Clip, 'sourceStartFrame' | 'durationFrames' | 'speed'>,
  fps: number,
): SecondsRange {
  const speed = clip.speed !== undefined && clip.speed > 0 ? clip.speed : 1
  const start = Number.isFinite(clip.sourceStartFrame) ? Math.max(0, clip.sourceStartFrame) : 0
  return { from: start / fps, to: (start + Math.max(1, Math.round(clip.durationFrames * speed))) / fps }
}

export type SourceRangePlan = { ok: true; ranges: SecondsRange[] } | { ok: false; reason: string }

const sec = (n: number) => `${Math.round(n * 100) / 100}s`

/**
 * Normalise `raw` against the clip's source `window`: usable ranges are sorted, merged when closer than
 * {@link RANGE_MERGE_GAP_SEC}, clamped to the window, and dropped under {@link RANGE_MIN_SEC}.
 *
 * A range that lies wholly OUTSIDE the window refuses the whole plan: the model named media the clip does not
 * play, and cutting "what is left" would hide that. A range that only overhangs an edge is clamped.
 */
export function planSourceRanges(raw: ReadonlyArray<SecondsRange>, window: SecondsRange): SourceRangePlan {
  const usable = raw.filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from)
  if (usable.length === 0) return { ok: false, reason: 'there is no usable range to cut' }
  for (const r of usable) {
    if (r.to <= window.from + EPS || r.from >= window.to - EPS) {
      return {
        ok: false,
        reason: `the range ${sec(r.from)}–${sec(r.to)} is outside the clip's source (${sec(window.from)}–${sec(window.to)})`,
      }
    }
  }
  const sorted = usable.map((r) => ({ from: r.from, to: r.to })).sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: SecondsRange[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.from - last.to < RANGE_MERGE_GAP_SEC - EPS) last.to = Math.max(last.to, r.to)
    else merged.push({ ...r })
  }
  const clamped = merged
    .map((r) => ({ from: Math.max(r.from, window.from), to: Math.min(r.to, window.to) }))
    .filter((r) => r.to - r.from >= RANGE_MIN_SEC - EPS)
  if (clamped.length === 0) return { ok: false, reason: `every range is shorter than ${RANGE_MIN_SEC}s, so there is nothing to cut` }
  return { ok: true, ranges: clamped }
}

/**
 * Source-second ranges as CLIP-LOCAL timeline frame ranges `[a, b)`, clamped to the clip and with ranges that
 * collapse to nothing (or touch after rounding) merged or dropped. Sorted ascending.
 */
export function sourceRangesToLocalFrames(
  ranges: ReadonlyArray<SecondsRange>,
  clip: Pick<Clip, 'sourceStartFrame' | 'durationFrames' | 'speed'>,
  fps: number,
): Array<[number, number]> {
  const speed = clip.speed !== undefined && clip.speed > 0 ? clip.speed : 1
  const start = Number.isFinite(clip.sourceStartFrame) ? Math.max(0, clip.sourceStartFrame) : 0
  const toLocal = (s: number) => Math.round((s * fps - start) / speed)
  const out: Array<[number, number]> = []
  for (const r of [...ranges].sort((x, y) => x.from - y.from)) {
    const a = Math.max(0, toLocal(r.from))
    const b = Math.min(clip.durationFrames, toLocal(r.to))
    if (b - a < 1) continue
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export interface KeptPiece {
  /** Where the piece started on the timeline BEFORE any cut, frames. */
  origStart: number
  origEnd: number
  /** How far left the piece moves when the gaps close: the length of every cut before it. */
  shift: number
}

export interface MemberCutPlan {
  /** The cuts that touch this clip, absolute timeline frames, clamped to it, ascending. */
  ranges: Array<[number, number]>
  /** The pieces that survive, ascending. */
  kept: KeptPiece[]
  /** Frames removed from this clip in all. */
  removed: number
}

/**
 * What `removeRanges` does to ONE clip spanning `[start, end)`: the cuts (absolute timeline frames) clamped to it,
 * the pieces left, and each piece's ripple shift. A clip the cuts do not touch has no ranges and one whole piece.
 */
export function planMemberCuts(start: number, end: number, cuts: ReadonlyArray<[number, number]>): MemberCutPlan {
  const ranges: Array<[number, number]> = []
  for (const [a, b] of [...cuts].sort((x, y) => x[0] - y[0])) {
    const lo = Math.max(a, start)
    const hi = Math.min(b, end)
    if (hi - lo < 1) continue
    const last = ranges[ranges.length - 1]
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi)
    else ranges.push([lo, hi])
  }
  const kept: KeptPiece[] = []
  let cursor = start
  let removedSoFar = 0
  for (const [a, b] of ranges) {
    if (a > cursor) kept.push({ origStart: cursor, origEnd: a, shift: removedSoFar })
    removedSoFar += b - a
    cursor = b
  }
  if (cursor < end) kept.push({ origStart: cursor, origEnd: end, shift: removedSoFar })
  return { ranges, kept, removed: removedSoFar }
}

/** `frame` after the (ascending, non-overlapping) `removed` ranges close up; a frame inside a cut lands where the cut began. */
export function collapseFrame(frame: number, removed: ReadonlyArray<[number, number]>): number {
  let out = frame
  for (const [a, b] of removed) {
    if (frame >= b) out -= b - a
    else if (frame > a) out -= frame - a
  }
  return out
}

/** How many of `removed` end at or before `frame`: the index of the surviving stretch that `frame` starts. */
export function segmentIndex(frame: number, removed: ReadonlyArray<[number, number]>): number {
  return removed.filter(([, b]) => b <= frame).length
}

export interface CaptionLike {
  id: string
  trackId: string
  startFrame: number
  durationFrames: number
  words: ReadonlyArray<CaptionWord>
}

export interface CaptionRemovalPatch {
  clipId: string
  trackId: string
  startFrame: number
  durationFrames: number
  words: CaptionWord[]
  /** The caption's text after the cut: its surviving words joined. */
  content: string
}

export interface CaptionRemovalPlan {
  patches: CaptionRemovalPatch[]
  /** Captions with no word left. */
  removals: string[]
  /** Captions that could not move without landing on a neighbour, left exactly as they were. */
  skipped: string[]
}

/**
 * Re-time `captions` (clip-local `words`) for cuts at absolute frames `removed`.
 *
 * A word whose centre lies inside a cut is dropped. With `ripple` the rest follow the picture left; without it they
 * stay put. A caption's new span is the hull of its surviving words (as captions are built). A caption with no
 * word left is removed. A caption that would overlap a neighbour on its own track is left unchanged and reported
 * in `skipped`, because writing it would make the engine refuse the whole batch.
 */
export function planCaptionRemoval(
  captions: ReadonlyArray<CaptionLike>,
  removed: ReadonlyArray<[number, number]>,
  ripple: boolean,
  trackClips: (trackId: string) => ReadonlyArray<Clip>,
): CaptionRemovalPlan {
  const patches: CaptionRemovalPatch[] = []
  const removals: string[] = []
  const skipped: string[] = []
  const inside = (t: number) => removed.some(([a, b]) => t >= a && t < b)
  const map = (t: number) => (ripple ? collapseFrame(t, removed) : t)
  const moved = new Map<string, { startFrame: number; durationFrames: number }>()
  const gone = new Set<string>()

  for (const cap of [...captions].sort((a, b) => a.startFrame - b.startFrame)) {
    const kept: CaptionWord[] = []
    let first = Infinity
    for (const w of cap.words) {
      const s = cap.startFrame + w.start
      const e = cap.startFrame + w.end
      if (inside((s + e) / 2)) continue
      const ns = map(s)
      kept.push({ text: w.text, start: ns, end: Math.max(ns + 1, map(e)) })
      first = Math.min(first, ns)
    }
    if (kept.length === 0) {
      removals.push(cap.id)
      gone.add(cap.id)
      continue
    }
    const last = Math.max(...kept.map((w) => w.end))
    const startFrame = first
    const durationFrames = Math.max(1, last - first)
    const words = kept.map((w) => ({ text: w.text, start: w.start - startFrame, end: Math.min(durationFrames, w.end - startFrame) }))
    const others = trackClips(cap.trackId)
      .filter((c) => !gone.has(c.id))
      .map((c) => (moved.has(c.id) ? { ...c, ...moved.get(c.id)! } : c))
    if (findOverlaps(others as Clip[], { startFrame, durationFrames }, cap.id).length > 0) {
      skipped.push(cap.id)
      continue
    }
    moved.set(cap.id, { startFrame, durationFrames })
    patches.push({
      clipId: cap.id,
      trackId: cap.trackId,
      startFrame,
      durationFrames,
      words,
      content: kept.map((w) => w.text).join(' '),
    })
  }
  return { patches, removals, skipped }
}
