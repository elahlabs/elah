/**
 * Animated-image probe (PV-P8d), DOM-free.
 *
 * Reads whether an image file (GIF, animated WebP/PNG/AVIF) is actually
 * animated, and if so its frame count/fps/size, using the same WebCodecs
 * `ImageDecoder` contract `SequenceReader.ts`'s `openAnimatedImage` decodes
 * with — this file only *reads* frames to measure them, it never holds a
 * reader open. Runs in the browser only (no `ImageDecoder` in node), so every
 * entry point returns `null` rather than throwing when it is missing.
 */

import { sourceBlobCache } from '../video/demuxer/sourceBlobCache'
import { defaultDecodeEnv, mimeForSource, type DecodeEnv } from './SequenceReader'

export interface AnimatedImageInfo {
  frameCount: number
  fps: number
  width: number
  height: number
}

/** Types worth asking ImageDecoder about. */
export const ANIMATABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/gif',
  'image/webp',
  'image/png',
  'image/avif',
])

/**
 * Average frame rate from per-frame durations in microseconds. A missing
 * duration or one <= 10 000 µs counts as 100 000 µs (the browsers' GIF rule).
 * Rounded to 3 decimals, clamped to 1..60. Empty input → 10.
 */
export function fpsFromFrameDurations(durationsUs: ReadonlyArray<number | null>): number {
  if (durationsUs.length === 0) return 10

  const effective = durationsUs.map((d) => (d === null || d <= 10000 ? 100000 : d))
  const avg = effective.reduce((sum, d) => sum + d, 0) / effective.length
  const fps = 1_000_000 / avg
  const rounded = Math.round(fps * 1000) / 1000
  return Math.min(60, Math.max(1, rounded))
}

/**
 * Null unless the blob is animated (frameCount > 1) and ImageDecoder can read
 * it. Reads the durations of at most the first 60 frames, closing each
 * VideoFrame. Never throws.
 */
export async function probeAnimatedImage(
  blob: Blob,
  type: string,
  env: DecodeEnv = defaultDecodeEnv(),
): Promise<AnimatedImageInfo | null> {
  if (!env.ImageDecoder) return null

  try {
    let supported: boolean
    try {
      supported = await env.ImageDecoder.isTypeSupported(type)
    } catch {
      supported = false
    }
    if (!supported) return null

    const data = await blob.arrayBuffer()
    const decoder = new env.ImageDecoder({ data, type })
    try {
      await decoder.tracks.ready
      await decoder.completed
      const track = decoder.tracks.selectedTrack
      if (!track?.animated || !track.frameCount || track.frameCount <= 1) return null

      const readCount = Math.min(track.frameCount, 60)
      const durations: Array<number | null> = []
      let width = 0
      let height = 0
      for (let i = 0; i < readCount; i++) {
        const { image } = await decoder.decode({ frameIndex: i })
        try {
          durations.push(image.duration ?? null)
          if (i === 0) {
            width = image.displayWidth
            height = image.displayHeight
          }
        } finally {
          image.close()
        }
      }

      return {
        frameCount: track.frameCount,
        fps: fpsFromFrameDurations(durations),
        width,
        height,
      }
    } finally {
      decoder.close()
    }
  } catch {
    return null
  }
}

/**
 * Probe by URL: returns null BEFORE fetching when env has no ImageDecoder or
 * `mimeForSource(name)` is not animatable; else fetches through `resolveBlob`
 * (default `sourceBlobCache.resolve`) and probes with `mimeForSource(name,
 * blob.type)`. Never throws.
 */
export async function probeAnimatedImageSrc(
  src: string,
  name: string,
  env: DecodeEnv = defaultDecodeEnv(),
  resolveBlob: (src: string) => Promise<Blob> = sourceBlobCache.resolve,
): Promise<AnimatedImageInfo | null> {
  if (!env.ImageDecoder) return null
  const guessType = mimeForSource(name)
  if (!ANIMATABLE_IMAGE_TYPES.has(guessType)) return null

  try {
    const blob = await resolveBlob(src)
    const type = mimeForSource(name, blob.type)
    return await probeAnimatedImage(blob, type, env)
  } catch {
    return null
  }
}
