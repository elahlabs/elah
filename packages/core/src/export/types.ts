import type { AudioResolver } from '../media/audio/audioResolver'
import type { ExportRangeMode } from './range'

/**
 * REN-5: 'hevc' (MP4 only) and 'av1' (MP4 or WebM) are accepted only where
 * VideoEncoder.isConfigSupported says yes (ensureVideoCodecSupport in
 * export/capabilities.ts). The default stays 'avc'.
 */
export type ExportVideoCodec = 'avc' | 'hevc' | 'av1' | 'vp9' | 'vp8'
export type ExportAudioCodec = 'aac' | 'opus'
/**
 * PV-P9a-1: the output container. `'png-sequence'` is typed now (P9a-2 owns
 * its transport) and rejects with a clear message until then. Absent =
 * `'mp4'`, exactly today's behaviour.
 */
export type ExportContainer = 'mp4' | 'webm' | 'png-sequence' | 'gif'

/**
 * A sink for a streamed PNG-sequence export (PV-P9a-2): written to one frame
 * at a time, in order, and the next frame is never written until this one's
 * promise settles — that discipline is what keeps a PNG export's memory
 * bounded regardless of its frame count. Main-thread only — a function
 * can't survive `postMessage`'s structured clone, so a `FrameSink` is never
 * passed to the worker; `exportVideo` strips it before posting the `start`
 * message and replaces it with the `pngSinkMode` boolean the worker logs.
 */
export interface FrameSink {
  /** Write one frame. Called strictly in order (frame 0, then 1, …). */
  write(name: string, data: Uint8Array): Promise<void>
  /** Called once, after every frame has written successfully. */
  close(): Promise<void>
  /**
   * Called at most once, instead of `close`, if the export fails or is
   * aborted. Frames already written are left in place — never deleted.
   */
  abort(reason: unknown): Promise<void>
}

export interface ExportOptions {
  videoCodec?: ExportVideoCodec
  audioCodec?: ExportAudioCodec
  /**
   * Output container (PV-P9a-1). Default `'mp4'` — every export without this
   * option is byte-for-byte what it was before. `resolveExportFormat`
   * (`export/capabilities.ts`) validates the combination with `videoCodec`/
   * `audioCodec`/`transparent` before the worker is spawned.
   */
  container?: ExportContainer
  /**
   * Transparent output (PV-P9a-1). Only WebM can carry it, and only when this
   * runtime's own encode→decode round trip verifies it — see
   * `ensureTransparencyGate`/`webmAlphaExportSupported` in
   * `export/capabilities.ts`. MP4 with `transparent: true` always rejects.
   * Default `false`.
   */
  transparent?: boolean
  /**
   * Which part of the timeline to export (PV-P9a-1): `'all'` (default,
   * unchanged) or `'inOut'` for the project's marked in/out range. Resolved
   * by `resolveExportRange` (`export/range.ts`) before any asset fetch or
   * audio decode; an empty/invalid range rejects the export immediately.
   */
  range?: ExportRangeMode
  /**
   * Where PNG-sequence frames go (PV-P9a-2). Only meaningful with
   * `container: 'png-sequence'`. Absent: `exportVideo` buffers frames into a
   * bounded in-memory ZIP itself (`export/pngSink.ts`'s `createZipFrameSink`,
   * capped at 128 MiB / 10,000 files) and resolves an `application/zip`
   * Blob. Present (e.g. a directory sink from a File System Access picker,
   * PV-P9a-3's UI): `exportVideo` writes each frame to it instead and
   * resolves an EMPTY `application/octet-stream` Blob — a caller must not
   * try to download that Blob as if it were the export.
   */
  frameSink?: FrameSink
  /**
   * Internal (PV-P9a-2). Set by `exportVideo` before posting the `start`
   * message — `true` when the caller passed a `frameSink`. The worker
   * cannot see `frameSink` itself (functions don't survive `postMessage`)
   * and uses this boolean only for its own tracing; it does not change how
   * frames are produced. Not part of the public API — a caller should not
   * set this directly.
   */
  pngSinkMode?: boolean
  /** Target video bitrate in bits/s. Default 8 Mbps. */
  videoBitrate?: number
  /**
   * Target pixel count for the stage's *short* edge (e.g. 360, 480, 720,
   * 1080) — matching how "1080p" means 1920x1080 landscape or 1080x1920
   * portrait. The other edge is derived from the project stage's aspect ratio
   * and rounded to an even number (required by most video codecs). Defaults
   * to the stage's native short edge — no scaling. For container 'gif' the
   * default is capped at GIF_DEFAULT_MAX_SHORT_EDGE (480); an explicit value
   * overrides that cap.
   */
  outputHeight?: number
  /** Target audio bitrate in bits/s. Default 128 kbps. Rejected for container 'gif' (no audio). */
  audioBitrate?: number
  /**
   * GIF only (REN-5). Frames per second of the GIF; the project is still
   * rendered at its own fps and frames are dropped to this rate. Default
   * GIF_DEFAULT_MAX_FPS (15), never above the project's fps.
   */
  gifFps?: number
  onProgress?: (progress: ExportProgress) => void
  /** Abort signal — reject the export promise and terminate the worker when aborted. */
  signal?: AbortSignal
  /** Injectable URL→bytes seam for the audio mix (CDN/auth/proxy overrides). Defaults to fetch(src).arrayBuffer(). */
  audioResolver?: AudioResolver
  /** Called once per audio clip that failed to fetch/decode and was skipped from the mix. */
  onAudioIssue?: (message: string, src: string | undefined) => void
  /**
   * Where bundled fonts are served (PV-P4a). Default `{ baseUrl: DEFAULT_FONT_BASE_URL }`
   * ('/fonts/'); exportVideo resolves it against the page URL, because the
   * worker resolves relative URLs against its own script URL.
   */
  fonts?: { baseUrl: string }
  /** Called once per bundled font face that could not be loaded in the worker; text falls back to the generic family. */
  onFontIssue?: (message: string) => void
  /**
   * Bitmaps the main thread decoded for sources the worker cannot decode
   * (SVG), keyed by the clip `src`. The worker uses an entry instead of
   * fetching that src. exportVideo fills the SVG entries itself; a caller may
   * pass more. The bitmaps are TRANSFERRED to the worker and are unusable by
   * the caller afterwards.
   */
  preDecoded?: Record<string, ImageBitmap>
  /**
   * Source bytes the caller already holds, keyed by the clip `src` (LM-P1):
   * the lazy `File`s of local media. The worker reads a video, image or
   * animated-image src from here instead of `fetch`ing it, and the main-thread
   * audio mix resolves a src from here before `audioResolver`. Posted with the
   * `start` message (Blobs structured-clone by reference).
   */
  sources?: Record<string, Blob>
  /**
   * Non-fatal notes from the export, e.g. a sequence exported as a still
   * (PV-P8c) because the worker cannot decode it, or a sequence source that
   * could not be read and was left out. Called for every `warning` message
   * the worker posts, including the font-fallback ones `onFontIssue` also
   * receives — this is the general channel, `onFontIssue` the font-specific
   * one; a caller only interested in one kind can ignore the other.
   */
  onWarning?: (message: string) => void
}

export interface ExportProgress {
  frame: number
  totalFrames: number
}

/**
 * A fully-mixed audio track, rendered on the main thread (the Web Audio API is
 * not available inside Web Workers) and transferred into the ExportWorker.
 *
 * `channels` holds one planar Float32 PCM buffer per channel, each `length`
 * frames long. The buffers are transferred (not copied) across the worker
 * boundary, so they are detached on the main thread after posting.
 */
export interface RenderedAudio {
  sampleRate: number
  numberOfChannels: number
  /** Frames per channel. */
  length: number
  /** One Float32 planar PCM buffer per channel. */
  channels: ArrayBuffer[]
}

// ---------------------------------------------------------------------------
// Internal Worker message protocol (not part of the public API)
// ---------------------------------------------------------------------------

export type WorkerInMessage =
  | { type: 'start'; project: unknown; options: ExportOptions; audio: RenderedAudio | null }
  /** PV-P9a-2: acknowledges `png-frame` `index`, unblocking the worker's next frame. */
  | { type: 'png-ack'; index: number }

export type WorkerOutMessage =
  | { type: 'progress'; frame: number; totalFrames: number }
  /**
   * PV-P9a-1: `mimeType`/`container` travel with the buffer so the main
   * thread builds the `Blob` with the container it actually got (MP4 or
   * WebM) instead of a hardcoded `'video/mp4'` — the worker is the only side
   * that constructed the mediabunny `Output` and therefore the only side
   * that truly knows which one it used.
   */
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; container: string }
  | { type: 'error'; message: string; code?: 'capability' }
  /**
   * PV-P9a-2: one PNG-sequence frame, transferred (not copied) from the
   * worker. The main thread must write (or buffer) it and reply `png-ack`
   * before the worker encodes the next one — see `export/pngSink.ts`'s
   * `FrameAckGate` (worker side) and `createPngFrameReceiver` (main side).
   */
  | { type: 'png-frame'; index: number; name: string; buffer: ArrayBuffer }
  /**
   * PV-P4a-2: a non-fatal problem the worker recovered from — a bundled font
   * face that would not load. It is NOT an error, because the export still
   * succeeds with the generic fallback family; surfacing it as `error` would
   * reject a perfectly good video over a missing woff2.
   */
  | { type: 'warning'; message: string }
