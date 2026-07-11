import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Project } from '@elah/core'
import { CliError } from './errors'
import { createRenderSession, CODECS, type RenderCallbacks, type VideoCodec } from './render-session'

export interface ExportProjectArgs {
  project: Project
  /** Base directory for relative clip srcs. Default process.cwd(). */
  projectDir?: string
  /** When set, the MP4 is also written to disk (absolute or cwd-relative). */
  outPath?: string
  videoCodec?: VideoCodec
  outputHeight?: number
  videoBitrate?: number
  audioBitrate?: number
  browserPath?: string
  headed?: boolean
  timeoutMs?: number
}

export interface ExportProjectResult {
  bytes: Buffer
  sizeBytes: number
  outPath?: string
}

export async function exportProject(
  args: ExportProjectArgs,
  callbacks: RenderCallbacks = {}
): Promise<ExportProjectResult> {
  if (args.videoCodec !== undefined && !(CODECS as readonly string[]).includes(args.videoCodec)) {
    throw new CliError(`videoCodec must be one of: ${CODECS.join(', ')}`)
  }

  let outAbs: string | undefined
  if (args.outPath) {
    outAbs = resolve(args.outPath)
    if (!existsSync(dirname(outAbs))) {
      throw new CliError(`Output directory does not exist: ${dirname(outAbs)}`)
    }
  }

  const session = createRenderSession({ browserPath: args.browserPath, headed: args.headed })
  try {
    const bytes = await session.render(
      args.project,
      args.projectDir ?? process.cwd(),
      {
        videoCodec: args.videoCodec,
        outputHeight: args.outputHeight,
        videoBitrate: args.videoBitrate,
        audioBitrate: args.audioBitrate,
        timeoutMs: args.timeoutMs,
      },
      callbacks
    )

    if (outAbs) {
      try {
        writeFileSync(outAbs, bytes)
      } catch (err) {
        throw new CliError(`Cannot write ${args.outPath}: ${(err as Error).message}`)
      }
    }

    return { bytes, sizeBytes: bytes.length, outPath: outAbs }
  } finally {
    await session.close()
  }
}
