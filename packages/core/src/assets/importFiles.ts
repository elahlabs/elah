import { generateId } from '../utils/id'
import { useMediaLibraryStore } from './store'
import type { MediaAsset, MediaKind } from './types'

export interface ImportFilesOptions {
  /** Reserved for clip creation when source fps is unknown. Not used during import. */
  fallbackFps?: number
  /** Max width/height for generated thumbnails. Default 240. */
  thumbnailMaxDim?: number
}

export interface SkippedImport {
  file: File
  reason: 'duplicate' | 'unsupported'
  existingAssetId?: string
}

export interface ImportFilesResult {
  imported: MediaAsset[]
  skipped: SkippedImport[]
}

interface ProbedMetadata {
  durationSec: number
  width?: number
  height?: number
  hasAudio?: boolean
}

const DEFAULT_THUMBNAIL_MAX_DIM = 240

/** Number of frames sampled across a video to fake a filmstrip in the timeline. */
const THUMBNAIL_STRIP_COUNT = 4
/** Max width/height for filmstrip tiles — small; they're decorative. */
const THUMBNAIL_STRIP_MAX_DIM = 160
/** Number of normalized peaks stored per audio source. */
const WAVEFORM_PEAK_COUNT = 256

/**
 * Best-effort, synchronous-at-metadata check for an audio track on a video
 * element. No single API is reliable across browsers, so we layer them and
 * gracefully fall back to `false` (which just means "no audio dialog"). The
 * async audio decode in `analyzeAudio()` later corrects this when it can.
 */
function detectHasAudio(el: HTMLVideoElement): boolean {
  const probe = el as unknown as {
    audioTracks?: { length: number }
    mozHasAudio?: boolean
    webkitAudioDecodedByteCount?: number
  }
  if (probe.audioTracks) return probe.audioTracks.length > 0
  if (typeof probe.mozHasAudio === 'boolean') return probe.mozHasAudio
  if (typeof probe.webkitAudioDecodedByteCount === 'number') {
    return probe.webkitAudioDecodedByteCount > 0
  }
  return false
}

function dedupeKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

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
    hasAudio: detectHasAudio(el),
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
  maxDim: number,
): Promise<string> {
  const el = await loadMediaElement<HTMLVideoElement>('video', src, (video) => {
    video.currentTime = 0
  })

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener('seeked', onSeeked)
      el.removeEventListener('error', onError)
    }

    const onSeeked = () => {
      cleanup()
      try {
        resolve(drawToThumbnail(el, el.videoWidth, el.videoHeight, maxDim))
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

/**
 * Decode a small set of evenly-spaced frames from a video into JPEG data URLs.
 *
 * Uses a single plain `HTMLVideoElement` + seek (no coupling to the playback
 * decode stack) — these are decorative timeline tiles, not frame-accurate.
 * Seeks run sequentially because one element can only resolve one seek at a time.
 */
export async function makeVideoThumbnailStrip(
  src: string,
  count: number,
  maxDim: number,
): Promise<string[]> {
  const el = await loadMediaElement<HTMLVideoElement>('video', src, () => {})
  const duration = Number.isFinite(el.duration) ? el.duration : 0

  const seekTo = (time: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        el.removeEventListener('seeked', onSeeked)
        el.removeEventListener('error', onError)
      }
      const onSeeked = () => {
        cleanup()
        try {
          resolve(drawToThumbnail(el, el.videoWidth, el.videoHeight, maxDim))
        } catch (err) {
          reject(err)
        }
      }
      const onError = () => {
        cleanup()
        reject(new Error('Failed to seek video for thumbnail strip'))
      }
      el.addEventListener('seeked', onSeeked)
      el.addEventListener('error', onError)
      el.currentTime = time
    })

  const frames: string[] = []
  for (let i = 0; i < count; i++) {
    // Sample the middle of each segment so the first tile isn't a black frame.
    const time = duration > 0 ? ((i + 0.5) / count) * duration : 0
    frames.push(await seekTo(time))
  }
  return frames
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

/** Lazily-created, shared AudioContext for waveform decoding. */
let sharedAudioContext: AudioContext | null = null
function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    sharedAudioContext = new Ctor()
  }
  return sharedAudioContext
}

/**
 * Decode a source's audio into a small array of normalized (0..1) peaks.
 *
 * `decodeAudioData` pulls the audio track straight out of mp4/webm/ogg
 * containers, so this works for both audio files and videos-with-audio. Returns
 * `null` when the source has no decodable audio (e.g. a silent/muted video).
 */
export async function computeWaveform(src: string): Promise<Float32Array | null> {
  const res = await fetch(src)
  const buffer = await res.arrayBuffer()
  const audioBuffer = await getAudioContext().decodeAudioData(buffer)
  if (audioBuffer.length === 0) return null

  const channel = audioBuffer.getChannelData(0)
  const peaks = new Float32Array(WAVEFORM_PEAK_COUNT)
  const bucketSize = Math.max(1, Math.floor(channel.length / WAVEFORM_PEAK_COUNT))

  let globalMax = 0
  for (let i = 0; i < WAVEFORM_PEAK_COUNT; i++) {
    const start = i * bucketSize
    const end = Math.min(start + bucketSize, channel.length)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j])
      if (v > max) max = v
    }
    peaks[i] = max
    if (max > globalMax) globalMax = max
  }

  if (globalMax > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] /= globalMax
  }
  return peaks
}

/**
 * Generate thumbnails for an asset: a filmstrip for video (mid-frame doubles as
 * the panel thumbnail), a single thumbnail for image, nothing for audio.
 * Updates the store as results arrive.
 */
function scheduleThumbnail(asset: MediaAsset, maxDim: number): void {
  if (asset.kind === 'video') {
    void makeVideoThumbnailStrip(asset.src, THUMBNAIL_STRIP_COUNT, THUMBNAIL_STRIP_MAX_DIM)
      .then((strip) => {
        if (strip.length === 0) return
        useMediaLibraryStore.getState().updateAsset(asset.id, {
          thumbnailStrip: strip,
          thumbnailUrl: strip[Math.floor(strip.length / 2)],
        })
      })
      .catch((err) => {
        console.warn(`[importFiles] Thumbnail strip failed for "${asset.name}":`, err)
      })
    return
  }

  if (asset.kind === 'image') {
    void makeImageThumbnail(asset.src, maxDim)
      .then((thumbnailUrl) => {
        useMediaLibraryStore.getState().updateAsset(asset.id, { thumbnailUrl })
      })
      .catch((err) => {
        console.warn(`[importFiles] Thumbnail failed for "${asset.name}":`, err)
      })
  }
}

/**
 * Decode audio for video/audio sources. Sets `waveform` for rendering and
 * refines `hasAudio` (the import-time probe is best-effort; this is authoritative).
 */
function scheduleAudioAnalysis(asset: MediaAsset): void {
  if (asset.kind !== 'audio' && asset.kind !== 'video') return

  void computeWaveform(asset.src)
    .then((waveform) => {
      if (!waveform) {
        if (asset.kind === 'video') {
          useMediaLibraryStore.getState().updateAsset(asset.id, { hasAudio: false })
        }
        return
      }
      useMediaLibraryStore.getState().updateAsset(asset.id, {
        waveform,
        ...(asset.kind === 'video' ? { hasAudio: true } : {}),
      })
    })
    .catch(() => {
      // No decodable audio track (silent/muted video, or unsupported codec).
      if (asset.kind === 'video') {
        useMediaLibraryStore.getState().updateAsset(asset.id, { hasAudio: false })
      }
    })
}

async function importSingleFile(
  file: File,
  kind: MediaKind,
  thumbnailMaxDim: number,
): Promise<MediaAsset> {
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
    ...(kind === 'video' ? { hasAudio: metadata.hasAudio ?? false } : {}),
    byteSize: file.size,
    lastModified: file.lastModified,
    addedAt: Date.now(),
  }

  useMediaLibraryStore.getState().addAsset(asset)
  scheduleThumbnail(asset, thumbnailMaxDim)
  scheduleAudioAnalysis(asset)

  return asset
}

function partitionFiles(
  files: File[],
): { toImport: Array<{ file: File; kind: MediaKind }>; skipped: SkippedImport[] } {
  const storeAssets = useMediaLibraryStore.getState().assets
  const existingByKey = new Map<string, string>()
  for (const asset of Object.values(storeAssets)) {
    existingByKey.set(
      dedupeKey({ name: asset.name, size: asset.byteSize, lastModified: asset.lastModified }),
      asset.id,
    )
  }

  const batchKeys = new Set<string>()
  const toImport: Array<{ file: File; kind: MediaKind }> = []
  const skipped: SkippedImport[] = []

  for (const file of files) {
    const kind = inferKind(file.type)
    if (!kind) {
      console.warn(`[importFiles] Skipping unsupported file type: "${file.type}" (${file.name})`)
      skipped.push({ file, reason: 'unsupported' })
      continue
    }

    const key = dedupeKey(file)
    const existingAssetId = existingByKey.get(key)
    if (existingAssetId) {
      skipped.push({ file, reason: 'duplicate', existingAssetId })
      continue
    }

    if (batchKeys.has(key)) {
      skipped.push({ file, reason: 'duplicate' })
      continue
    }

    batchKeys.add(key)
    toImport.push({ file, kind })
  }

  return { toImport, skipped }
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
): Promise<ImportFilesResult> {
  const thumbnailMaxDim = opts?.thumbnailMaxDim ?? DEFAULT_THUMBNAIL_MAX_DIM
  const { toImport, skipped } = partitionFiles(files)
  const imported = await Promise.all(
    toImport.map(({ file, kind }) => importSingleFile(file, kind, thumbnailMaxDim)),
  )

  return { imported, skipped }
}
