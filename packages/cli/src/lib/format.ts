import { extname } from 'node:path'
import { resolveExportFormat, type ExportVideoCodec } from '@elah/core'
import { usageError } from './errors'

/**
 * The output container and video codec of one export, validated against
 * core's own container/codec matrix (`resolveExportFormat`), so the CLI never
 * offers a combination core's exporter rejects: MP4 takes avc/hevc/av1 with
 * AAC audio, WebM takes vp9/vp8/av1 with Opus. Both encoders (ffmpeg and
 * Chrome) follow the same table.
 */

export type VideoCodec = ExportVideoCodec
export const CODECS: readonly VideoCodec[] = ['avc', 'hevc', 'av1', 'vp9', 'vp8']

export type Container = 'mp4' | 'webm'
export const CONTAINERS: readonly Container[] = ['mp4', 'webm']

export const CONTAINER_MIME: Readonly<Record<Container, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export interface OutputFormat {
  container: Container
  videoCodec: VideoCodec
}

/** The container an output path's extension names, if it names one. */
export function containerForPath(path: string): Container | undefined {
  const ext = extname(path).toLowerCase()
  if (ext === '.webm') return 'webm'
  if (ext === '.mp4' || ext === '.m4v') return 'mp4'
  return undefined
}

/**
 * Resolve and validate the format. The container comes from `container`, else
 * from `outPath`'s extension, else MP4; the codec defaults per container
 * (MP4 → avc, WebM → vp9). Every rejection is a usage error naming the fix.
 */
export function resolveOutputFormat(args: {
  container?: string
  videoCodec?: string
  outPath?: string
}): OutputFormat {
  if (args.container !== undefined && !(CONTAINERS as readonly string[]).includes(args.container)) {
    throw usageError(`container must be one of: ${CONTAINERS.join(', ')}`)
  }
  if (args.videoCodec !== undefined && !(CODECS as readonly string[]).includes(args.videoCodec)) {
    throw usageError(`codec must be one of: ${CODECS.join(', ')}`)
  }

  const fromPath = args.outPath ? containerForPath(args.outPath) : undefined
  if (args.container && fromPath && args.container !== fromPath) {
    throw usageError(`container ${args.container} does not match the output file ${args.outPath} (a ${fromPath} name)`)
  }
  const container = (args.container as Container | undefined) ?? fromPath ?? 'mp4'

  try {
    const resolved = resolveExportFormat({ container, videoCodec: args.videoCodec as VideoCodec | undefined })
    return { container, videoCodec: resolved.videoCodec }
  } catch (err) {
    const hint = container === 'mp4' && (args.videoCodec === 'vp9' || args.videoCodec === 'vp8')
      ? ' Write a .webm file (or pass --container webm) for VP9/VP8.'
      : ''
    throw usageError(`${(err as Error).message}${hint}`)
  }
}
