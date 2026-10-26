import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Project } from '@elah/core'
import { CliError } from './errors'
import { createRenderSession, type RenderCallbacks } from './render-session'
import { resolveOutputFormat, type Container, type VideoCodec } from './format'
import { ENCODER_CHOICES, type EncoderChoice } from './ffmpeg/select'

export interface ExportProjectArgs {
  project: Project
  /** Base directory for relative clip srcs. Default process.cwd(). */
  projectDir?: string
  /** When set, the video is also written to disk (absolute or cwd-relative). */
  outPath?: string
  /** Default: from outPath's extension (.webm → WebM), else MP4. */
  container?: Container
  /** Default per container: avc for MP4, vp9 for WebM. */
  videoCodec?: VideoCodec
  outputHeight?: number
  videoBitrate?: number
  audioBitrate?: number
  /** Default 'auto': ffmpeg when usable, else Chrome's encoder. */
  encoder?: EncoderChoice
  /** Explicit ffmpeg executable; otherwise ELAH_FFMPEG, then PATH. */
  ffmpegPath?: string
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
  const format = resolveOutputFormat({
    container: args.container,
    videoCodec: args.videoCodec,
    outPath: args.outPath,
  })

  if (args.encoder !== undefined && !(ENCODER_CHOICES as readonly string[]).includes(args.encoder)) {
    throw new CliError(`encoder must be one of: ${ENCODER_CHOICES.join(', ')}`)
  }

  let outAbs: string | undefined
  if (args.outPath) {
    outAbs = resolve(args.outPath)
    if (!existsSync(dirname(outAbs))) {
      throw new CliError(`Output directory does not exist: ${dirname(outAbs)}`)
    }
  }

  const session = createRenderSession({
    browserPath: args.browserPath,
    headed: args.headed,
    ffmpegPath: args.ffmpegPath,
  })
  try {
    const bytes = await session.render(
      args.project,
      args.projectDir ?? process.cwd(),
      {
        container: format.container,
        videoCodec: format.videoCodec,
        outputHeight: args.outputHeight,
        videoBitrate: args.videoBitrate,
        audioBitrate: args.audioBitrate,
        encoder: args.encoder,
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
