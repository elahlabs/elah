/**
 * Footage the viewer adds from their own device (TICKET-PF-14). Nothing here uploads anything: a dropped `File`
 * goes through the open-source engine's own import (`importFiles`: an object URL, a metadata probe, a library
 * asset), and becomes one clip through `TimelineEngine`. The file stays in this browser tab.
 *
 * Because the bytes are never stored, every footage clip carries `clip.media` (core's LM-P1 local-file reference)
 * holding only the file's name and size. A saved project (Download project, or the per-viewer copy kept in
 * localStorage while footage is on the timeline) comes back with dead `blob:` sources; `missingFootage` lists those
 * clips and `reconnectFootage` gives them a fresh object URL when the viewer drops the same file again.
 */
import {
  determineAssetHasAudio,
  importFiles,
  isRecoverableMediaSrc,
  mediaLibraryStore,
  readProjectDocument,
  relinkProjectMedia,
  secondsToFrames,
  type Clip,
  type MediaAsset,
  type Project,
  type TimelineEngine,
  type Track,
} from '@elah/editor'
import type { ClipMediaRef } from '@elah/core'

/** Name given to the lanes this module creates. */
export const FOOTAGE_TRACK = 'Footage'
/** Over this much footage on the timeline, the page suggests Elah Creator (it never blocks). */
export const CREATOR_NUDGE_SECONDS = 180

const HAS_AUDIO_TIMEOUT_MS = 4000

/** Extensions accepted when the browser leaves `File.type` empty (common for .mov / .mkv on Windows). */
const EXT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
}

export type Refused = { name: string; reason: string }

/** Keep video and audio files; everything else is refused with a one-line reason. */
export function sortFiles(files: Iterable<File>): { accepted: File[]; refused: Refused[] } {
  const accepted: File[] = []
  const refused: Refused[] = []
  for (const file of files) {
    let type = file.type
    if (!type) type = EXT_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? ''
    if (type.startsWith('video/') || type.startsWith('audio/')) {
      // A typed copy so the engine's import (which reads File.type) accepts it; name, size and bytes are unchanged.
      accepted.push(type === file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified }))
    } else {
      refused.push({ name: file.name, reason: `${file.name} is not a video or audio file, so it was not added.` })
    }
  }
  return { accepted, refused }
}

export function refusedLine(refused: Refused[]): string {
  if (refused.length === 0) return ''
  if (refused.length === 1) return refused[0]!.reason
  return `${refused.length} files are not video or audio, so they were not added (${refused.map((r) => r.name).join(', ')}).`
}

/** `local:<sha-256 of name|size>`: the id shape core's reader accepts for a local-file reference. */
async function mediaId(name: string, size: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${name}|${size}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `local:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Name and size only (lastModified is stored as 0): enough to ask for the same file again, nothing more. */
async function mediaRef(file: File, kind: 'video' | 'audio'): Promise<ClipMediaRef> {
  return { v: 1, id: await mediaId(file.name, file.size), name: file.name, byteSize: file.size, lastModified: 0, kind, ...(file.type ? { mime: file.type } : {}) }
}

/** One file through the engine's import. A file already in the library this session reuses its asset. */
async function importOne(file: File): Promise<MediaAsset> {
  const { imported, skipped } = await importFiles([file])
  const asset = imported[0] ?? (skipped[0]?.existingAssetId ? mediaLibraryStore.getState().assets[skipped[0].existingAssetId] : undefined)
  if (!asset) throw new Error(`${file.name} could not be read.`)
  return asset
}

async function videoHasAudio(asset: MediaAsset): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      determineAssetHasAudio(asset.id),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(asset.hasAudio ?? false), HAS_AUDIO_TIMEOUT_MS)
      }),
    ])
  } catch {
    return asset.hasAudio ?? false
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const overlaps = (a: { startFrame: number; durationFrames: number }, start: number, frames: number) =>
  a.startFrame < start + frames && start < a.startFrame + a.durationFrames

/**
 * The lane a new clip goes on: an unlocked footage lane of the right kind that is free over the clip's span, or a
 * new one. A new video lane is moved to order 0, the bottom of the picture stack (a higher order composites in
 * front, and every elements lane, where the graphics live, draws above every video lane anyway).
 */
function laneFor(engine: TimelineEngine, kind: 'video' | 'audio', start: number, frames: number): Track {
  const project = engine.getProject()
  const free = project.tracks.find(
    (t) => t.kind === kind && !t.locked && t.name?.startsWith(FOOTAGE_TRACK) && !(project.clips[t.id] ?? []).some((c) => overlaps(c, start, frames)),
  )
  if (free) return free
  const count = project.tracks.filter((t) => t.kind === kind && t.name?.startsWith(FOOTAGE_TRACK)).length
  const name = `${FOOTAGE_TRACK}${kind === 'audio' ? ' audio' : ''}${count ? ` ${count + 1}` : ''}`
  const track = engine.addTrack(kind, { name })
  if (kind === 'video') {
    const rest = engine
      .getProject()
      .tracks.filter((t) => t.id !== track.id)
      .sort((a, b) => a.order - b.order)
      .map((t) => t.id)
    engine.reorderTracks([track.id, ...rest])
  }
  return engine.getTrack(track.id) ?? track
}

const BACKDROP_NAME = /background|(^|[-_ ])bg($|[-_ ])/i

/**
 * Both compilers draw the backdrop as one full-length shape on the lowest elements lane ("Background" from a spec,
 * "stage-bg" from a programmatic video). Elements always composite over video, so that opaque shape would hide
 * every footage clip. Returns that lane when it is present and visible, so the caller can hide it (one toggle the
 * viewer can turn back on in the timeline).
 */
function backgroundLane(project: Project): Track | null {
  const elements = project.tracks.filter((t) => t.kind === 'elements').sort((a, b) => a.order - b.order)
  const lane = elements[0]
  if (!lane || lane.disabled) return null
  const clips = project.clips[lane.id] ?? []
  if (clips.length !== 1) return null
  const clip = clips[0]!
  let end = 0
  for (const bucket of Object.values(project.clips)) for (const c of bucket) end = Math.max(end, c.startFrame + c.durationFrames)
  const named = BACKDROP_NAME.test(clip.name ?? '') || BACKDROP_NAME.test(lane.name ?? '')
  const fullLength = clip.startFrame === 0 && clip.startFrame + clip.durationFrames >= end
  return named && fullLength && clip.type === 'shape' ? lane : null
}

export type AddResult = { added: number; hidBackground: boolean; names: string[] }

/**
 * Add each file as one clip at the playhead (`at`), keeping its own sound. One undo step per file.
 * `onProgress(text)` reports the probe of each file.
 */
export async function addFootage(engine: TimelineEngine, files: File[], at: number, onProgress: (text: string, progress: number) => void): Promise<AddResult> {
  const result: AddResult = { added: 0, hidBackground: false, names: [] }
  let start = Math.max(0, Math.round(at))
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    onProgress(`Reading ${file.name} (${i + 1} of ${files.length}) in this browser...`, i / files.length)
    const asset = await importOne(file)
    if (asset.kind === 'image') continue
    const kind = asset.kind
    const hasAudio = kind === 'video' ? await videoHasAudio(asset) : false
    const media = await mediaRef(file, kind)
    const fps = engine.getProject().fps
    const frames = Math.max(1, asset.durationSec > 0 && Number.isFinite(asset.durationSec) ? secondsToFrames(asset.durationSec, fps) : fps * 5)
    engine.batch(() => {
      const bg = kind === 'video' ? backgroundLane(engine.getProject()) : null
      const track = laneFor(engine, kind, start, frames)
      const clip = engine.addClip({ trackId: track.id, type: kind, name: file.name, startFrame: start, durationFrames: frames, src: asset.src, assetId: asset.id })
      // createClip keeps only the typed fields, so the local-file reference and the merged sound go on here.
      engine.updateClip(clip.id, track.id, { media, ...(hasAudio ? { embeddedAudio: true } : {}) })
      if (bg) {
        engine.updateTrack(bg.id, { disabled: true })
        result.hidBackground = true
      }
    }, `Add ${file.name}`)
    result.added++
    result.names.push(file.name)
    // Several files in one drop follow each other rather than stack.
    start += frames
  }
  onProgress('', 1)
  return result
}

/** Every clip (any depth) that carries a local-file reference. */
function walk(project: Project, visit: (clip: Clip, trackId: string, depth: number) => void, depth = 0): void {
  for (const [trackId, clips] of Object.entries(project.clips)) {
    for (const clip of clips) {
      if (clip.type === 'compound' && clip.compound) walk(clip.compound.project, visit, depth + 1)
      else visit(clip, trackId, depth)
    }
  }
}

/** Seconds of footage on the timeline (clips with a local-file reference). */
export function footageSeconds(project: Project): number {
  let frames = 0
  walk(project, (clip) => {
    if (clip.media && (clip.type === 'video' || clip.type === 'audio')) frames += clip.durationFrames
  })
  return frames / (project.fps || 30)
}

export function hasFootage(project: Project): boolean {
  let found = false
  walk(project, (clip) => {
    if (clip.media) found = true
  })
  return found
}

export type MissingFile = { id: string; name: string; byteSize: number; kind: 'video' | 'audio' | 'image'; clips: number }

/**
 * Footage whose file is not open in this tab: a `blob:` source minted by an earlier session (or another browser).
 * A source the media library holds now is live. One row per file, however many clips use it.
 */
export function missingFootage(project: Project): MissingFile[] {
  const live = new Set(Object.values(mediaLibraryStore.getState().assets).map((a) => a.src))
  const byId = new Map<string, MissingFile>()
  walk(project, (clip) => {
    const ref = clip.media
    if (!ref) return
    if (isRecoverableMediaSrc(clip.src) || (clip.src && live.has(clip.src))) return
    const row = byId.get(ref.id)
    if (row) row.clips++
    else byId.set(ref.id, { id: ref.id, name: ref.name, byteSize: ref.byteSize, kind: ref.kind, clips: 1 })
  })
  return [...byId.values()]
}

/**
 * Match dropped files to missing footage by name and size, import the matches, and point their clips at the fresh
 * object URLs. Root-level clips are updated in one undo step; a match inside a compound reloads the project
 * through core's `relinkProjectMedia` (which clears the undo history). Returns the files that matched nothing.
 */
export async function reconnectFootage(
  engine: TimelineEngine,
  files: File[],
  onProgress: (text: string, progress: number) => void,
): Promise<{ reconnected: string[]; unmatched: File[] }> {
  const missing = missingFootage(engine.getProject())
  const remint = new Map<string, string>()
  const assetFor = new Map<string, MediaAsset>()
  const reconnected: string[] = []
  const unmatched: File[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    const row = missing.find((m) => m.name === file.name && m.byteSize === file.size && !remint.has(m.id))
    if (!row) {
      unmatched.push(file)
      continue
    }
    onProgress(`Reconnecting ${file.name} (${i + 1} of ${files.length})...`, i / files.length)
    const asset = await importOne(file)
    remint.set(row.id, asset.src)
    assetFor.set(row.id, asset)
    reconnected.push(file.name)
  }
  onProgress('', 1)
  if (remint.size === 0) return { reconnected, unmatched }

  const project = engine.getProject()
  let nested = false
  walk(project, (clip, _t, depth) => {
    if (depth > 0 && clip.media && remint.has(clip.media.id)) nested = true
  })
  if (nested) {
    const assets = [...assetFor.values()].map((a) => ({ id: a.id, src: a.src }))
    engine.loadProject(relinkProjectMedia(project, assets, { remint }).project)
  } else {
    engine.batch(() => {
      for (const [trackId, clips] of Object.entries(engine.getProject().clips)) {
        for (const clip of clips) {
          const asset = clip.media ? assetFor.get(clip.media.id) : undefined
          if (asset) engine.updateClip(clip.id, trackId, { src: asset.src, assetId: asset.id })
        }
      }
    }, 'Reconnect footage')
  }
  return { reconnected, unmatched }
}

/** Remove every clip whose file is missing (the viewer chose to go on without it). One undo step. */
export function removeMissingFootage(engine: TimelineEngine): number {
  const ids = new Set(missingFootage(engine.getProject()).map((m) => m.id))
  let removed = 0
  engine.batch(() => {
    for (const [trackId, clips] of Object.entries(engine.getProject().clips)) {
      for (const clip of [...clips]) {
        if (clip.media && ids.has(clip.media.id)) {
          engine.removeClip(clip.id, trackId)
          removed++
        }
      }
    }
  }, 'Remove missing footage')
  return removed
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

// ---------------------------------------------------------------------------
// The per-viewer copy (localStorage). A convenience only: when it is blocked or full the page still works, and a
// reload simply starts from the published video again.
// ---------------------------------------------------------------------------

/** A short stable key for one published input (FNV-1a over its JSON). */
export function footageKey(input: unknown): string {
  const s = JSON.stringify(input) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `elah-footage:${(h >>> 0).toString(16)}:${s.length}`
}

export function readSavedProject(key: string): Project | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const project = readProjectDocument(JSON.parse(raw))
    return hasFootage(project) ? project : null
  } catch {
    return null
  }
}

/** Keep the project while it holds footage; forget it once the footage is gone. */
export function writeSavedProject(key: string, project: Project): void {
  try {
    if (hasFootage(project)) localStorage.setItem(key, JSON.stringify(project))
    else localStorage.removeItem(key)
  } catch {
    /* storage blocked or full: the reconnect list after a reload is a convenience */
  }
}

export function forgetSavedProject(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to forget */
  }
}
