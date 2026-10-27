/**
 * Main-thread MP4 encode of a rasterised page (PLAN-HTML-FIRST section 4, HF-2 step 3).
 *
 * mediabunny `Output` + `CanvasSource` on the main thread (pattern: ExportWorker.ts:489-516, 734, 797 and the
 * premium MatteHarness loop). Frames `0 .. round(duration * fps) - 1` at `i / fps`. The loop yields to the
 * event loop with a `MessageChannel` (not `setTimeout`, which a hidden page throttles to once a second and
 * which clamps to 4 ms) so the UI repaints and Cancel is heard.
 *
 * Sound (TICKET-PF-13): a page with `data-sfx` cues gets one audio track. The cues become audio clips (sfxCues.ts) and
 * core's `renderAudioMix` mixes them, the same mix the native editor exports, into 44.1 kHz stereo PCM that is
 * encoded as AAC (Opus if the browser has no AAC encoder). A page with no cues keeps the video-only path.
 */

import { assertReadable, createRasterizer, type Rasterizer } from './raster'
import { inlineFonts } from './fontsInline'
import { defaultAudioResolver, renderAudioMix } from '@elah/core'
import { cueProject, cuesFromPage } from './sfxCues'
import type { PagePlayerHandle } from './types'

/** What core's `renderAudioMix` returns (its type is not re-exported from the package root). */
type RenderedAudio = NonNullable<Awaited<ReturnType<typeof renderAudioMix>>>

export interface EncodeStats {
  codec: string
  frames: number
  width: number
  height: number
  fps: number
  bytes: number
  /** wall time for the whole encode loop, ms */
  totalMs: number
  /** ms per frame, raster (build + decode + draw) */
  rasterMsPerFrame: number
  buildMsPerFrame: number
  decodeMsPerFrame: number
  drawMsPerFrame: number
  /** ms per frame spent inside `CanvasSource.add` (encode + mux backpressure) */
  encodeMsPerFrame: number
  fontFaces: string[]
  fontBytes: number
  /** Sound cues mixed into the file (0 = silent, video-only). */
  cues: number
  /** 'aac' | 'opus', or null when the file has no audio track. */
  audioCodec: string | null
  /** ms to fetch, decode and mix the cues (runs alongside the font step). */
  mixMs: number
  /** ms spent feeding the mixed PCM to the audio encoder. */
  audioEncodeMs: number
}

export interface EncodeOptions {
  signal?: AbortSignal
  fontBaseUrl: string
  onProgress?: (frame: number, totalFrames: number) => void
  onPhase?: (text: string) => void
}

export interface EncodeResult {
  blob: Blob
  stats: EncodeStats
}

const abortError = () => new DOMException('Export cancelled', 'AbortError')

let channel: MessageChannel | null = null
/** Yield to the event loop without timer throttling. */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  if (!channel) channel = new MessageChannel()
  const ch = channel
  return new Promise((resolve) => {
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(0)
  })
}

export function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create a 2D canvas for the export.')
  return { canvas, ctx }
}

/** Roughly 8 Mbps at 1080p30 (the native engine's default), scaled by pixel rate. */
const bitrateFor = (w: number, h: number, fps: number) =>
  Math.max(1_500_000, Math.min(40_000_000, Math.round(((w * h * fps) / (1920 * 1080 * 30)) * 8_000_000)))

const AUDIO_BITRATE = 128_000

type Mediabunny = typeof import('mediabunny')

/** Feed planar float PCM to an AudioSampleSource in 1 s chunks (the shape of core's ExportWorker `addAudioMix`). */
async function addPcm(mb: Mediabunny, source: InstanceType<Mediabunny['AudioSampleSource']>, audio: RenderedAudio): Promise<void> {
  const { sampleRate, numberOfChannels, length } = audio
  const channels = audio.channels.map((b) => new Float32Array(b))
  for (let start = 0; start < length; start += sampleRate) {
    const frames = Math.min(sampleRate, length - start)
    const data = new Float32Array(frames * numberOfChannels)
    for (let c = 0; c < numberOfChannels; c++) data.set(channels[c]!.subarray(start, start + frames), c * frames)
    const sample = new mb.AudioSample({ data, format: 'f32-planar', numberOfChannels, sampleRate, timestamp: start / sampleRate })
    await source.add(sample)
    sample.close()
  }
}

export async function encodePage(player: PagePlayerHandle, opts: EncodeOptions): Promise<EncodeResult> {
  const { signal } = opts
  const { page } = player
  const { width, height } = page.stage
  const fps = page.fps
  const totalFrames = Math.max(1, Math.round(page.durationSeconds * fps))

  opts.onPhase?.('Exporting MP4: preparing fonts')
  // The sound mix (if the page has cues) runs while the fonts are prepared.
  const cues = cuesFromPage(player.stageEl, player.animations(), page.durationSeconds).cues
  const mixProject = cueProject(cues, page)
  const mixStarted = performance.now()
  let mixMs = 0
  const mixing: Promise<RenderedAudio | null> = mixProject
    ? renderAudioMix(mixProject, defaultAudioResolver, (message) => console.warn(`[sfx export] ${message}`), {
        startFrame: 0,
        endFrame: totalFrames,
        totalFrames,
      }).then((a) => {
        mixMs = performance.now() - mixStarted
        return a
      })
    : Promise.resolve(null)
  const fonts = await inlineFonts(player.stageEl, opts.fontBaseUrl)
  if (signal?.aborted) throw abortError()
  const raster: Rasterizer = createRasterizer(player, { fontCss: fonts.css })

  const mb = await import('mediabunny')
  const bitrate = bitrateFor(width, height, fps)
  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9'], { width, height, bitrate })
  if (!codec) throw new Error(`This browser cannot encode H.264 or VP9 video at ${width}x${height}.`)

  const { canvas, ctx } = makeCanvas(width, height)
  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target })
  const source = new mb.CanvasSource(canvas, { codec, bitrate })
  output.addVideoTrack(source, { frameRate: fps })

  if (mixProject) opts.onPhase?.('Exporting MP4: mixing sound')
  const audio = await mixing
  if (signal?.aborted) throw abortError()
  let audioCodec: string | null = null
  let audioSource: InstanceType<typeof mb.AudioSampleSource> | null = null
  if (audio) {
    audioCodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate, bitrate: AUDIO_BITRATE })
    if (audioCodec) {
      audioSource = new mb.AudioSampleSource({ codec: audioCodec as 'aac' | 'opus', bitrate: AUDIO_BITRATE })
      output.addAudioTrack(audioSource)
    } else {
      console.warn('[sfx export] this browser cannot encode AAC or Opus audio; the MP4 is exported without sound')
    }
  }
  await output.start()

  const started = performance.now()
  let encodeMs = 0
  let audioEncodeMs = 0
  try {
    if (audio && audioSource) {
      // The whole mix goes in first (as core's export worker does), in 1 s chunks so the encoder applies backpressure.
      const a0 = performance.now()
      await addPcm(mb, audioSource, audio)
      audioSource.close()
      audioEncodeMs = performance.now() - a0
    }
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw abortError()
      await raster.rasterFrame(i / fps, ctx)
      if (i === 0) assertReadable(ctx)
      const e0 = performance.now()
      await source.add(i / fps, 1 / fps)
      encodeMs += performance.now() - e0
      opts.onProgress?.(i + 1, totalFrames)
      if (i % 2 === 1) await yieldToEventLoop()
    }
    if (signal?.aborted) throw abortError()
    source.close()
    await output.finalize()
  } catch (e) {
    try {
      await output.cancel()
    } catch {
      /* already finalised or cancelled */
    }
    throw e
  }
  const totalMs = performance.now() - started
  const buffer = target.buffer
  if (!buffer) throw new Error('The encoder produced no data.')
  const blob = new Blob([buffer], { type: 'video/mp4' })
  const t = raster.timings
  const n = Math.max(1, t.frames)
  return {
    blob,
    stats: {
      codec,
      frames: totalFrames,
      width,
      height,
      fps,
      bytes: blob.size,
      totalMs,
      rasterMsPerFrame: (t.buildMs + t.decodeMs + t.drawMs) / n,
      buildMsPerFrame: t.buildMs / n,
      decodeMsPerFrame: t.decodeMs / n,
      drawMsPerFrame: t.drawMs / n,
      encodeMsPerFrame: encodeMs / n,
      fontFaces: fonts.faces,
      fontBytes: fonts.bytes,
      cues: audioSource ? cues.length : 0,
      audioCodec: audioSource ? audioCodec : null,
      mixMs,
      audioEncodeMs,
    },
  }
}
