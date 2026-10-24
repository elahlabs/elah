import { generateId } from '../utils/id'
import { mediaLibraryStore } from './store'
import { determineAssetHasAudio, hasAudioDetermined } from './hasAudio'
import { defaultAudioResolver, type AudioResolver } from '../media/audio/audioResolver'
import { sourceBlobCache } from '../media/video/demuxer/sourceBlobCache'
import {
  NoAudioTrackError,
  STREAM_AUDIO_ABOVE_BYTES,
  streamPeaks,
  type StreamPeaksOptions,
} from '../media/audio/streamDecode'
import { probeAnimatedImageSrc } from '../media/sequence/probeAnimatedImage'
import { probeHasAlpha } from '../media/video/alphaProbe'
import type { MediaAsset, MediaAssetAnalysis, MediaKind } from './types'

export interface ImportFilesOptions {
  /** Reserved for clip creation when source fps is unknown. Not used during import. */
  fallbackFps?: number
  /** Max width/height for generated thumbnails. Default 240. */
  thumbnailMaxDim?: number
}

export interface ImportUrlOptions extends ImportFilesOptions {
  /** Display name. Defaults to the last decoded path segment of the URL. */
  name?: string
  /** Override the media kind instead of inferring it from the URL/content-type. */
  kind?: MediaKind
  /**
   * AI content analysis to carry over onto the created asset, when importing
   * from a source whose analysis has already completed. See
   * `MediaAsset.analysis`.
   */
  analysis?: MediaAssetAnalysis
}

export interface ImportBlobOptions extends ImportFilesOptions {
  /** Display name. Defaults to a generated name from the blob's MIME type. */
  name?: string
  /** Override the media kind instead of inferring it from the blob's MIME type. */
  kind?: MediaKind
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
/** Provisional duration (seconds) for a pending URL import, before the real
 * duration is probed. Matches the fallback `insertMediaAsset` already uses
 * for zero-duration assets, so the placeholder clip's width doesn't jump
 * twice (once at insert, once when probing finishes). */
const PENDING_FALLBACK_DURATION_SEC = 5

/** Number of frames sampled across a video to fake a filmstrip in the timeline. */
const THUMBNAIL_STRIP_COUNT = 4
/** Max width/height for filmstrip tiles — small; they're decorative. */
const THUMBNAIL_STRIP_MAX_DIM = 160
/** Number of normalized peaks stored per audio source. */
const WAVEFORM_PEAK_COUNT = 256

/**
 * Best-effort, synchronous-at-metadata check for an audio track on a video
 * element. No single API is reliable across browsers, so we layer them and
 * gracefully fall back to `false`. Chromium in particular answers `false` for
 * every video here — `determineAssetHasAudio()` (container probe) is what
 * actually decides, and it corrects this seed as soon as it resolves.
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

/** File-extension → media kind. `.ogg` is ambiguous; default to audio (override via opts.kind). */
const EXTENSION_KIND: Record<string, MediaKind> = {
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  mkv: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  oga: 'audio',
  flac: 'audio',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  svg: 'image',
}

/** Whether a source is an http(s) URL (vs. a blob:/data:/object URL). */
function isHttpUrl(src: string): boolean {
  return /^https?:/i.test(src)
}

/** Parse a URL's pathname, tolerating relative URLs and query/hash suffixes. */
function urlPathname(url: string): string {
  try {
    return new URL(url, 'http://_').pathname
  } catch {
    return url.split(/[?#]/)[0]
  }
}

function inferKindFromUrl(url: string): MediaKind | null {
  const path = urlPathname(url)
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_KIND[ext] ?? null
}

/** Derive a human-ish name from a URL's last path segment. */
function deriveNameFromUrl(url: string): string {
  const path = urlPathname(url)
  const last = path.split('/').filter(Boolean).pop() ?? ''
  try {
    return decodeURIComponent(last) || 'media'
  } catch {
    return last || 'media'
  }
}

/** Best-effort kind from a HEAD request's Content-Type. Returns null if blocked/unknown. */
async function inferKindFromHead(url: string): Promise<MediaKind | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    return inferKind(contentType)
  } catch {
    return null
  }
}

/** Generate a fallback name for a blob with no filename, e.g. `clip.mp4` / `media`. */
function generateBlobName(kind: MediaKind, mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim()
  const ext = subtype ? `.${subtype}` : ''
  const base = kind === 'video' ? 'clip' : kind === 'audio' ? 'audio' : 'image'
  return `${base}${ext}`
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
    // Cross-origin sources (e.g. CDN URLs) must opt into CORS, otherwise frames
    // drawn to a canvas taint it and `toDataURL()` throws (no thumbnails).
    // Harmless for same-origin / blob: / data: sources.
    if (isHttpUrl(src)) el.crossOrigin = 'anonymous'

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
      releaseMediaElement(el)
      reject(new Error(`Failed to load ${tag} metadata`))
    }

    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('error', onError)
    el.src = src
  })
}

/**
 * Detach a probe/thumbnail media element from its source so the browser frees
 * its media pipeline immediately. Chromium pins a hardware decoder per element
 * with a live src; letting these wait for GC starves the WebCodecs playback
 * pipeline of decoders on import-heavy sessions.
 */
function releaseMediaElement(el: HTMLMediaElement): void {
  try {
    el.pause()
    el.removeAttribute('src')
    el.load()
  } catch {
    // Best-effort teardown.
  }
}

/**
 * Resolve a finite duration from a loaded media element.
 *
 * Chromium can report `el.duration === Infinity` at `loadedmetadata` for
 * media without a container-level duration atom (e.g. freshly-generated /
 * proxied audio) until a seek past the end forces it to compute the real
 * value. Falls back to `0` (this file's existing "unknown duration"
 * convention, see `makeVideoThumbnailStrip`) if even that doesn't resolve.
 */
function resolveDuration(el: HTMLMediaElement): Promise<number> {
  if (Number.isFinite(el.duration)) return Promise.resolve(el.duration)

  return new Promise((resolve) => {
    const finish = (value: number) => {
      el.removeEventListener('durationchange', onChange)
      clearTimeout(timer)
      el.currentTime = 0
      resolve(value)
    }
    const onChange = () => {
      if (Number.isFinite(el.duration)) finish(el.duration)
    }
    el.addEventListener('durationchange', onChange)
    el.currentTime = 1e101
    const timer = setTimeout(() => finish(Number.isFinite(el.duration) ? el.duration : 0), 2000)
  })
}

export async function probeVideo(src: string): Promise<ProbedMetadata> {
  const el = await loadMediaElement<HTMLVideoElement>('video', src, () => {})
  try {
    return {
      durationSec: await resolveDuration(el),
      width: el.videoWidth,
      height: el.videoHeight,
      hasAudio: detectHasAudio(el),
    }
  } finally {
    releaseMediaElement(el)
  }
}

export async function probeAudio(src: string): Promise<ProbedMetadata> {
  const el = await loadMediaElement<HTMLAudioElement>('audio', src, () => {})
  try {
    return {
      durationSec: await resolveDuration(el),
    }
  } finally {
    releaseMediaElement(el)
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

  return new Promise<string>((resolve, reject) => {
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
  }).finally(() => releaseMediaElement(el))
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

  try {
    const frames: string[] = []
    for (let i = 0; i < count; i++) {
      // Sample the middle of each segment so the first tile isn't a black frame.
      const time = duration > 0 ? ((i + 0.5) / count) * duration : 0
      frames.push(await seekTo(time))
    }
    return frames
  } finally {
    releaseMediaElement(el)
  }
}

export async function makeImageThumbnail(src: string, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    // Same CORS requirement as video frames — needed to draw onto a canvas.
    if (isHttpUrl(src)) img.crossOrigin = 'anonymous'

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
 * Largest source the WHOLE-FILE decode (`decodeAudioData`) is still asked to
 * handle (LM-P1). Since LM-P5 a larger source is not skipped: it streams (see
 * `computeStreamedWaveform`). This bound now only matters for a source that
 * cannot be streamed, e.g. a codec WebCodecs has no decoder for.
 */
export const LARGE_LOCAL_SOURCE_BYTES = 2 * 1024 ** 3

/**
 * Whether the whole-file decode may be used for this asset. False above
 * `LARGE_LOCAL_SOURCE_BYTES`, where only streaming works.
 */
export function shouldDecodeWaveform(asset: { byteSize: number }): boolean {
  return !(asset.byteSize > LARGE_LOCAL_SOURCE_BYTES)
}

/** Whether this asset's audio should be read by range rather than decoded whole (LM-P5). */
export function shouldStreamAudio(asset: { byteSize: number }): boolean {
  return asset.byteSize > STREAM_AUDIO_ABOVE_BYTES
}

/**
 * `computeWaveform` for a large source: the audio is walked in windows with a
 * running max per bucket, so memory does not grow with the file. A pinned local
 * file is read from its Blob; an http(s) source is read by range requests; any
 * other source is materialised through the shared blob cache. `null` when the
 * file has no audio track.
 */
export async function computeStreamedWaveform(
  src: string,
  opts: StreamPeaksOptions & { blobFor?: (src: string) => Blob | undefined } = {},
): Promise<Float32Array | null> {
  const pinned = (opts.blobFor ?? ((u: string) => sourceBlobCache.pinnedBlob(u)))(src)
  const source: Blob | string = pinned ?? (/^https?:/i.test(src) ? src : await sourceBlobCache.resolve(src))
  try {
    return await streamPeaks(source, WAVEFORM_PEAK_COUNT, opts)
  } catch (err) {
    if (err instanceof NoAudioTrackError) return null
    throw err
  }
}

/**
 * Decode a source's audio into a small array of normalized (0..1) peaks.
 *
 * `decodeAudioData` pulls the audio track straight out of mp4/webm/ogg
 * containers, so this works for both audio files and videos-with-audio. Returns
 * `null` when the source has no decodable audio (e.g. a silent/muted video).
 */
export async function computeWaveform(
  src: string,
  audioResolver: AudioResolver = defaultAudioResolver,
): Promise<Float32Array | null> {
  const buffer = await audioResolver(src)
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
        mediaLibraryStore.getState().updateAsset(asset.id, {
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
        mediaLibraryStore.getState().updateAsset(asset.id, { thumbnailUrl })
      })
      .catch((err) => {
        console.warn(`[importFiles] Thumbnail failed for "${asset.name}":`, err)
      })
  }
}

/**
 * Decode audio for video/audio sources. Sets `waveform` for rendering and
 * refines `hasAudio` where it can.
 *
 * A successful decode proves there is audio, so it may promote `hasAudio` to
 * `true`. A failed one proves nothing — CORS and unsupported codecs fail the
 * same way silence does — so it only writes `false` while the container probe
 * (`determineAssetHasAudio`) has yet to answer, and never overrules it.
 */
function scheduleAudioAnalysis(asset: MediaAsset): void {
  if (asset.kind !== 'audio' && asset.kind !== 'video') return
  const markSilent = () => {
    if (asset.kind !== 'video' || hasAudioDetermined(asset.id)) return
    mediaLibraryStore.getState().updateAsset(asset.id, { hasAudio: false })
  }

  // LM-P5: a large source streams; the whole-file decode stays for small ones and
  // is the fallback for a mid-size file that cannot be streamed. A file too big
  // for either simply has no waveform.
  const compute: Promise<Float32Array | null> = shouldStreamAudio(asset)
    ? computeStreamedWaveform(asset.src).catch((err) => {
        if (!shouldDecodeWaveform(asset)) throw err
        return computeWaveform(asset.src)
      })
    : computeWaveform(asset.src)

  void compute
    .then((waveform) => {
      if (!waveform) {
        markSilent()
        return
      }
      mediaLibraryStore.getState().updateAsset(asset.id, {
        waveform,
        ...(asset.kind === 'video' ? { hasAudio: true } : {}),
      })
    })
    .catch(markSilent)
}

/**
 * Regenerate thumbnails for an asset already in the library.
 *
 * Import is normally the only thing that makes thumbnails, because import is
 * normally the only way an asset gets into the library. Restoring a saved
 * composition is the exception: the library is rebuilt from a stored snapshot,
 * and an entry whose thumbnails were never captured (or were captured before a
 * failed decode) would otherwise show the timeline's grey placeholder forever.
 *
 * No-op for an unknown id or an audio asset, which has no thumbnail to make.
 */
export function scheduleThumbnailById(assetId: string): void {
  const asset = mediaLibraryStore.getState().getAsset(assetId)
  if (!asset) return
  scheduleThumbnail(asset, DEFAULT_THUMBNAIL_MAX_DIM)
}

interface RegisterAssetInput {
  kind: MediaKind
  name: string
  /** Source URL: object URL (file/blob) or a direct http(s)/data URL. */
  src: string
  byteSize: number
  lastModified: number
  thumbnailMaxDim: number
}

/**
 * Probe a source, register it as a `MediaAsset` in the store, and schedule its
 * thumbnail + waveform generation. Shared by every import path (file/url/blob).
 */
async function registerAsset(input: RegisterAssetInput): Promise<MediaAsset> {
  const metadata = await probeMetadata(input.kind, input.src)
  // Animated-image probe (PV-P8d): only images are candidates, and
  // `probeAnimatedImageSrc` itself returns null before fetching anything
  // when `ImageDecoder` is unavailable (node tests) or the extension isn't
  // animatable — so this never delays a still-image import.
  const anim = input.kind === 'image' ? await probeAnimatedImageSrc(input.src, input.name) : null

  const asset: MediaAsset = {
    id: generateId(),
    kind: input.kind,
    name: input.name,
    src: input.src,
    durationSec: metadata.durationSec,
    width: metadata.width,
    height: metadata.height,
    ...(input.kind === 'video' ? { hasAudio: metadata.hasAudio ?? false } : {}),
    byteSize: input.byteSize,
    lastModified: input.lastModified,
    addedAt: Date.now(),
    // Only set when the probe found real animation — a still image's asset
    // is the exact object it always was.
    ...(anim
      ? {
          animated: true as const,
          sourceFps: anim.fps,
          durationSec: anim.frameCount / anim.fps,
          width: anim.width,
          height: anim.height,
        }
      : {}),
  }

  mediaLibraryStore.getState().addAsset(asset)
  scheduleThumbnail(asset, input.thumbnailMaxDim)
  scheduleAudioAnalysis(asset)
  // The `hasAudio` seeded above is only the element probe's guess; start the
  // authoritative container read now so it has settled by the time the asset is
  // dropped on the timeline and the video/audio split prompt has to decide.
  if (asset.kind === 'video') {
    void determineAssetHasAudio(asset.id)
    // Container alpha probe (PV-P8d): fire-and-forget, like the audio probe
    // above — in node (tests) it fails silently with no network.
    void probeHasAlpha(asset.src)
      .then((hasAlpha) => {
        if (hasAlpha) mediaLibraryStore.getState().updateAsset(asset.id, { hasAlpha: true })
      })
      .catch(() => {})
  }

  return asset
}

function importSingleFile(
  file: File,
  kind: MediaKind,
  thumbnailMaxDim: number,
): Promise<MediaAsset> {
  return registerAsset({
    kind,
    name: file.name,
    src: URL.createObjectURL(file),
    byteSize: file.size,
    lastModified: file.lastModified,
    thumbnailMaxDim,
  })
}

function partitionFiles(
  files: Iterable<File>,
): { toImport: Array<{ file: File; kind: MediaKind }>; skipped: SkippedImport[] } {
  const storeAssets = mediaLibraryStore.getState().assets
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
 * `mediaLibraryStore`, and generates thumbnails asynchronously on the main
 * thread.
 */
export async function importFiles(
  files: Iterable<File>,
  opts?: ImportFilesOptions,
): Promise<ImportFilesResult> {
  const thumbnailMaxDim = opts?.thumbnailMaxDim ?? DEFAULT_THUMBNAIL_MAX_DIM
  const { toImport, skipped } = partitionFiles(files)
  const imported = await Promise.all(
    toImport.map(({ file, kind }) => importSingleFile(file, kind, thumbnailMaxDim)),
  )

  return { imported, skipped }
}

/**
 * Import a media source by URL (e.g. a CDN asset) into the media library.
 *
 * The URL is used directly as the asset `src` — the probe and decode pipeline
 * accept http(s) URLs, so no download/object-URL conversion happens here.
 * Thumbnail and waveform generation `fetch()` the source later, which requires
 * the origin to allow CORS.
 *
 * Re-importing a URL that is already in the library returns the existing asset.
 * The kind is taken from `opts.kind`, else the file extension, else a `HEAD`
 * content-type probe; throws if none of those determine a supported media kind.
 */
export async function importUrl(url: string, opts?: ImportUrlOptions): Promise<MediaAsset> {
  const existing = Object.values(mediaLibraryStore.getState().assets).find(
    (asset) => asset.src === url,
  )
  if (existing) return existing

  const kind = opts?.kind ?? inferKindFromUrl(url) ?? (await inferKindFromHead(url))
  if (!kind) {
    throw new Error(`[importUrl] Could not determine media kind for "${url}"`)
  }

  return registerAsset({
    kind,
    name: opts?.name ?? deriveNameFromUrl(url),
    src: url,
    // Unknown without downloading the source; URLs dedupe on `src`, not size.
    byteSize: 0,
    lastModified: Date.now(),
    thumbnailMaxDim: opts?.thumbnailMaxDim ?? DEFAULT_THUMBNAIL_MAX_DIM,
  })
}

/**
 * Like {@link importUrl}, but returns a `status: 'pending'` asset immediately
 * instead of awaiting metadata — for callers (e.g. "add to timeline" from a
 * remote media list) that want to place a clip right away and let it resize
 * itself once the real duration/dimensions arrive, rather than blocking on
 * CDN latency. `opts.dimensions`, if known upfront (e.g. from the host application's
 * response), seeds `width`/`height` so the placeholder's aspect ratio is
 * already correct.
 *
 * Callers that need the resolved metadata should use `importUrl` instead —
 * this one only guarantees `id`/`kind`/`src` are final; everything else may
 * still change (see the store update once `status` flips to `'ready'`).
 */
export async function beginImportUrl(
  url: string,
  opts?: ImportUrlOptions & { dimensions?: { width: number; height: number } },
): Promise<MediaAsset> {
  const existing = Object.values(mediaLibraryStore.getState().assets).find(
    (asset) => asset.src === url,
  )
  if (existing) return existing

  const kind = opts?.kind ?? inferKindFromUrl(url) ?? (await inferKindFromHead(url))
  if (!kind) {
    throw new Error(`[beginImportUrl] Could not determine media kind for "${url}"`)
  }

  const asset: MediaAsset = {
    id: generateId(),
    kind,
    name: opts?.name ?? deriveNameFromUrl(url),
    src: url,
    durationSec: kind === 'image' ? 0 : PENDING_FALLBACK_DURATION_SEC,
    width: opts?.dimensions?.width,
    height: opts?.dimensions?.height,
    ...(kind === 'video' ? { hasAudio: false } : {}),
    byteSize: 0,
    lastModified: Date.now(),
    addedAt: Date.now(),
    status: 'pending',
    ...(opts?.analysis ? { analysis: opts.analysis } : {}),
  }

  mediaLibraryStore.getState().addAsset(asset)

  // Runs in parallel with the metadata probe below, not after it: callers that
  // import and insert in the same click (a remote list's "add to editor") would
  // otherwise decide the video/audio split against the `hasAudio: false` seed
  // above and drop a video with sound as video-only.
  if (kind === 'video') void determineAssetHasAudio(asset.id)

  const thumbnailMaxDim = opts?.thumbnailMaxDim ?? DEFAULT_THUMBNAIL_MAX_DIM
  void probeMetadata(kind, url)
    .then((metadata) => {
      // `hasAudio` is deliberately absent — the container probe above owns it,
      // and `metadata.hasAudio` is the guess that would clobber a real answer.
      mediaLibraryStore.getState().updateAsset(asset.id, {
        durationSec: metadata.durationSec,
        width: metadata.width ?? asset.width,
        height: metadata.height ?? asset.height,
        status: 'ready',
      })
      const ready = mediaLibraryStore.getState().getAsset(asset.id)
      if (ready) {
        scheduleThumbnail(ready, thumbnailMaxDim)
        scheduleAudioAnalysis(ready)
      }
    })
    .catch((err) => {
      console.warn(`[beginImportUrl] Metadata probe failed for "${asset.name}":`, err)
      mediaLibraryStore.getState().updateAsset(asset.id, { status: 'ready' })
    })

  return asset
}

/**
 * Import an in-memory `Blob` into the media library.
 *
 * Wraps the blob in an object URL and runs the same probe/thumbnail/waveform
 * pipeline as `importFiles`. The kind is taken from `opts.kind`, else the blob's
 * MIME type; throws if neither yields a supported media kind.
 */
export async function importBlob(blob: Blob, opts?: ImportBlobOptions): Promise<MediaAsset> {
  const kind = opts?.kind ?? inferKind(blob.type)
  if (!kind) {
    throw new Error(`[importBlob] Unsupported blob type: "${blob.type || 'unknown'}"`)
  }

  return registerAsset({
    kind,
    name: opts?.name ?? generateBlobName(kind, blob.type),
    src: URL.createObjectURL(blob),
    byteSize: blob.size,
    lastModified: Date.now(),
    thumbnailMaxDim: opts?.thumbnailMaxDim ?? DEFAULT_THUMBNAIL_MAX_DIM,
  })
}
