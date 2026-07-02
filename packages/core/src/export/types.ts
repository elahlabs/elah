import type { AudioResolver } from '../media/audio/audioResolver'

export type ExportVideoCodec = 'avc' | 'vp9' | 'vp8'
export type ExportAudioCodec = 'aac' | 'opus'

export interface ExportOptions {
  videoCodec?: ExportVideoCodec
  audioCodec?: ExportAudioCodec
  /** Target video bitrate in bits/s. Default 8 Mbps. */
  videoBitrate?: number
  /** Target audio bitrate in bits/s. Default 128 kbps. */
  audioBitrate?: number
  onProgress?: (progress: ExportProgress) => void
  /** Abort signal — reject the export promise and terminate the worker when aborted. */
  signal?: AbortSignal
  /** Injectable URL→bytes seam for the audio mix (CDN/auth/proxy overrides). Defaults to fetch(src).arrayBuffer(). */
  audioResolver?: AudioResolver
  /** Called once per audio clip that failed to fetch/decode and was skipped from the mix. */
  onAudioIssue?: (message: string, src: string | undefined) => void
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

export type WorkerInMessage = {
  type: 'start'
  project: unknown
  options: ExportOptions
  audio: RenderedAudio | null
}

export type WorkerOutMessage =
  | { type: 'progress'; frame: number; totalFrames: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'error'; message: string }
