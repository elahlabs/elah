import type { ClipMediaRef } from '../types'

/** Kind of media this asset represents. */
export type MediaKind = 'video' | 'audio' | 'image'

/** A tallied object/subject detected across a video's analyzed frames. */
export interface MediaAssetTopObject {
  name: string
  occurrences: number
}

/**
 * AI-generated understanding of a video's content (tags, summary, detected
 * objects), supplied by the host application at the moment
 * an asset is imported. Kept as a local shape here so core has no dependency
 * on any host application.
 */
export interface MediaAssetAnalysis {
  tags: string[]
  summary: string
  frameCount: number
  topObjects: MediaAssetTopObject[]
  durationSec: number
}

/** One timed thing seen in a source (AGN-P11). Times are SOURCE-relative seconds. */
export interface MediaAssetObservation {
  timestampSec: number
  /** What is visible at that time, cut to a short budget. */
  summary: string
  tags: string[]
}

/**
 * What the planner may know about the pictures in a local source (AGN-P11).
 * One field so it persists with the library snapshot, like `transcript`.
 *
 * `consentAt` is the user's recorded yes, for THIS asset, to send a handful
 * of sampled frames (never the file) to the host application for description. Absent
 * means no: nothing may leave the machine.
 */
export interface MediaAssetFootage {
  /** Epoch ms of the user's consent for this asset. Absent = not allowed. */
  consentAt?: number
  /** Timed observations, capped. Never holds a mock-provider description. */
  observations?: MediaAssetObservation[]
  /** `'not-analysed'` when the host application answered with a mock provider's output (or nothing usable). */
  state?: 'analysed' | 'partial' | 'not-analysed'
  /** Why the last run was not (fully) analysed, so the surface can say it honestly. */
  reason?: 'mock' | 'no-frames' | 'failed' | 'timeout'
  /** Epoch ms of the last run. */
  analysedAt?: number
}

/**
 * What makes an image asset a durable vector (SVG-1a). `MediaKind` deliberately has no vector member (81
 * exhaustive sites), so an SVG stays `kind: 'image'` and carries this record: where it came from, its text when
 * small, and the real hosted URL once it has been uploaded.
 */
export interface MediaAssetVector {
  origin: 'upload' | 'iconify' | 'model'
  /** SVG text when at most `VECTOR_INLINE_MAX_CHARS`; otherwise fetched from `src`. */
  svg?: string
  /** The real hosted URL (unproxied) once uploaded. */
  hostedUrl?: string
  source?: { provider: string; set: string; setName?: string; name: string; licence: string; pageUrl: string; author?: string }
  authored?: { name: string; description?: string; model?: string }
}

/**
 * A single piece of source media registered in the editor's MediaLibrary.
 * Clips reference assets by `id`; the asset owns the metadata (duration,
 * dimensions, source fps, thumbnail) so multiple clips can share a source
 * without duplicating it.
 */
export interface MediaAsset {
  id: string
  kind: MediaKind
  name: string
  /** Object URL, blob URL, or persisted asset URL. */
  src: string
  /** Source duration in seconds. */
  durationSec: number
  width?: number
  height?: number
  /** Intrinsic frame rate of the source. Undefined for audio / image. */
  sourceFps?: number
  /** Whether a video source carries an audio track. Set during import (best-effort
   * sync probe, refined by async audio decode). Undefined for audio / image. */
  hasAudio?: boolean
  /** Single representative thumbnail (mid-frame for video). Used by the AssetPanel. */
  thumbnailUrl?: string
  /** A few evenly-spaced frames decoded once per video asset, tiled across the
   * timeline clip to fake a filmstrip. Undefined for audio. */
  thumbnailStrip?: string[]
  /** Normalized (0..1) waveform peaks for audio/video sources with audio. */
  waveform?: Float32Array
  byteSize: number
  /** Local-file reference stamped onto clips at save time (LM-P1). */
  media?: ClipMediaRef
  /** File last-modified timestamp from the source `File`. Used for dedupe. */
  lastModified: number
  /** Epoch ms. Used for display order and tie-breaking. */
  addedAt: number
  /**
   * AI content analysis of this source, produced by the host application's async
   * pipeline. Set at import for a source whose analysis had already
   * completed, and otherwise patched in later by the host application once the pipeline
   * finishes (uploads have no analysis at import time by definition). So it is undefined until analysis
   * lands, and stays undefined for a source that was never analyzed or whose
   * analysis failed. Consumed by caption auto-generation and by narration
   * drafting.
   */
  analysis?: MediaAssetAnalysis
  /**
   * `'pending'` while metadata (duration/dimensions) is still being probed from
   * a remote URL — `durationSec`/`width`/`height` hold provisional/fallback
   * values until this flips to `'ready'`. Undefined (treated as `'ready'`) for
   * every asset registered the normal, synchronously-probed way.
   */
  status?: 'pending' | 'ready'
  /**
   * Video only (PV-P8): the container says the video track may carry alpha
   * (mediabunny `canBeTransparent()`). The editor decodes video opaque; a
   * paired `<name>_matte.*` file is how such a clip is cut out. Absent = no
   * or unknown.
   */
  hasAlpha?: boolean
  /**
   * Image only (PV-P8): the file has more than one frame. `sourceFps` then
   * holds its frame rate and `durationSec` one cycle (frameCount / fps).
   */
  animated?: boolean
  /**
   * A whole-source transcript, cached after one paid speech-to-text run
   * (AGN-P3). Times are SOURCE-relative seconds (0 is the start of the file,
   * not of any clip cut from it). Undefined until a run has landed.
   */
  transcript?: {
    words: Array<{ text: string; startSeconds: number; endSeconds: number }>
    language: string | null
    taskId: string
    createdAt: number
  }
  /** What the picture shows at given times, with the user's per-asset consent (AGN-P11). */
  footage?: MediaAssetFootage
  /** Image only (SVG-1a): this picture is an SVG; where it came from and where it is stored. */
  vector?: MediaAssetVector
}

/** MIME type used on `dataTransfer` for drags originating from the AssetPanel. */
export const MEDIA_DRAG_MIME = 'application/x-elah-media'

/** Payload encoded into `dataTransfer.getData(MEDIA_DRAG_MIME)`. */
export interface DragMediaPayload {
  kind: 'media-asset'
  assetId: string
}

/**
 * Extra `dataTransfer` type set alongside {@link MEDIA_DRAG_MIME} that encodes
 * the asset's `MediaKind`. `dataTransfer.getData` is only readable on `drop`
 * in most browsers, but `dataTransfer.types` is readable throughout the drag —
 * so this lets drop targets show a compatible/incompatible highlight on
 * dragenter/dragover, before the actual payload can be read.
 */
export function mediaDragKindMime(kind: MediaKind): string {
  return `application/x-elah-media-kind-${kind}`
}
