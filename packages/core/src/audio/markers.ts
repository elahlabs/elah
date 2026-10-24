/**
 * Audio marker summaries (PV-P10b): the compact per-source `AudioMarkerSet`
 * written by beat detection, and pure helpers that map one onto every clip on
 * the timeline that plays that source. Everything here is pure and DOM-free.
 */

import type { AudioMarkerSet, Clip, Project } from '../types'
import type { AudioAnalysis } from './analysis'

/** 20 minutes at 30 fps, 10 at 60 — the longest source whose envelopes are kept. */
export const MAX_ENVELOPE_FRAMES = 36_000

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Bytes `round(clamp01(v) × 255)`, base64 (`btoa` over `String.fromCharCode` in 8192-byte chunks). */
export function encodeEnvelope(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    bytes[i] = Math.round(clamp(values[i], 0, 1) * 255)
  }
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Inverse of {@link encodeEnvelope}; anything `atob` rejects → an empty `Uint8Array`. */
export function decodeEnvelope(encoded: string): Uint8Array {
  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    return new Uint8Array(0)
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * The document summary of one analysis. Envelopes are included unless
 * `envelopes: false` was requested or the source is longer than
 * {@link MAX_ENVELOPE_FRAMES}.
 */
export function summarizeAnalysis(
  analysis: AudioAnalysis,
  src: string,
  opts?: { envelopes?: boolean },
): AudioMarkerSet {
  const set: AudioMarkerSet = {
    src,
    fps: analysis.fps,
    version: analysis.version,
    beats: analysis.beats,
    silences: analysis.silences,
  }
  if (analysis.bpm !== undefined) set.bpm = analysis.bpm

  const wantEnvelopes = opts?.envelopes !== false
  if (wantEnvelopes && analysis.durationFrames <= MAX_ENVELOPE_FRAMES) {
    set.envelopes = {
      level: encodeEnvelope(analysis.loudness),
      low: encodeEnvelope(analysis.bands.low),
      mid: encodeEnvelope(analysis.bands.mid),
      high: encodeEnvelope(analysis.bands.high),
    }
  }
  return set
}

/** The set for the clip's `src` whose fps equals the project's; `undefined` otherwise. */
export function markerSetForClip(
  project: Pick<Project, 'fps' | 'audioMarkers'>,
  clip: Pick<Clip, 'src'>,
): AudioMarkerSet | undefined {
  if (!clip.src) return undefined
  return project.audioMarkers?.find((set) => set.src === clip.src && set.fps === project.fps)
}

/** Timeline frame where source frame `sourceFrame` of the clip plays, or `null` outside the clip. */
export function sourceToTimelineFrame(
  clip: Pick<Clip, 'startFrame' | 'durationFrames' | 'sourceStartFrame' | 'speed'>,
  sourceFrame: number,
): number | null {
  const r = Math.round((sourceFrame - clip.sourceStartFrame) / (clip.speed ?? 1))
  if (r < 0 || r >= clip.durationFrames) return null
  return clip.startFrame + r
}

/** Timeline frames of the clip's beats inside the clip, ascending. `[]` when the clip has no set. */
export function clipBeatFrames(project: Pick<Project, 'fps' | 'audioMarkers'>, clip: Clip): number[] {
  const set = markerSetForClip(project, clip)
  if (!set) return []
  const out: number[] = []
  for (const sourceFrame of set.beats) {
    const t = sourceToTimelineFrame(clip, sourceFrame)
    if (t !== null) out.push(t)
  }
  return out.sort((a, b) => a - b)
}

/** Timeline `[start, end)` of the clip's silences, clipped to the clip, ascending. */
export function clipSilenceRanges(
  project: Pick<Project, 'fps' | 'audioMarkers'>,
  clip: Clip,
): Array<[number, number]> {
  const set = markerSetForClip(project, clip)
  if (!set) return []
  const speed = clip.speed ?? 1
  const out: Array<[number, number]> = []
  for (const [s, e] of set.silences) {
    const a = clamp(Math.round((s - clip.sourceStartFrame) / speed), 0, clip.durationFrames)
    const b = clamp(Math.round((e - clip.sourceStartFrame) / speed), 0, clip.durationFrames)
    if (b > a) out.push([clip.startFrame + a, clip.startFrame + b])
  }
  return out
}

/**
 * Union of {@link clipBeatFrames} over audio clips (not disabled) on audio
 * tracks that are not disabled (a muted track still contributes), sorted
 * unique. `opts.clipId` limits it to one clip.
 */
export function beatFramesOnTimeline(
  project: Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'>,
  opts?: { clipId?: string },
): number[] {
  const out = new Set<number>()
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.disabled) continue
    const clips = project.clips[track.id] ?? []
    for (const clip of clips) {
      if (clip.disabled) continue
      if (opts?.clipId && clip.id !== opts.clipId) continue
      for (const f of clipBeatFrames(project, clip)) out.add(f)
    }
  }
  return Array.from(out).sort((a, b) => a - b)
}

/** {@link beatFramesOnTimeline} beats inside `target`'s span, as frames local to `target`. */
export function localBeatsInClip(
  project: Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'>,
  target: Clip,
  opts?: { audioClipId?: string },
): number[] {
  const beats = beatFramesOnTimeline(project, opts?.audioClipId ? { clipId: opts.audioClipId } : undefined)
  const out: number[] = []
  for (const f of beats) {
    if (f >= target.startFrame && f < target.startFrame + target.durationFrames) {
      out.push(f - target.startFrame)
    }
  }
  return out
}

/**
 * The analysed audio clip overlapping `target` the most (ties: lower track
 * order, then earlier start); `undefined` when none overlaps.
 */
export function defaultAudioSourceFor(
  project: Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'>,
  target: Clip,
): Clip | undefined {
  const orderByTrackId = new Map(project.tracks.map((t) => [t.id, t.order] as const))

  let best: Clip | undefined
  let bestOverlap = 0
  let bestOrder = Infinity
  let bestStart = Infinity

  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue
    const clips = project.clips[track.id] ?? []
    for (const clip of clips) {
      if (!markerSetForClip(project, clip)) continue
      const overlapStart = Math.max(clip.startFrame, target.startFrame)
      const overlapEnd = Math.min(clip.startFrame + clip.durationFrames, target.startFrame + target.durationFrames)
      const overlap = overlapEnd - overlapStart
      if (overlap <= 0) continue
      const order = orderByTrackId.get(clip.trackId) ?? Infinity
      const better =
        overlap > bestOverlap ||
        (overlap === bestOverlap && order < bestOrder) ||
        (overlap === bestOverlap && order === bestOrder && clip.startFrame < bestStart)
      if (better) {
        best = clip
        bestOverlap = overlap
        bestOrder = order
        bestStart = clip.startFrame
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// `audio.*` in expressions (PV-P10b-3)
// ---------------------------------------------------------------------------

/** The names `audio("<name>")` accepts in an expression. */
export const AUDIO_EXPR_NAMES = ['beat', 'sinceBeat', 'beatIndex', 'bpm', 'silent', 'level', 'low', 'mid', 'high'] as const
export type AudioExprName = (typeof AUDIO_EXPR_NAMES)[number]

interface AudioIndexClip {
  startFrame: number
  durationFrames: number
  sourceStartFrame: number
  speed: number
  order: number
  /** Ascending timeline frames. */
  beats: number[]
  /** Ascending timeline `[start, end)`. */
  silences: Array<[number, number]>
  bpm?: number
  envelopes?: { level: Uint8Array; low: Uint8Array; mid: Uint8Array; high: Uint8Array }
}

interface AudioIndex {
  /** Union of every analysed clip's beats (= `beatFramesOnTimeline`), ascending. */
  beats: number[]
  /** Analysed audio clips on non-disabled audio tracks, by track order then start. */
  clips: AudioIndexClip[]
}

/**
 * One index per `(project.clips, project.audioMarkers, project.fps)`, keyed
 * by `project.clips` — stable across frames in preview and for a whole
 * export, unlike `project` itself, which is a new object after every
 * unrelated edit (e.g. moving the playhead touches nothing here, but a marker
 * edit elsewhere still produces a new `Project`).
 */
const audioIndexCache = new WeakMap<object, { audioMarkers: AudioMarkerSet[] | undefined; fps: number; index: AudioIndex }>()

function buildAudioIndex(project: Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'>): AudioIndex {
  const orderByTrackId = new Map(project.tracks.map((t) => [t.id, t.order] as const))
  const clips: AudioIndexClip[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.disabled) continue
    for (const clip of project.clips[track.id] ?? []) {
      if (clip.disabled) continue
      const set = markerSetForClip(project, clip)
      if (!set) continue
      const envelopes = set.envelopes
        ? {
            level: decodeEnvelope(set.envelopes.level),
            low: decodeEnvelope(set.envelopes.low),
            mid: decodeEnvelope(set.envelopes.mid),
            high: decodeEnvelope(set.envelopes.high),
          }
        : undefined
      clips.push({
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
        sourceStartFrame: clip.sourceStartFrame,
        speed: clip.speed ?? 1,
        order: orderByTrackId.get(clip.trackId) ?? Infinity,
        beats: clipBeatFrames(project, clip),
        silences: clipSilenceRanges(project, clip),
        ...(set.bpm !== undefined ? { bpm: set.bpm } : {}),
        ...(envelopes ? { envelopes } : {}),
      })
    }
  }
  clips.sort((a, b) => a.order - b.order || a.startFrame - b.startFrame)
  return { beats: beatFramesOnTimeline(project), clips }
}

function audioIndexFor(project: Pick<Project, 'fps' | 'audioMarkers' | 'tracks' | 'clips'>): AudioIndex {
  const key = project.clips as object
  const cached = audioIndexCache.get(key)
  if (cached && cached.audioMarkers === project.audioMarkers && cached.fps === project.fps) return cached.index
  const index = buildAudioIndex(project)
  audioIndexCache.set(key, { audioMarkers: project.audioMarkers, fps: project.fps, index })
  return index
}

/** The index of the greatest beat `<= frame`, or -1 when `frame` is before the first beat. */
function lastBeatIndexAt(beats: ReadonlyArray<number>, frame: number): number {
  let lo = 0
  let hi = beats.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= frame) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

const ENVELOPE_NAMES: ReadonlyArray<'level' | 'low' | 'mid' | 'high'> = ['level', 'low', 'mid', 'high']

/**
 * Value of `audio.<name>` at absolute `frame`; `undefined` for an unknown
 * name or a project without `audioMarkers`.
 */
export function audioValueAt(project: Project, frame: number, name: string): number | undefined {
  if (!(AUDIO_EXPR_NAMES as ReadonlyArray<string>).includes(name)) return undefined
  if (!project.audioMarkers?.length) return undefined
  const fps = project.fps > 0 ? project.fps : 30
  const idx = audioIndexFor(project)

  switch (name as AudioExprName) {
    case 'beat': {
      const i = lastBeatIndexAt(idx.beats, frame)
      if (i === -1) return 0
      const pulse = Math.max(1, Math.round(0.2 * fps))
      return Math.max(0, 1 - (frame - idx.beats[i]!) / pulse)
    }
    case 'sinceBeat': {
      const i = lastBeatIndexAt(idx.beats, frame)
      if (i === -1) return -1
      return (frame - idx.beats[i]!) / fps
    }
    case 'beatIndex':
      return lastBeatIndexAt(idx.beats, frame)
    case 'bpm': {
      const withBpm = idx.clips.find((c) => c.bpm !== undefined)
      return withBpm?.bpm ?? 0
    }
    case 'silent': {
      const active = idx.clips.filter((c) => frame >= c.startFrame && frame < c.startFrame + c.durationFrames)
      if (active.length === 0) return 1
      return active.every((c) => c.silences.some(([s, e]) => frame >= s && frame < e)) ? 1 : 0
    }
    default: {
      if (!(ENVELOPE_NAMES as ReadonlyArray<string>).includes(name)) return undefined
      const envName = name as 'level' | 'low' | 'mid' | 'high'
      let max = 0
      for (const c of idx.clips) {
        if (frame < c.startFrame || frame >= c.startFrame + c.durationFrames) continue
        const env = c.envelopes?.[envName]
        if (!env) continue
        const sourceFrame = c.sourceStartFrame + Math.floor((frame - c.startFrame) * c.speed)
        if (sourceFrame < 0 || sourceFrame >= env.length) continue
        const v = env[sourceFrame]! / 255
        if (v > max) max = v
      }
      return max
    }
  }
}
