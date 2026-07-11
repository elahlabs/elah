import { existsSync, openSync, readSync, closeSync } from 'node:fs'
import type { Project } from '@elah/core'
import { getTotalFrames } from '@elah/core'
import { CliError } from './errors'
import { validateSpec, specToProject, type ProbedAsset } from './spec'
import { isRemoteUrl, resolveMediaSource } from './project-io'
import { probeMedia } from './probe'

export interface BuildProjectArgs {
  /** Raw parsed spec JSON — validated internally with path-addressed errors. */
  spec: unknown
  /** Absolute dir that relative asset paths in the spec resolve against. */
  baseDir: string
}

export interface BuildSummary {
  tracks: number
  clips: number
  totalFrames: number
  fps: number
}

export interface BuildProjectResult {
  project: Project
  summary: BuildSummary
}

export async function buildProject(args: BuildProjectArgs): Promise<BuildProjectResult> {
  const spec = validateSpec(args.spec)
  const baseDir = args.baseDir

  // resolve + probe every referenced asset once (video/audio need durations;
  // images get a cheap signature check). Failures name the ASSET, the handle
  // the spec author actually wrote.
  const referenced = new Map<string, Set<string>>()
  for (const c of spec.clips) {
    if ('asset' in c && typeof c.asset === 'string') {
      const kinds = referenced.get(c.asset) ?? new Set()
      kinds.add(c.track)
      referenced.set(c.asset, kinds)
    }
  }
  const assets = new Map<string, ProbedAsset>()
  await Promise.all(
    [...referenced.entries()].map(async ([name, kinds]) => {
      const raw = spec.assets?.[name]
      if (!raw) throw new CliError(`Asset '${name}' is referenced by a clip but missing from the assets map`)
      const src = resolveMediaSource(raw, baseDir)
      if (!isRemoteUrl(src) && !existsSync(src)) {
        throw new CliError(`Asset '${name}' not found: ${raw} (resolved to ${src})`)
      }

      if (kinds.has('image') && !isRemoteUrl(src) && !looksLikeImage(src)) {
        throw new CliError(`Asset '${name}' (${raw}) does not look like an image file — check the path or the clip's track`)
      }

      const needsDuration = kinds.has('video') || kinds.has('audio')
      if (!needsDuration) {
        assets.set(name, { src })
        return
      }
      try {
        assets.set(name, { src, durationSec: (await probeMedia(src)).durationSec })
      } catch (err) {
        const hint = looksLikeImage(src)
          ? " — this looks like a still image; use track: 'image' instead"
          : ''
        throw new CliError(`Asset '${name}': ${(err as Error).message}${hint}`)
      }
    })
  )

  const project = specToProject(spec, assets)
  const summary: BuildSummary = {
    tracks: project.tracks.length,
    clips: Object.values(project.clips).flat().length,
    totalFrames: getTotalFrames(project.clips),
    fps: project.fps,
  }

  return { project, summary }
}

const IMAGE_SIGNATURES: Array<{ bytes: number[]; offset?: number }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
  { bytes: [0xff, 0xd8, 0xff] }, // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // RIFF....WEBP
  { bytes: [0x42, 0x4d] }, // BMP
  { bytes: [0x3c] }, // '<' — SVG/XML
]

function looksLikeImage(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    const head = Buffer.alloc(12)
    readSync(fd, head, 0, 12, 0)
    closeSync(fd)
    return IMAGE_SIGNATURES.some(({ bytes, offset = 0 }) =>
      bytes.every((b, i) => head[offset + i] === b)
    )
  } catch {
    return false
  }
}
