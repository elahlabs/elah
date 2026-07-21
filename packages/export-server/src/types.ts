/**
 * Shared types for @elah/export-server.
 *
 * This file is the seam that makes the ffmpeg pipeline a *second consumer of
 * the resolver* rather than a second renderer. Nothing here — and nothing in
 * any module that imports only from here — references `Project` or `Clip`.
 * Everything the decode/composite/encode stages need is either a `Scene` or a
 * plan derived from a sequence of `Scene`s.
 */

import type { Scene } from '@elah/core'

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

/**
 * A located, verified ffmpeg binary.
 *
 * ffmpeg is a system binary, never an npm dependency: vendoring a static build
 * would add ~80 MB, drag GPL-licensed code into an Apache-2.0 package, and lose
 * the hardware encoders (h264_videotoolbox / h264_nvenc / h264_qsv) that only
 * the platform's own build has.
 */
export interface FfmpegBinary {
  /** Path or bare command name that was verified to run. */
  path: string
  /** First line of `ffmpeg -version`, kept verbatim for error messages. */
  versionLine: string
  /** Parsed [major, minor]; `null` for git/nightly builds with no numeric version. */
  version: [number, number] | null
  /** Encoder names reported by `ffmpeg -encoders`. */
  encoders: ReadonlySet<string>
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

export interface MediaInfo {
  durationSec: number
  width?: number
  height?: number
}

export interface VideoSourceInfo {
  durationSec: number
  /**
   * Post-rotation, pixel-aspect-corrected dimensions — the size the browser's
   * CanvasSink hands the compositor, and therefore the content size that must
   * be fed to `resolveDrawRect`.
   */
  displayWidth: number
  displayHeight: number
  codedWidth: number
  codedHeight: number
  /** Average frame rate from packet stats. Diagnostics only — never used to derive timestamps. */
  averageFrameRate: number
}

/**
 * The full presentation-timestamp index of a source's primary video track.
 *
 * Built from metadata-only packets, so it costs an index read rather than a
 * file read. This index is what makes ffmpeg decode frame-accurate: it tells us
 * which source frame each raw frame coming off the pipe actually is.
 */
export interface VideoFrameIndex extends VideoSourceInfo {
  /** Presentation timestamps in seconds, ascending, one per source frame. */
  timestamps: Float64Array
  /** False when the index had to be synthesized from the average frame rate. */
  exact: boolean
}

export interface OutputValidation {
  durationSec: number
  frameCount: number | null
  width: number
  height: number
  hasAudioTrack: boolean
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * One decoded video frame.
 *
 * `data` is a view into the reader's buffer and is invalidated by the next
 * decoder step — draw it immediately, and copy it if you need to keep it
 * (the transition snapshot store does).
 *
 * `width`/`height` describe the pixel buffer; `displayWidth`/`displayHeight`
 * describe the source's true display size. They differ when `decodeMaxHeight`
 * caps decode resolution, and placement math must always use the display pair.
 */
export interface DecodedFrame {
  data: Uint8ClampedArray
  width: number
  height: number
  displayWidth: number
  displayHeight: number
}

// ---------------------------------------------------------------------------
// Plan — the compressed result of scanning every frame's Scene
// ---------------------------------------------------------------------------

export interface VideoClipPlan {
  clipId: string
  /** Resolved source: absolute path or http(s) URL. */
  source: string
  /** First export frame at which this clip appears in a Scene. */
  firstFrame: number
  /** Last export frame at which it appears, inclusive. */
  lastFrame: number
  /**
   * One entry per export frame in `[firstFrame, lastFrame]`: the clip's
   * `sourceFrame` from the Scene at that frame, in project-fps units.
   * Dense and non-decreasing — the decoder cursor depends on both.
   */
  sourceFrames: Int32Array
}

export interface AudioClipPlan {
  clipId: string
  source: string
  /** Timeline position of the clip's first frame. */
  startFrame: number
  /** Number of export frames the clip covers. */
  frameCount: number
  /** In-point into the source, in project-fps frames. */
  sourceStartFrame: number
  /** Effective linear gain from the Scene: clip volume x track gain, 0 when muted. */
  volume: number
}

export interface ExportPlan {
  fps: number
  /** The project's stage size. Output size is derived from it, not equal to it. */
  stage: { width: number; height: number }
  totalFrames: number
  videos: VideoClipPlan[]
  audios: AudioClipPlan[]
  /**
   * Unique images, in first-appearance order. `src` is the raw `Scene` src —
   * what the compositor keys `FrameSources.images` by, since it only ever
   * sees `ActiveImageClip.src` — and `source` is that same src run through
   * `resolveSource`, the string ffmpeg/mediabunny/`loadImage` can actually
   * open. Keeping both avoids re-resolving (and re-hashing) a src once per
   * frame per image just to look an already-loaded image back up.
   */
  imageSources: Array<{ src: string; source: string }>
  /** Font families requested by text clips anywhere in the timeline. */
  fontFamilies: string[]
}

// ---------------------------------------------------------------------------
// Audio mix
// ---------------------------------------------------------------------------

export interface AudioMixInput {
  /** Resolved source, added to the encoder argv as `-i <source>`. */
  source: string
  clipId: string
}

/**
 * A ready-to-splice audio section of the encoder command line.
 *
 * Node has no Web Audio API, so the mix that `OfflineAudioContext` performs in
 * the browser exporter is expressed as an ffmpeg filter graph instead. The
 * graph is built from frame counts; seconds appear only in the emitted string.
 */
export interface AudioMixSpec {
  /** Inputs in the order they are appended after the rawvideo input (index 1..N). */
  inputs: AudioMixInput[]
  /** Value passed to `-filter_complex`. */
  filterComplex: string
  /** Label passed to `-map`, e.g. `'[aout]'`. */
  outLabel: string
  sampleRate: number
  channels: number
}

// ---------------------------------------------------------------------------
// Public options / results
// ---------------------------------------------------------------------------

export interface FontSpec {
  /** Path to a .ttf / .otf / .ttc file. */
  path: string
  /** Family name to register it under. Defaults to the name embedded in the file. */
  family?: string
}

export type ExportPhase = 'planning' | 'probing' | 'encoding' | 'finalizing' | 'validating'

export interface ExportProgress {
  phase: ExportPhase
  frame: number
  totalFrames: number
}

export interface ExportProjectOptions {
  /** Destination MP4. Its directory must already exist. */
  outPath: string
  /** Base directory that relative clip `src` values resolve against. Default `process.cwd()`. */
  projectDir?: string
  /** Explicit ffmpeg binary; beats `ELAH_FFMPEG` and `ffmpeg` on PATH. */
  ffmpegPath?: string
  /**
   * Output height in pixels. Width follows the stage aspect ratio and is
   * rounded to an even number (H.264 chroma subsampling requires it).
   * Defaults to the stage height — no scaling.
   */
  outputHeight?: number
  /** ffmpeg encoder name, not a codec family. Default `'libx264'`. */
  videoEncoder?: string
  /** Target video bitrate in bits/s. Default 8 Mbps, matching the browser exporter. */
  videoBitrate?: number
  /** ffmpeg encoder name. Default `'aac'`. */
  audioEncoder?: string
  /** Target audio bitrate in bits/s. Default 128 kbps. */
  audioBitrate?: number
  /** Mix sample rate. Default 48000. */
  audioSampleRate?: number
  /** Mix channel count. Default 2. */
  audioChannels?: number
  /** Spliced in just before the output path — the escape hatch for `-preset`, `-crf`, etc. */
  extraOutputArgs?: string[]
  /**
   * Cap the height each video source is decoded at. Placement geometry still
   * uses the source's true display size, so this trades sharpness for decode
   * bandwidth without moving anything on the stage.
   */
  decodeMaxHeight?: number
  /** Fonts registered before any text is measured. */
  fonts?: FontSpec[]
  /** Family substituted whenever a text clip asks for one Skia cannot resolve. */
  fallbackFontFamily?: string
  /**
   * Linear gain applied to the whole mix. Default 1: the browser exporter does
   * not apply `project.masterVolume`, so neither do we unless asked.
   */
  masterVolume?: number
  /** Override how a clip `src` becomes an openable path/URL. Default `resolveSource(src, projectDir)`. */
  resolveSource?: (src: string) => string
  onProgress?: (progress: ExportProgress) => void
  /** Aborts the export: children are killed and the partial output is removed. */
  signal?: AbortSignal
  /** Re-open the finished file with mediabunny and report what landed. Default true. */
  validateOutput?: boolean
}

export interface ExportResult {
  outPath: string
  sizeBytes: number
  totalFrames: number
  fps: number
  width: number
  height: number
  durationSec: number
  hasAudio: boolean
  /** Present unless `validateOutput` was disabled. */
  validation?: OutputValidation
  /** Non-fatal problems: a skipped audio clip, a substituted font, a short source. */
  warnings: string[]
  ffmpeg: {
    path: string
    versionLine: string
    videoEncoder: string
    audioEncoder?: string
  }
  elapsedMs: number
}

/** Re-exported so consumers can type a compositor without importing @elah/core directly. */
export type { Scene }
