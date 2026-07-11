import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Project } from '@elah/core'
import { CliError, usageError } from '../lib/errors'
import { isRemoteUrl, writeProject } from '../lib/project-io'
import { buildProject } from '../lib/build-project'
import { runExportForProject } from './export'

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
  const specDir = dirname(specPath)

  const { project, summary } = await buildProject({ spec: parsed, baseDir: specDir })
  process.stderr.write(
    `built project: ${summary.tracks} tracks, ${summary.clips} clips, ` +
      `${summary.totalFrames} frames @ ${summary.fps}fps\n`
  )

  if (args.out) {
    // portable output: local srcs relative to the project file's directory
    const outAbs = resolve(args.out)
    writeProject(withRelativeSrcs(project, dirname(outAbs)), outAbs)
  }

  if (args.export) {
    await runExportForProject(project, specDir, {
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
