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
 * Remote URLs are fetched fully and probed from memory.
 */
export async function probeMedia(source: string): Promise<MediaInfo> {
  const mb = await import('mediabunny')
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: isRemoteUrl(source)
      ? new mb.BufferSource(await (await fetch(source)).arrayBuffer())
      : new mb.FilePathSource(source),
  })

  try {
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
    input.dispose?.()
  }
}
