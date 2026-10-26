import { execFile } from 'node:child_process'
import { CliError } from './errors'
import { isRemoteUrl } from './project-io'
import { locateFfmpeg } from './ffmpeg/locate'

export interface MediaInfo {
  durationSec: number
  width?: number
  height?: number
}

export interface ProbeOptions {
  /** ffmpeg for containers mediabunny cannot read (AVI, WMV, FLV); otherwise ELAH_FFMPEG, then PATH. */
  ffmpegPath?: string
}

/**
 * Probe a media file's duration (and dimensions for video) with mediabunny —
 * already a core dependency, pure-JS demuxing, no WebCodecs needed in Node.
 * Remote URLs use ranged reads (UrlSource) instead of buffering the file.
 *
 * A container mediabunny cannot read falls back to ffmpeg when one is
 * installed: the export converts such a source for Chrome anyway
 * (ffmpeg/prepare.ts), so `build` should accept it too.
 */
export async function probeMedia(source: string, options: ProbeOptions = {}): Promise<MediaInfo> {
  const mb = await import('mediabunny')
  let input: InstanceType<typeof mb.Input> | undefined
  try {
    input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: isRemoteUrl(source) ? new mb.UrlSource(source) : new mb.FilePathSource(source),
    })
    const video = await input.getPrimaryVideoTrack()
    // Measured from the first video frame: an MPEG-TS often starts at ~1.4 s,
    // and the export's converted copy puts that frame at 0 (ffmpeg/transcode.ts).
    const videoStart = Math.max(0, (await video?.getFirstTimestamp().catch(() => 0)) ?? 0)
    const durationSec = (await input.computeDuration()) - videoStart
    return {
      durationSec,
      width: video?.codedWidth,
      height: video?.codedHeight,
    }
  } catch (err) {
    const viaFfmpeg = await probeWithFfmpeg(source, options.ffmpegPath)
    if (typeof viaFfmpeg !== 'string') return viaFfmpeg
    throw new CliError(`Cannot probe media '${source}': ${(err as Error).message} (${viaFfmpeg})`)
  } finally {
    input?.dispose?.()
  }
}

/** The MediaInfo ffmpeg reports for a source, or why it could not. */
async function probeWithFfmpeg(source: string, ffmpegPath: string | undefined): Promise<MediaInfo | string> {
  let ffmpeg
  try {
    ffmpeg = await locateFfmpeg({ ffmpegPath })
  } catch {
    return 'install ffmpeg 4.4+ to read AVI, WMV, FLV and other containers'
  }
  // `ffmpeg -i <file>` with no output prints the stream summary to stderr and exits 1.
  const stderr = await new Promise<string>((resolve) => {
    execFile(ffmpeg.path, ['-hide_banner', '-i', source], (_err, _stdout, err) => resolve(String(err)))
  })
  return parseFfmpegInfo(stderr) ?? `ffmpeg could not read it either: ${stderr.trim().split('\n').pop()}`
}

/**
 * Parse `ffmpeg -i` stderr: `Duration: HH:MM:SS.ss` and the first video
 * stream's `WxH`. null when there is no usable duration.
 */
export function parseFfmpegInfo(stderr: string): MediaInfo | null {
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (!duration) return null
  const durationSec = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
  if (!(durationSec > 0)) return null
  const size = /Stream #\d+:\d+.*?: Video: .*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr)
  return size ? { durationSec, width: Number(size[1]), height: Number(size[2]) } : { durationSec }
}
