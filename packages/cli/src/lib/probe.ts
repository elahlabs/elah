import { CliError } from './errors'
import { isRemoteUrl } from './project-io'

export interface MediaInfo {
  durationSec: number
  width?: number
  height?: number
}

/**
 * Probe a media file's duration (and dimensions for video) with mediabunny —
 * already a core dependency, pure-JS demuxing, no WebCodecs needed in Node.
 * Remote URLs use ranged reads (UrlSource) instead of buffering the file.
 */
export async function probeMedia(source: string): Promise<MediaInfo> {
  const mb = await import('mediabunny')
  let input: InstanceType<typeof mb.Input> | undefined
  try {
    input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: isRemoteUrl(source) ? new mb.UrlSource(source) : new mb.FilePathSource(source),
    })
    const durationSec = await input.computeDuration()
    const video = await input.getPrimaryVideoTrack()
    return {
      durationSec,
      width: video?.codedWidth,
      height: video?.codedHeight,
    }
  } catch (err) {
    throw new CliError(`Cannot probe media '${source}': ${(err as Error).message}`)
  } finally {
    input?.dispose?.()
  }
}
