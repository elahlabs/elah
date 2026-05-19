import { generateId } from '../utils/id'
import { useMediaLibraryStore } from './store'
import type { MediaAsset, MediaKind } from './types'

export interface ImportFilesOptions {
  /** Reserved for clip creation when source fps is unknown. Not used during import. */
  fallbackFps?: number
  /** Max width/height for generated thumbnails. Default 240. */
  thumbnailMaxDim?: number
}

interface ProbedMetadata {
  durationSec: number
  width?: number
  height?: number
}

const DEFAULT_THUMBNAIL_MAX_DIM = 240

function inferKind(mimeType: string): MediaKind | null {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  return null
}

function loadMediaElement<T extends HTMLMediaElement>(
  tag: 'video' | 'audio',
  src: string,
  onReady: (el: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag) as T
    el.preload = 'metadata'
    el.muted = true

    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('error', onError)
    }

    const onLoaded = () => {
      cleanup()
      onReady(el)
      resolve(el)
    }

    const onError = () => {
      cleanup()
      reject(new Error(`Failed to load ${tag} metadata`))
    }

    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('error', onError)
    el.src = src
  })
}

export async function probeVideo(src: string): Promise<ProbedMetadata> {
  const el = await loadMediaElement<HTMLVideoElement>('video', src, () => {})
  return {
    durationSec: el.duration,
    width: el.videoWidth,
    height: el.videoHeight,
  }
}

export async function probeAudio(src: string): Promise<ProbedMetadata> {
  const el = await loadMediaElement<HTMLAudioElement>('audio', src, () => {})
  return {
    durationSec: el.duration,
  }
}

export async function probeImage(src: string): Promise<ProbedMetadata> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')

    const cleanup = () => {
      img.onload = null
      img.onerror = null
    }

    img.onload = () => {
      cleanup()
      resolve({
        durationSec: 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })
    }

    img.onerror = () => {
      cleanup()
      reject(new Error('Failed to load image metadata'))
    }

    img.src = src
  })
}

async function probeMetadata(kind: MediaKind, src: string): Promise<ProbedMetadata> {
  switch (kind) {
    case 'video':
      return probeVideo(src)
    case 'audio':
      return probeAudio(src)
    case 'image':
      return probeImage(src)
  }
}

function scaleToFit(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) {
    return { width, height }
  }

  const scale = maxDim / Math.max(width, height)
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

function drawToThumbnail(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number,
): string {
  const { width, height } = scaleToFit(sourceWidth, sourceHeight, maxDim)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context')
  }

  ctx.drawImage(source, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.7)
}

export async function makeVideoThumbnail(
  src: string,
  durationSec: number,
  maxDim: number,
): Promise<string> {
  const el = await loadMediaElement<HTMLVideoElement>('video', src, (video) => {
    const seekTime = Math.min(1, durationSec > 0 ? durationSec / 2 : 0)
    video.currentTime = seekTime
  })

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener('seeked', onSeeked)
      el.removeEventListener('error', onError)
    }

    const onSeeked = () => {
      cleanup()
      try {
        resolve(
          drawToThumbnail(el, el.videoWidth, el.videoHeight, maxDim),
        )
      } catch (err) {
        reject(err)
      }
    }

    const onError = () => {
      cleanup()
      reject(new Error('Failed to seek video for thumbnail'))
    }

    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onSeeked()
      return
    }

    el.addEventListener('seeked', onSeeked)
    el.addEventListener('error', onError)
  })
}

export async function makeImageThumbnail(src: string, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')

    const cleanup = () => {
      img.onload = null
      img.onerror = null
    }

    img.onload = () => {
      cleanup()
      try {
        resolve(drawToThumbnail(img, img.naturalWidth, img.naturalHeight, maxDim))
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = () => {
      cleanup()
      reject(new Error('Failed to load image for thumbnail'))
    }

    img.src = src
  })
}

async function generateThumbnail(
  asset: MediaAsset,
  maxDim: number,
): Promise<string | undefined> {
  switch (asset.kind) {
    case 'video':
      return makeVideoThumbnail(asset.src, asset.durationSec, maxDim)
    case 'image':
      return makeImageThumbnail(asset.src, maxDim)
    case 'audio':
      return undefined
  }
}

function scheduleThumbnail(asset: MediaAsset, maxDim: number): void {
  void generateThumbnail(asset, maxDim)
    .then((thumbnailUrl) => {
      if (!thumbnailUrl) return
      useMediaLibraryStore.getState().updateAsset(asset.id, { thumbnailUrl })
    })
    .catch((err) => {
      console.warn(`[importFiles] Thumbnail generation failed for "${asset.name}":`, err)
    })
}

async function importSingleFile(
  file: File,
  thumbnailMaxDim: number,
): Promise<MediaAsset | null> {
  const kind = inferKind(file.type)
  if (!kind) {
    console.warn(`[importFiles] Skipping unsupported file type "${file.type}" (${file.name})`)
    return null
  }

  const src = URL.createObjectURL(file)
  const metadata = await probeMetadata(kind, src)

  const asset: MediaAsset = {
    id: generateId(),
    kind,
    name: file.name,
    src,
    durationSec: metadata.durationSec,
    width: metadata.width,
    height: metadata.height,
    byteSize: file.size,
    addedAt: Date.now(),
  }

  useMediaLibraryStore.getState().addAsset(asset)
  scheduleThumbnail(asset, thumbnailMaxDim)

  return asset
}

/**
 * Import local files into the media library.
 *
 * Creates object URLs, probes metadata, registers assets in
 * `useMediaLibraryStore`, and generates thumbnails asynchronously on the main
 * thread.
 */
export async function importFiles(
  files: File[],
  opts?: ImportFilesOptions,
): Promise<MediaAsset[]> {
  const thumbnailMaxDim = opts?.thumbnailMaxDim ?? DEFAULT_THUMBNAIL_MAX_DIM

  const results = await Promise.all(
    files.map((file) => importSingleFile(file, thumbnailMaxDim)),
  )

  return results.filter((asset): asset is MediaAsset => asset !== null)
}
