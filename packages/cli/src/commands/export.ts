import type { Project } from '@elah/core'
import { usageError } from '../lib/errors'
import { readProject } from '../lib/project-io'
import { parsePositiveInt } from '../lib/flags'
import { exportProject } from '../lib/export-project'
import { resolveOutputFormat } from '../lib/format'
import { ENCODER_CHOICES, type EncoderChoice } from '../lib/ffmpeg/select'

export interface ExportArgs {
  project: string
  out: string
  container?: string
  codec?: string
  height?: string
  videoBitrate?: string
  audioBitrate?: string
  encoder?: string
  ffmpeg?: string
  browser?: string
  headed: boolean
  timeoutSec?: string
  verbose: boolean
}

export async function runExport(args: ExportArgs): Promise<void> {
  const { project, dir } = readProject(args.project)
  await runExportForProject(project, dir, args)
}

export async function runExportForProject(
  project: Project,
  projectDir: string,
  args: Omit<ExportArgs, 'project'>
): Promise<void> {
  const format = resolveOutputFormat({ container: args.container, videoCodec: args.codec, outPath: args.out })
  if (args.encoder !== undefined && !(ENCODER_CHOICES as readonly string[]).includes(args.encoder)) {
    throw usageError(`--encoder must be one of: ${ENCODER_CHOICES.join(', ')}`)
  }
  const height = args.height !== undefined ? parsePositiveInt(args.height, '--height') : undefined
  const videoBitrate =
    args.videoBitrate !== undefined ? parsePositiveInt(args.videoBitrate, '--video-bitrate') : undefined
  const audioBitrate =
    args.audioBitrate !== undefined ? parsePositiveInt(args.audioBitrate, '--audio-bitrate') : undefined
  const timeoutMs =
    (args.timeoutSec !== undefined ? parsePositiveInt(args.timeoutSec, '--timeout') : 600) * 1000

  const stderr = (line: string) => process.stderr.write(line)
  let progressLineOpen = false
  let encodedWith = ''

  try {
    const result = await exportProject(
      {
        project,
        projectDir,
        outPath: args.out,
        container: format.container,
        videoCodec: format.videoCodec,
        outputHeight: height,
        videoBitrate,
        audioBitrate,
        encoder: args.encoder as EncoderChoice | undefined,
        ffmpegPath: args.ffmpeg,
        browserPath: args.browser,
        headed: args.headed,
        timeoutMs,
      },
      {
        onProgress: ({ frame, totalFrames }) => {
          progressLineOpen = true
          // frame is 0-indexed while rendering; show human-friendly 1-based count
          stderr(`\rexporting frame ${Math.min(frame + 1, totalFrames)}/${totalFrames}`)
        },
        onWarning: (message) => {
          progressLineOpen = false
          if (message.startsWith('[browser:pageerror]')) {
            stderr(`\n${message}\n`)
          } else {
            stderr(`\nwarning: ${message}\n`)
          }
        },
        onLog: (line) => args.verbose && stderr(`${line}\n`),
        onEncoder: (description) => {
          encodedWith = description
        },
        onStatus: (message) => stderr(`${message}\n`),
      }
    )
    stderr(`\nwrote ${args.out} (${result.sizeBytes} bytes, encoded by ${encodedWith})\n`)
  } catch (err) {
    if (progressLineOpen) stderr('\n')
    throw err
  }
}

