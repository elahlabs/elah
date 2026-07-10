import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project, Clip } from '@elah/core'
import { CliError } from './errors'

/** True for http(s) sources, which are proxied rather than read from disk. */
export function isRemoteUrl(src: string): boolean {
  return /^https?:\/\//.test(src)
}

export interface LoadedProject {
  project: Project
  /** Directory of the project JSON — relative clip srcs resolve against it. */
  dir: string
}

const SUPPORTED_PROJECT_VERSION = 1

/** Read + parse + structurally validate a Project JSON file. */
export function readProject(path: string): LoadedProject {
  const abs = resolve(path)
  if (!existsSync(abs)) {
    throw new CliError(`Project file not found: ${path}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    throw new CliError(`Project file is not valid JSON: ${path} (${(err as Error).message})`)
  }

  const project = validateProject(parsed, path)
  if (project.version !== SUPPORTED_PROJECT_VERSION) {
    process.stderr.write(
      `warning: project version ${project.version} differs from the supported version ${SUPPORTED_PROJECT_VERSION}; proceeding anyway\n`
    )
  }
  return { project, dir: dirname(abs) }
}

/** Write project JSON to a file, or stdout when no path is given. */
export function writeProject(project: Project, outPath?: string): void {
  const json = JSON.stringify(project, null, 2) + '\n'
  if (outPath) {
    try {
      writeFileSync(resolve(outPath), json)
    } catch (err) {
      throw new CliError(`Cannot write ${outPath}: ${(err as Error).message}`)
    }
  } else {
    process.stdout.write(json)
  }
}

/** Locate a clip by id across all tracks. Clip ids are unique by construction. */
export function findClipTrack(
  project: Project,
  clipId: string
): { clip: Clip; trackId: string } {
  for (const [trackId, clips] of Object.entries(project.clips)) {
    const clip = clips.find((c) => c.id === clipId)
    if (clip) return { clip, trackId }
  }
  const known = Object.values(project.clips)
    .flat()
    .map((c) => c.id)
  throw new CliError(
    `Clip '${clipId}' not found in project. Known clip ids: ${known.length ? known.join(', ') : '(none)'}`
  )
}

/** Resolve a clip src against the project directory. Remote URLs pass through. */
export function resolveMediaSource(src: string, projectDir: string): string {
  if (isRemoteUrl(src)) return src
  if (src.startsWith('file://')) return fileURLToPath(src)
  return isAbsolute(src) ? src : resolve(projectDir, src)
}

function validateProject(value: unknown, path: string): Project {
  // explicit entity annotation so TS control-flow treats calls as `never`
  const fail: (detail: string) => never = (detail) => {
    throw new CliError(`Invalid project file ${path}: ${detail}`)
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('expected a JSON object')
  }
  const p = value as Record<string, unknown>

  if (typeof p.id !== 'string' || p.id.length === 0) fail("missing string 'id'")
  if (typeof p.fps !== 'number' || !Number.isInteger(p.fps) || p.fps <= 0) {
    fail("'fps' must be a positive integer")
  }
  const stage = p.stage as Record<string, unknown> | undefined
  if (
    typeof stage !== 'object' ||
    stage === null ||
    typeof stage.width !== 'number' ||
    typeof stage.height !== 'number'
  ) {
    fail("'stage' must be an object with numeric width and height")
  }
  if (!Array.isArray(p.tracks)) fail("'tracks' must be an array")
  if (typeof p.clips !== 'object' || p.clips === null || Array.isArray(p.clips)) {
    fail("'clips' must be an object keyed by trackId")
  }
  if (!Array.isArray(p.transitions)) fail("'transitions' must be an array")
  if (typeof p.version !== 'number') fail("missing numeric 'version'")

  const trackIds = new Set((p.tracks as { id?: unknown }[]).map((t) => t.id))
  const clipTrack = new Map<string, string>()
  for (const [trackId, clips] of Object.entries(p.clips as Record<string, unknown>)) {
    if (!trackIds.has(trackId)) fail(`clips reference unknown track '${trackId}'`)
    if (!Array.isArray(clips)) fail(`clips['${trackId}'] must be an array`)
    for (const clip of clips as Record<string, unknown>[]) {
      const id = clip.id
      if (typeof id !== 'string') fail(`clip in track '${trackId}' is missing string 'id'`)
      // clip ids address edits — duplicates would make --clip silently ambiguous
      const already = clipTrack.get(id)
      if (already) fail(`duplicate clip id '${id}' (tracks '${already}' and '${trackId}')`)
      clipTrack.set(id, trackId)
      for (const field of ['startFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames']) {
        if (typeof clip[field] !== 'number' || !Number.isInteger(clip[field])) {
          fail(`clip '${clip.id}' field '${field}' must be an integer frame count`)
        }
      }
    }
  }

  return value as Project
}
