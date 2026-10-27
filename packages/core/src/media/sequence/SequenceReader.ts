/**
 * SequenceReader — one source, frames on demand (PV-P8b).
 *
 * DOM-free: no `document`/`window` reference, only the WebCodecs/Canvas globals
 * an env object supplies (or `globalThis` by default). Runs in the main thread
 * and in a worker (PV-P8c reuses it in the export worker), so it must not import
 * anything that assumes one or the other.
 *
 * Two sources:
 *  - `openAnimatedImage`: one file (GIF, animated WebP/PNG/AVIF) decoded with
 *    `ImageDecoder`. Falls back to its first frame — decoded with
 *    `createImageBitmap` — when `ImageDecoder` is missing or cannot read the
 *    type, per the ticket's fallback contract.
 *  - `openFrameSequence`: one image file per frame, fetched by URL template.
 *
 * `sequenceFrameUrl` is imported from `resolver/sequence.ts` rather than
 * duplicated (the same precedent as `RotoMaskFrameProvider` importing
 * `rotoFrameUrl` from `resolver/rotoMasks.ts`): this file only *reads* the
 * resolver's pure helper, which the ticket's Forbidden list does not bar.
 */

import { sequenceFrameUrl } from '../../resolver/sequence'

/** Why an animated file is shown as a still. */
export type SequenceFallback = 'no-image-decoder' | 'unsupported-type'

/** One decoded frame. The holder closes it exactly once. */
export interface SequenceImage {
  source: ImageBitmap
  width: number
  height: number
  close(): void
}

export interface SequenceFrameReader {
  /** Frames this reader can produce (1 for a still fallback). */
  readonly frameCount: number
  /** Non-null when an animated file fell back to its first frame. */
  readonly fallback: SequenceFallback | null
  /** Decode frame `index`, clamped to 0..frameCount-1. */
  read(index: number): Promise<SequenceImage>
  close(): void
}

/** Globals the reader uses; injectable so node tests run without a browser. */
export interface DecodeEnv {
  ImageDecoder?: typeof ImageDecoder
  createImageBitmap: (source: ImageBitmapSource, options?: ImageBitmapOptions) => Promise<ImageBitmap>
}

/** Reads `globalThis.ImageDecoder` / `globalThis.createImageBitmap`. */
export function defaultDecodeEnv(): DecodeEnv {
  const g = globalThis as unknown as {
    ImageDecoder?: typeof ImageDecoder
    createImageBitmap?: DecodeEnv['createImageBitmap']
  }
  return {
    ImageDecoder: g.ImageDecoder,
    createImageBitmap: (source, options) => {
      if (!g.createImageBitmap) {
        return Promise.reject(new Error('SequenceReader: createImageBitmap is not available in this scope'))
      }
      return g.createImageBitmap(source, options)
    },
  }
}

const EXTENSION_MIME: Record<string, string> = {
  gif: 'image/gif',
  webp: 'image/webp',
  png: 'image/png',
  apng: 'image/png',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

/**
 * MIME type for a URL or file name: an `image/*` blob type wins; else by
 * extension (query and hash ignored, case-insensitive); else
 * `application/octet-stream`.
 */
export function mimeForSource(srcOrName: string, blobType?: string): string {
  if (blobType && blobType.startsWith('image/')) return blobType
  const withoutQuery = srcOrName.split(/[?#]/, 1)[0] ?? srcOrName
  const match = /\.([a-zA-Z0-9]+)$/.exec(withoutQuery)
  const ext = match?.[1]?.toLowerCase()
  if (ext && EXTENSION_MIME[ext]) return EXTENSION_MIME[ext]
  return 'application/octet-stream'
}

/**
 * Bitmap options: `flipY` for GL upload (preview), not for Canvas2D (export).
 * Always premultiplied.
 */
export function bitmapOptions(flipY: boolean): ImageBitmapOptions {
  return flipY
    ? { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' }
    : { premultiplyAlpha: 'premultiply' }
}

function stillReader(bitmap: ImageBitmap, fallback: SequenceFallback | null): SequenceFrameReader {
  let closed = false
  return {
    frameCount: 1,
    fallback,
    read: async () => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => {
        // The single still image is owned by the reader, not by each read() —
        // closing here would break a second read() of the same still.
      },
    }),
    close: () => {
      if (closed) return
      closed = true
      bitmap.close()
    },
  }
}

/**
 * Open an animated image file: GIF, animated WebP/PNG/AVIF, decoded frame by
 * frame with `ImageDecoder`. Falls back to the first frame (via
 * `createImageBitmap`) when `ImageDecoder` is missing or cannot read the type.
 */
export async function openAnimatedImage(
  blob: Blob,
  opts: { src: string; flipY: boolean; env?: DecodeEnv },
): Promise<SequenceFrameReader> {
  const env = opts.env ?? defaultDecodeEnv()
  const type = mimeForSource(opts.src, blob.type)

  const still = async (fallback: SequenceFallback): Promise<SequenceFrameReader> => {
    const bitmap = await env.createImageBitmap(blob, bitmapOptions(opts.flipY))
    return stillReader(bitmap, fallback)
  }

  if (!env.ImageDecoder) return still('no-image-decoder')

  let supported: boolean
  try {
    supported = await env.ImageDecoder.isTypeSupported(type)
  } catch {
    supported = false
  }
  if (!supported) return still('unsupported-type')

  const data = await blob.arrayBuffer()
  const decoder = new env.ImageDecoder({ data, type })
  await decoder.tracks.ready
  await decoder.completed
  const frameCount = Math.max(1, decoder.tracks.selectedTrack?.frameCount ?? 1)

  let closed = false
  return {
    frameCount,
    fallback: null,
    async read(index: number): Promise<SequenceImage> {
      const i = Math.min(frameCount - 1, Math.max(0, Math.floor(index)))
      const { image } = await decoder.decode({ frameIndex: i })
      try {
        const bmp = await env.createImageBitmap(image, bitmapOptions(opts.flipY))
        return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
      } finally {
        image.close()
      }
    },
    close(): void {
      if (closed) return
      closed = true
      decoder.close()
    },
  }
}

/** Open a numbered image sequence: one file per frame, fetched by URL template. */
export function openFrameSequence(opts: {
  template: string
  frameCount: number
  startNumber?: number
  flipY: boolean
  loader: (url: string, signal?: AbortSignal) => Promise<Blob>
  env?: DecodeEnv
}): SequenceFrameReader {
  const env = opts.env ?? defaultDecodeEnv()
  const frameCount = Math.max(1, Math.floor(opts.frameCount))
  const startNumber = opts.startNumber ?? 0

  return {
    frameCount,
    fallback: null,
    async read(index: number): Promise<SequenceImage> {
      const i = Math.min(frameCount - 1, Math.max(0, Math.floor(index)))
      const url = sequenceFrameUrl(opts.template, i, startNumber)
      const blob = await opts.loader(url)
      const bmp = await env.createImageBitmap(blob, bitmapOptions(opts.flipY))
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    },
    close(): void {
      // Nothing held open between reads.
    },
  }
}
