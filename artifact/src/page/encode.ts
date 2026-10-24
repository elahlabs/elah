/**
 * Main-thread MP4 encode of a rasterised page (PLAN-HTML-FIRST section 4, HF-2 step 3).
 *
 * mediabunny `Output` + `CanvasSource` on the main thread (pattern: ExportWorker.ts:489-516, 734, 797 and the
 * premium MatteHarness loop). Frames `0 .. round(duration * fps) - 1` at `i / fps`. The loop yields to the
 * event loop with a `MessageChannel` (not `setTimeout`, which a hidden page throttles to once a second and
 * which clamps to 4 ms) so the UI repaints and Cancel is heard. No audio in v1.
 */

import { assertReadable, createRasterizer, type Rasterizer } from './raster'
import { inlineFonts } from './fontsInline'
import type { PagePlayerHandle } from './types'

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

export async function encodePage(player: PagePlayerHandle, opts: EncodeOptions): Promise<EncodeResult> {
  const { signal } = opts
  const { page } = player
  const { width, height } = page.stage
  const fps = page.fps
  const totalFrames = Math.max(1, Math.round(page.durationSeconds * fps))

  opts.onPhase?.('Exporting MP4: preparing fonts')
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
  await output.start()

  const started = performance.now()
  let encodeMs = 0
  try {
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
    },
  }
}
