/**
 * Word timings for captions (EDX-P8).
 *
 * Until the host application supplies speech-to-text, captions are
 * timed from a script per LINE. This spreads a line's duration over its
 * words in proportion to their length — the usual stand-in, and close to how
 * people speak: longer words take longer. When real per-word timestamps
 * arrive they replace these and nothing downstream changes.
 */

import { staggerOffsets } from './stagger'
import type { CaptionMode, CaptionWord, Clip, TextAnimator, TextAnimatorPreset, TextAnimatorUnit, Transform } from '../types'
import { createClip } from './base'
import { applyTextTemplate, findTextTemplate } from './textTemplates'

/** Frames of pause credited to each word boundary, relative to one character. */
const GAP_WEIGHT = 1.5

/**
 * Word timings for `text` spread over `durationFrames`, clip-local and
 * contiguous, the last ending at `durationFrames`. Each word gets at least one
 * frame while there are frames to go round.
 */
export function estimateWordTimings(text: string, durationFrames: number): CaptionWord[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const total = Math.max(1, Math.round(durationFrames))
  if (words.length === 0) return []
  const weights = words.map((w) => w.length + GAP_WEIGHT)
  const sum = weights.reduce((a, b) => a + b, 0)
  const out: CaptionWord[] = []
  let acc = 0
  let prevEnd = 0
  words.forEach((word, i) => {
    acc += weights[i]!
    const remaining = words.length - i - 1
    const ideal = i === words.length - 1 ? total : Math.round((acc / sum) * total)
    // Keep one frame for every word still to come and at least one for this
    // one; when there are more words than frames, squeezed words get none.
    const end = Math.max(prevEnd, Math.min(total - remaining, Math.max(prevEnd + 1, ideal)))
    out.push({ text: word, start: prevEnd, end })
    prevEnd = end
  })
  return out
}

/** Ready-made animators the Inspector and templates offer. */
export const TEXT_ANIMATOR_PRESETS: ReadonlyArray<{ id: string; label: string; animator: TextAnimator }> = [
  { id: 'typewriter', label: 'Typewriter', animator: { unit: 'char', preset: 'typewriter', staggerFrames: 2, durationFrames: 1 } },
  { id: 'word-rise', label: 'Words rise', animator: { unit: 'word', preset: 'rise', staggerFrames: 4, durationFrames: 10 } },
  { id: 'word-pop', label: 'Words pop', animator: { unit: 'word', preset: 'pop', staggerFrames: 5, durationFrames: 8 } },
  { id: 'char-fade', label: 'Letters fade', animator: { unit: 'char', preset: 'fade', staggerFrames: 1, durationFrames: 8 } },
  { id: 'line-rise', label: 'Lines rise', animator: { unit: 'line', preset: 'rise', staggerFrames: 8, durationFrames: 12 } },
  { id: 'char-pop', label: 'Letters pop', animator: { unit: 'char', preset: 'pop', staggerFrames: 2, durationFrames: 8 } },
  { id: 'char-rise', label: 'Letters rise', animator: { unit: 'char', preset: 'rise', staggerFrames: 1, durationFrames: 10 } },
  { id: 'word-fade', label: 'Words fade', animator: { unit: 'word', preset: 'fade', staggerFrames: 4, durationFrames: 8 } },
  { id: 'line-pop', label: 'Lines pop', animator: { unit: 'line', preset: 'pop', staggerFrames: 10, durationFrames: 10 } },
]

/**
 * MOT-3: ready-made per-unit tweens. Kept apart from `TEXT_ANIMATOR_PRESETS` on purpose: that list is the
 * vocabulary the agent and `addText.reveal` accept, and these are Inspector starting points only. Each stores
 * `preset: 'fade'` as the fallback an older build reads.
 */
export const TEXT_ANIMATOR_TWEEN_PRESETS: ReadonlyArray<{ id: string; label: string; animator: TextAnimator }> = [
  {
    id: 'word-tumble',
    label: 'Words tumble in',
    animator: { unit: 'word', preset: 'fade', staggerFrames: 3, durationFrames: 14, ease: 'back-out', tween: { opacity: [0, 1], dy: [0.6, 0], rotation: [-0.35, 0] } },
  },
  {
    id: 'char-focus',
    label: 'Letters focus in',
    animator: { unit: 'char', preset: 'fade', staggerFrames: 1, durationFrames: 12, from: 'center', ease: 'quad-out', tween: { opacity: [0, 1], blur: [8, 0], scale: [1.4, 1] } },
  },
  {
    id: 'word-slide',
    label: 'Words slide in',
    animator: { unit: 'word', preset: 'fade', staggerFrames: 4, durationFrames: 12, ease: 'expo-out', tween: { opacity: [0, 1], dx: [-0.8, 0] } },
  },
]

export const TEXT_ANIMATOR_UNITS: ReadonlyArray<TextAnimatorUnit> = ['char', 'word', 'line']
export const TEXT_ANIMATOR_KINDS: ReadonlyArray<TextAnimatorPreset> = ['typewriter', 'fade', 'rise', 'pop']

/**
 * Frames until the last unit of `text` has fully arrived — so a caller can
 * warn when an animator outlasts its clip.
 */
export function animatorLengthFrames(text: string, animator: TextAnimator): number {
  const units =
    animator.unit === 'line'
      ? text.split('\n').filter((l) => l.trim()).length
      : animator.unit === 'word'
        ? text.split(/\s+/).filter(Boolean).length
        : Array.from(text).filter((c) => !/\s/.test(c)).length
  // MOT-3: a non-default order or stagger ease moves the last unit's start; absent, the legacy sum stands exactly.
  if (animator.from || animator.staggerEase) {
    const offsets = staggerOffsets(units, { each: Math.max(0, animator.staggerFrames), from: animator.from, ease: animator.staggerEase })
    return Math.max(0, ...offsets) + animator.durationFrames
  }
  return Math.max(0, units - 1) * animator.staggerFrames + animator.durationFrames
}

// ---------------------------------------------------------------------------
// Caption looks (AGN-P20)
// ---------------------------------------------------------------------------

/**
 * A caption look is a NAME for a combination of three things that already
 * exist: a text template (style + entry/exit motion), a reveal animator
 * (`TEXT_ANIMATOR_PRESETS`) and a caption mode. It carries no motion of its own,
 * so a look cannot render differently from the same three choices made by hand,
 * and the planner (which is offered the templates and reveals directly) can
 * reproduce any look without a vocabulary of its own.
 */
export interface CaptionLook {
  id: string
  /** Card caption. One line. */
  label: string
  /** An id from `BUILT_IN_TEXT_TEMPLATES`. */
  templateId: string
  /** An id from `TEXT_ANIMATOR_PRESETS`; omit for no reveal animator. */
  revealId?: string
  mode: CaptionMode
  /** Colour for spoken words in 'karaoke' and 'highlight' modes. */
  highlight?: string
}

export const CAPTION_LOOKS: ReadonlyArray<CaptionLook> = [
  { id: 'outline-pop', label: 'Outline Pop', templateId: 'caption-outline', revealId: 'word-pop', mode: 'static' },
  { id: 'karaoke-fill', label: 'Karaoke Fill', templateId: 'caption-outline', mode: 'karaoke', highlight: '#ffd400' },
  { id: 'spoken-word', label: 'Spoken Word', templateId: 'caption-social', mode: 'highlight', highlight: '#ff4d6d' },
  { id: 'stacked-lines', label: 'Stacked Lines', templateId: 'caption-social', revealId: 'line-pop', mode: 'static' },
  { id: 'letter-reveal', label: 'Letter Reveal', templateId: 'caption-editorial', revealId: 'char-rise', mode: 'static' },
  { id: 'editorial-line', label: 'Editorial Line', templateId: 'caption-editorial', revealId: 'word-fade', mode: 'static' },
  { id: 'social-heavy', label: 'Social Heavy', templateId: 'caption-social', mode: 'reveal' },
  { id: 'typed-out', label: 'Typed Out', templateId: 'caption-quiet', revealId: 'typewriter', mode: 'static' },
  { id: 'quiet-line', label: 'Quiet Line', templateId: 'caption-quiet', mode: 'static' },
]

/** The phrase and length every look is judged against: a two-line, four-word caption two seconds long at 30fps. */
export const CAPTION_LOOK_SAMPLE = { text: 'Make every\nsecond count', durationFrames: 60 } as const

export function findCaptionLook(id: string): CaptionLook | undefined {
  return CAPTION_LOOKS.find((l) => l.id === id)
}

/** The reveal animator a look uses, or undefined for none (or an unknown id). */
export function captionLookAnimator(look: CaptionLook): TextAnimator | undefined {
  return look.revealId ? TEXT_ANIMATOR_PRESETS.find((p) => p.id === look.revealId)?.animator : undefined
}

/**
 * True when the look's reveal has not finished by the end of a caption of
 * `durationFrames` showing `text` - the last words would never fully arrive.
 */
export function captionLookOutlasts(look: CaptionLook, text: string, durationFrames: number): boolean {
  const animator = captionLookAnimator(look)
  return animator ? animatorLengthFrames(text, animator) > durationFrames : false
}

/**
 * The patch that puts `look` on the text clip `clip`: its template, then its
 * reveal and mode. Switching looks is clean (no reveal or mode left behind);
 * existing `words` are kept, since they may be real transcript timings, and
 * estimated when a timed mode needs them and there are none.
 */
export function captionLookPatch(look: CaptionLook, clip: Clip): Partial<Clip> {
  const template = findTextTemplate(look.templateId)
  const patch: Partial<Clip> = template ? applyTextTemplate(template, clip) : {}
  patch.textAnimator = captionLookAnimator(look)
  patch.captionMode = look.mode === 'static' ? undefined : look.mode
  patch.captionHighlight = look.mode === 'karaoke' || look.mode === 'highlight' ? look.highlight : undefined
  if (look.mode !== 'static' && !(clip.words && clip.words.length > 0)) {
    const words = estimateWordTimings(clip.content ?? '', clip.durationFrames)
    if (words.length) patch.words = words
  }
  return patch
}

// ---------------------------------------------------------------------------
// Frame-accurate captions from a timed transcript (PV-P10c-1)
// ---------------------------------------------------------------------------

/**
 * One spoken word as a speech transcript reports it: real-world seconds,
 * relative to whatever source timeline segment was selected for
 * transcription — not yet frames, not yet clip-local. Contrast `CaptionWord`,
 * which is always clip-local frames.
 */
export interface TranscriptWord {
  text: string
  startSeconds: number
  endSeconds: number
}

/** Words per caption before a group splits, absent an explicit `maxWords`. */
const CAPTION_BUILD_DEFAULT_MAX_WORDS = 6
/** Gap between words, in seconds, past which a group splits, absent an explicit `maxGapSeconds`. */
const CAPTION_BUILD_DEFAULT_MAX_GAP_SECONDS = 0.6

/**
 * Normalised y a bottom caption sits at. Same value as `REGION_XY.bottom` in
 * `ops/apply.ts` (that table is module-private and the ops layer is owned by
 * another lane, so the number is restated here; keep the two in step).
 */
export const CAPTION_BOTTOM_Y = 0.86

/** Where new captions land: near the bottom of the frame (default) or dead centre. */
export type CaptionPosition = 'bottom' | 'centre'

export interface CaptionBuildOptions {
  /** Frames per second the timeline runs at. Must be finite and positive. */
  fps: number
  /** The track the built clips are stamped for. */
  trackId: string
  /** Timeline frame the first caption starts at, added to its first word's quantized start frame. Default 0. */
  startFrame?: number
  /** Words per caption before a group splits. Default 6. Must be at least 1. */
  maxWords?: number
  /** Gap between words, in seconds, past which a group splits. Default 0.6. */
  maxGapSeconds?: number
  /** How the built clips present their words. Default 'static' (no `captionMode` stored, matching `captionModePatch`). */
  mode?: CaptionMode
  /** Where the built clips sit in the frame. Default 'bottom'. */
  position?: CaptionPosition
}

/** Half-open `[start, end)` timeline frames a caption group spans, before adjacent groups are reconciled. */
interface QuantizedGroup {
  start: number
  end: number
  words: ReadonlyArray<TranscriptWord>
}

/**
 * Validate `words` are non-empty text, non-negative, non-reversed and
 * non-overlapping, in the order given. Throws rather than sorting a broken
 * transcript, per the design: silently reordering hides a real defect in
 * whatever produced the transcript.
 */
function validateTranscriptWords(words: ReadonlyArray<TranscriptWord>): void {
  let prevEnd = -Infinity
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (w.text.trim().length === 0) {
      throw new Error(`captionClipsFromTranscript: word ${i} is empty or all whitespace`)
    }
    if (!Number.isFinite(w.startSeconds) || !Number.isFinite(w.endSeconds)) {
      throw new Error(`captionClipsFromTranscript: word ${i} ("${w.text}") has a non-finite time`)
    }
    if (w.startSeconds < 0) {
      throw new Error(`captionClipsFromTranscript: word ${i} ("${w.text}") has a negative start`)
    }
    if (w.endSeconds <= w.startSeconds) {
      throw new Error(`captionClipsFromTranscript: word ${i} ("${w.text}") has a reversed or zero-length span`)
    }
    if (w.startSeconds < prevEnd) {
      throw new Error(
        `captionClipsFromTranscript: word ${i} ("${w.text}") overlaps or precedes word ${i - 1} — the transcript must be monotonic`,
      )
    }
    prevEnd = w.endSeconds
  }
}

/** `floor`/`ceil` quantization of one word's seconds to timeline frames, `end` at least `start + 1`. */
function quantizeWord(w: TranscriptWord, fps: number): { start: number; end: number } {
  const start = Math.floor(w.startSeconds * fps)
  const end = Math.max(start + 1, Math.ceil(w.endSeconds * fps))
  return { start, end }
}

/** Split `words` into caption groups on `maxWords`, a gap past `maxGapSeconds`, or trailing sentence punctuation. */
function groupTranscriptWords(
  words: ReadonlyArray<TranscriptWord>,
  maxWords: number,
  maxGapSeconds: number,
): TranscriptWord[][] {
  const groups: TranscriptWord[][] = []
  let current: TranscriptWord[] = []
  for (const w of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1]!
      const splitBefore =
        current.length >= maxWords || w.startSeconds - prev.endSeconds > maxGapSeconds || /[.!?]$/.test(prev.text)
      if (splitBefore) {
        groups.push(current)
        current = []
      }
    }
    current.push(w)
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Frame-accurate caption clips from a timed transcript (PV-P10c-1).
 *
 * Pure aside from the id `createClip` mints for each clip: no engine, no
 * network, no clock. Validates and quantizes `words` (real-world seconds,
 * `endSeconds` exclusive) into groups of clip-local `CaptionWord`s, each
 * group becoming one text clip built through the existing `createClip`
 * factory and carrying the existing `words`/`captionMode` fields the
 * karaoke/highlight/reveal styles already read — no new text renderer.
 *
 * Throws on an invalid transcript (see `validateTranscriptWords`) or when a
 * caption group would end up zero frames long after adjacent groups are
 * reconciled, rather than silently dropping its text.
 */
export function captionClipsFromTranscript(words: ReadonlyArray<TranscriptWord>, opts: CaptionBuildOptions): Clip[] {
  if (!Number.isFinite(opts.fps) || opts.fps <= 0) {
    throw new Error('captionClipsFromTranscript: fps must be a finite, positive number')
  }
  const maxWords = opts.maxWords ?? CAPTION_BUILD_DEFAULT_MAX_WORDS
  if (!Number.isFinite(maxWords) || maxWords < 1) {
    throw new Error('captionClipsFromTranscript: maxWords must be at least 1')
  }
  if (words.length === 0) return []

  validateTranscriptWords(words)

  const fps = opts.fps
  const maxGapSeconds = opts.maxGapSeconds ?? CAPTION_BUILD_DEFAULT_MAX_GAP_SECONDS
  const startFrameOffset = opts.startFrame ?? 0
  const mode = opts.mode ?? 'static'
  const transform: Transform = {
    x: 0.5,
    y: (opts.position ?? 'bottom') === 'centre' ? 0.5 : CAPTION_BOTTOM_Y,
    scale: 1,
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
  }

  const groups = groupTranscriptWords(words, Math.floor(maxWords), maxGapSeconds)

  // Each group's own quantized span, independent of its neighbours.
  const spans: QuantizedGroup[] = groups.map((g) => {
    const first = quantizeWord(g[0]!, fps)
    const last = quantizeWord(g[g.length - 1]!, fps)
    return { start: first.start, end: Math.max(first.start + 1, last.end), words: g }
  })

  // Floor/ceil quantization can leave one group's end past the next group's
  // start (a fractional boundary rounded up on one side and down on the
  // other); the shared instant is the next group's start, never an overlap.
  for (let i = 0; i < spans.length - 1; i++) {
    if (spans[i]!.end > spans[i + 1]!.start) spans[i]!.end = spans[i + 1]!.start
  }

  // A boundary shared away to nothing is a real defect to surface, not a
  // caption to lose silently.
  for (const s of spans) {
    if (s.end <= s.start) {
      const text = s.words.map((w) => w.text).join(' ')
      throw new Error(
        `captionClipsFromTranscript: caption group "${text}" has zero length after quantization — widen maxGapSeconds or check the transcript`,
      )
    }
  }

  return spans.map((s) => {
    const durationFrames = s.end - s.start
    const localWords: CaptionWord[] = s.words.map((w) => {
      const q = quantizeWord(w, fps)
      const rawStart = q.start - s.start
      const rawEnd = q.end - s.start
      const start = Math.max(0, Math.min(durationFrames - 1, rawStart))
      const end = Math.max(start + 1, Math.min(durationFrames, rawEnd))
      return { text: w.text, start, end }
    })
    const content = s.words.map((w) => w.text).join(' ')
    const clip = createClip({
      trackId: opts.trackId,
      type: 'text',
      name: content.slice(0, 40),
      startFrame: startFrameOffset + s.start,
      durationFrames,
      text: { content },
    })
    return {
      ...clip,
      words: localWords,
      transform,
      ...(mode !== 'static' ? { captionMode: mode } : {}),
    }
  })
}

/**
 * Clip-local `CaptionWord`s spreading `text` evenly over `durationFrames`,
 * for explicitly approximate timings (no transcript at all): word `i` of `n`
 * spans `[floor(i * duration / n), floor((i + 1) * duration / n))`, the last
 * word instead ending exactly at `duration`. `durationFrames` must be at
 * least the word count, or no allocation could give every word a frame.
 *
 * Contrast `estimateWordTimings`, unchanged by this ticket, which weights by
 * character length rather than splitting evenly.
 */
export function distributeWordsEvenly(text: string, durationFrames: number): CaptionWord[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const n = words.length
  if (n === 0) return []
  const duration = Math.round(durationFrames)
  if (duration < n) {
    throw new Error(`distributeWordsEvenly: ${n} words need at least ${n} frames of duration, got ${duration}`)
  }
  const out: CaptionWord[] = []
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * duration) / n)
    const end = i === n - 1 ? duration : Math.floor(((i + 1) * duration) / n)
    out.push({ text: words[i]!, start, end })
  }
  return out
}
