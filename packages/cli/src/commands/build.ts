import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Project } from '@elah/core'
import { getTotalFrames } from '@elah/core'
import { CliError, usageError } from '../lib/errors'
import { validateSpec, specToProject, type ProbedAsset } from '../lib/spec'
import { isRemoteUrl, resolveMediaSource, writeProject } from '../lib/project-io'
import { probeMedia } from '../lib/probe'

export interface BuildArgs {
  spec: string
  out?: string
  export?: string
  // export passthrough
  codec?: string
  height?: string
  videoBitrate?: string
  audioBitrate?: string
  browser?: string
  headed: boolean
  timeoutSec?: string
  verbose: boolean
}

export async function runBuild(args: BuildArgs): Promise<void> {
  if (!args.out && !args.export) {
    throw usageError('build requires --out <project.json> and/or --export <file.mp4>')
  }

  const specPath = resolve(args.spec)
  if (!existsSync(specPath)) throw new CliError(`Spec file not found: ${args.spec}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch (err) {
    throw new CliError(`Spec file is not valid JSON: ${args.spec} (${(err as Error).message})`)
  }
  const spec = validateSpec(parsed)
  const specDir = dirname(specPath)

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
      const src = resolveMediaSource(raw, specDir)
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
  process.stderr.write(
    `built project: ${project.tracks.length} tracks, ` +
      `${Object.values(project.clips).flat().length} clips, ${getTotalFrames(project.clips)} frames @ ${project.fps}fps\n`
  )

  if (args.out) {
    // portable output: local srcs relative to the project file's directory
    const outAbs = resolve(args.out)
    writeProject(withRelativeSrcs(project, dirname(outAbs)), outAbs)
  }

  if (args.export) {
    // srcs stay absolute here, so the temp location is safe
    const tmpDir = mkdtempSync(join(tmpdir(), 'elah-build-'))
    try {
      const tmpProject = join(tmpDir, 'project.json')
      writeFileSync(tmpProject, JSON.stringify(project))
      const { runExport } = await import('./export')
      await runExport({
        project: tmpProject,
        out: args.export,
        codec: args.codec,
        height: args.height,
        videoBitrate: args.videoBitrate,
        audioBitrate: args.audioBitrate,
        browser: args.browser,
        headed: args.headed,
        timeoutSec: args.timeoutSec,
        verbose: args.verbose,
      })
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }
}

/** Clone the project with local absolute srcs rewritten relative to `baseDir`. */
function withRelativeSrcs(project: Project, baseDir: string): Project {
  const clone = structuredClone(project)
  for (const clips of Object.values(clone.clips)) {
    for (const clip of clips) {
      if (clip.src && !isRemoteUrl(clip.src) && isAbsolute(clip.src)) {
        const rel = relative(baseDir, clip.src)
        clip.src = rel.startsWith('.') ? rel : `./${rel}`
      }
    }
  }
  return clone
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
