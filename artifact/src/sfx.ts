/**
 * Sound cues -> audio clips (TICKET-PF-12). `lowerSfx` (core) turns a VideoSpec's `sfx` cues, seconds or event-bound,
 * into `{at, cue, gain}`; nothing in core resolves a cue to audio. This does, from the CC0 pack bundled beside the page
 * (`sfx/`, provenance in `sfx/sfx.json` and `sfx/LICENSES.md`). An unknown cue is a warning, never an error.
 */

import { generateId, type Clip, type Project, type Track } from '@elah/core'
import { SFX_CUE_SYNONYMS, type SpecSfx } from '@elah/core/spec'
import pack from '../sfx/sfx.json'

export interface SfxIssue {
  severity: 'warn'
  where: string
  message: string
}

const DEFAULT_GAIN = 0.6
const cues = pack.cues as Record<string, Array<{ file: string; seconds: number }>>

/** Where the bundled sounds are served from: `sfx/` next to this page. */
export function sfxBaseUrl(): string {
  return new URL('./sfx/', document.baseURI).href
}

/** A searched sound (TICKET-PF-12b): one mp3 directly in `assets/sfx/`, published beside the page. Matches the plugin validator. */
const SFX_PATH = /^(?:\.\/)?(assets\/sfx\/[a-z0-9][a-z0-9._-]*\.mp3)$/
/** The longest a searched sound can be (sfx-search.mjs keeps to 3 s); the file's own length is not known without decoding. */
const SEARCHED_SECONDS = 3

/**
 * The file for a cue: an `assets/sfx/<name>.mp3` path (a searched sound; `path: true`, resolved beside the page) or the pack
 * file for a cue word (first variant). Case-insensitive; `ding`/`swish` map to their pack word. Undefined when neither.
 */
export function resolveCue(cue: string): { file: string; seconds: number; path?: boolean } | undefined {
  const word = String(cue ?? '').trim().toLowerCase()
  const m = SFX_PATH.exec(word)
  if (m && !m[1]!.includes('..')) return { file: m[1]!, seconds: SEARCHED_SECONDS, path: true }
  const key = (SFX_CUE_SYNONYMS as Record<string, string>)[word] ?? word
  return cues[key]?.[0]
}

/**
 * Add one audio track holding a clip per resolvable cue. Returns the project unchanged when there is nothing to add.
 * `cues` is `built.expandedSpec.sfx` (already lowered to seconds).
 */
export function addSfxClips(project: Project, spec: SpecSfx[] | undefined, baseUrl: string = sfxBaseUrl()): { project: Project; issues: SfxIssue[] } {
  const issues: SfxIssue[] = []
  if (!spec?.length) return { project, issues }
  const fps = project.fps
  const projectEnd = Object.values(project.clips).reduce((m, list) => list.reduce((mm, c) => Math.max(mm, c.startFrame + c.durationFrames), m), 0)
  const trackId = generateId()
  const clips: Clip[] = []
  spec.forEach((s, i) => {
    const hit = resolveCue(s.cue)
    if (!hit) {
      issues.push({
        severity: 'warn',
        where: `sfx[${i}]`,
        message: `unknown sound cue "${String(s.cue)}"; not played. Available cues: ${Object.keys(cues).join(', ')}.`,
      })
      return
    }
    const start = Math.max(0, Math.round((Number.isFinite(s.at) ? s.at : 0) * fps))
    let frames = Math.max(1, Math.ceil(hit.seconds * fps))
    if (projectEnd > 0) frames = Math.min(frames, projectEnd - start)
    if (frames < 1) {
      issues.push({ severity: 'warn', where: `sfx[${i}]`, message: `sound cue "${s.cue}" at ${s.at}s starts after the video ends; not played.` })
      return
    }
    clips.push({
      id: generateId(),
      trackId,
      type: 'audio',
      name: `sfx ${hit.path ? hit.file.slice(hit.file.lastIndexOf('/') + 1, -4) : String(s.cue).toLowerCase()}`,
      startFrame: start,
      durationFrames: frames,
      sourceStartFrame: 0,
      sourceDurationFrames: Math.max(1, Math.ceil(hit.seconds * fps)),
      src: new URL(hit.file, hit.path ? new URL('../', baseUrl) : baseUrl).href,
      volume: Math.min(1, Math.max(0, s.gain ?? DEFAULT_GAIN)),
      opacity: 1,
      locked: false,
      disabled: false,
    })
  })
  if (!clips.length) return { project, issues }
  const order = project.tracks.reduce((m, t) => Math.max(m, t.order), -1) + 1
  const track: Track = { id: trackId, name: 'Sound effects', kind: 'audio', order, height: 36, locked: false, disabled: false, muted: false, solo: false }
  return { project: { ...project, tracks: [...project.tracks, track], clips: { ...project.clips, [trackId]: clips } }, issues }
}
