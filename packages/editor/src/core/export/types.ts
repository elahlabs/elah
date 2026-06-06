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
}

export interface ExportProgress {
  frame: number
  totalFrames: number
}

// ---------------------------------------------------------------------------
// Internal Worker message protocol (not part of the public API)
// ---------------------------------------------------------------------------

export type WorkerInMessage =
  | { type: 'start'; project: unknown; options: ExportOptions }

export type WorkerOutMessage =
  | { type: 'progress'; frame: number; totalFrames: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'error'; message: string }
