import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CliError, usageError } from '../lib/errors'
import { validateSpec, specToProject, type ProbedAsset } from '../lib/spec'
import { isRemoteUrl, resolveMediaSource, writeProject } from '../lib/project-io'
import { probeMedia } from '../lib/probe'
import { getTotalFrames } from '@elah/core'

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
  // images just resolve). Missing files fail here with the asset name.
  const referenced = new Set(
    spec.clips.flatMap((c) => ('asset' in c && typeof c.asset === 'string' ? [c.asset] : []))
  )
  const assets = new Map<string, ProbedAsset>()
  await Promise.all(
    [...referenced].map(async (name) => {
      const raw = spec.assets?.[name]
      if (!raw) throw new CliError(`Asset '${name}' is referenced by a clip but missing from the assets map`)
      const src = resolveMediaSource(raw, specDir)
      if (!isRemoteUrl(src) && !existsSync(src)) {
        throw new CliError(`Asset '${name}' not found: ${raw} (resolved to ${src})`)
      }
      const needsDuration = spec.clips.some(
        (c) => 'asset' in c && c.asset === name && (c.track === 'video' || c.track === 'audio')
      )
      assets.set(name, {
        src,
        durationSec: needsDuration ? (await probeMedia(src)).durationSec : undefined,
      })
    })
  )

  const project = specToProject(spec, assets)
  process.stderr.write(
    `built project: ${project.tracks.length} tracks, ` +
      `${Object.values(project.clips).flat().length} clips, ${getTotalFrames(project.clips)} frames @ ${project.fps}fps\n`
  )

  if (args.out) writeProject(project, args.out)

  if (args.export) {
    // srcs are already absolute (or remote), so the temp location is safe
    const tmpProject = join(mkdtempSync(join(tmpdir(), 'elah-build-')), 'project.json')
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
  }
}
