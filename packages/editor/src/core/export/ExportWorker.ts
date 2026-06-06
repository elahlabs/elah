/// <reference lib="webworker" />

/**
 * ExportWorker — off-main-thread video export.
 *
 * Pipeline:
 *   1. Open one mediabunny CanvasSink per unique video src (native resolution).
 *   2. Load one ImageBitmap per unique image src.
 *   3. Render the full audio mix with OfflineAudioContext.
 *   4. Open a mediabunny Output (MP4 / BufferTarget).
 *   5. For each project frame: resolveTimeline → draw to OffscreenCanvas (2D) →
 *      CanvasSource.add() to encode the frame.
 *   6. finalize() → transfer the ArrayBuffer back to the main thread.
 *
 * Text and media placement exactly mirrors the GPU renderer by reusing
 * resolveDrawRect (from drawRect.ts) and computeTextLayout (textLayout.ts).
 */

import * as mb from 'mediabunny'

import { resolveTimeline } from '../resolver/resolveTimeline'
import { getTotalFrames } from '../utils/frames'
import type { Project } from '../types'
import type { ActiveVideoClip, ActiveImageClip, ActiveTextClip } from '../resolver/scene'
import { resolveDrawRect } from '../renderer/gpu/layers/drawRect'
import { computeTextLayout } from '../renderer/gpu/layers/textLayout'
import type { ExportOptions, WorkerOutMessage } from './types'

// ---------------------------------------------------------------------------
// Worker message entry point
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
  if (e.data?.type !== 'start') return

  const { project, options } = e.data as { project: Project; options: ExportOptions }
  try {
    const buffer = await runExport(project, options)
    const msg: WorkerOutMessage = { type: 'done', buffer }
    ;(self as unknown as Worker).postMessage(msg, [buffer])
  } catch (err) {
    const msg: WorkerOutMessage = { type: 'error', message: String(err) }
    ;(self as unknown as Worker).postMessage(msg)
  }
}

// ---------------------------------------------------------------------------
// Main export logic
// ---------------------------------------------------------------------------

async function runExport(project: Project, options: ExportOptions): Promise<ArrayBuffer> {
  const { width, height } = project.stage
  const fps = project.fps
  const totalFrames = getTotalFrames(project.clips)

  if (totalFrames === 0) throw new Error('ExportWorker: project has no clips')

  const allClips = Object.values(project.clips).flat()

  // --- Open mediabunny CanvasSinks for unique video srcs ---
  const videoSinks = new Map<string, mb.CanvasSink>()
  for (const clip of allClips) {
    if (clip.type !== 'video' || !clip.src || videoSinks.has(clip.src)) continue
    const blob = await fetch(clip.src).then(r => r.blob())
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) })
    const track = await input.getPrimaryVideoTrack()
    if (track) {
      videoSinks.set(clip.src, new mb.CanvasSink(track))
    }
  }

  // --- Load ImageBitmaps for unique image srcs ---
  const imageBitmaps = new Map<string, ImageBitmap>()
  for (const clip of allClips) {
    if (clip.type !== 'image' || !clip.src || imageBitmaps.has(clip.src)) continue
    const blob = await fetch(clip.src).then(r => r.blob())
    imageBitmaps.set(clip.src, await createImageBitmap(blob))
  }

  // --- Audio mix via OfflineAudioContext ---
  const audioClips = allClips.filter(c => {
    if (c.type !== 'audio' || !c.src || c.disabled) return false
    const track = project.tracks.find(t => t.id === c.trackId)
    return track && !track.muted && !track.disabled
  })

  let mixedBuffer: AudioBuffer | null = null
  if (audioClips.length > 0) {
    const sampleRate = 44100
    const totalSec = totalFrames / fps
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalSec), sampleRate)

    for (const clip of audioClips) {
      try {
        const buf = await fetch(clip.src!).then(r => r.arrayBuffer())
        const decoded = await ctx.decodeAudioData(buf)
        const node = ctx.createBufferSource()
        node.buffer = decoded
        const gain = ctx.createGain()
        gain.gain.value = clip.volume ?? 1
        node.connect(gain).connect(ctx.destination)
        node.start(clip.startFrame / fps, clip.sourceStartFrame / fps, clip.durationFrames / fps)
      } catch {
        // Skip un-decodable clips silently
      }
    }
    mixedBuffer = await ctx.startRendering()
  }

  // --- Set up mediabunny Output ---
  const outputCanvas = new OffscreenCanvas(width, height)
  const ctx2d = outputCanvas.getContext('2d')!

  const canvasSource = new mb.CanvasSource(outputCanvas, {
    codec: options.videoCodec ?? 'avc',
    bitrate: options.videoBitrate ?? 8_000_000,
  })

  const bufferTarget = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: bufferTarget })

  output.addVideoTrack(canvasSource)

  let audioSource: mb.AudioBufferSource | null = null
  if (mixedBuffer) {
    audioSource = new mb.AudioBufferSource({
      codec: options.audioCodec ?? 'aac',
      bitrate: options.audioBitrate ?? 128_000,
    })
    output.addAudioTrack(audioSource)
  }

  await output.start()

  // Add the full audio mix before the video frame loop
  if (mixedBuffer && audioSource) {
    await audioSource.add(mixedBuffer)
  }

  // --- Sequential frame render loop ---
  for (let frame = 0; frame < totalFrames; frame++) {
    const scene = resolveTimeline(frame, project)
    await renderFrame(ctx2d, scene, videoSinks, imageBitmaps, width, height, fps)
    await canvasSource.add(frame / fps, 1 / fps)

    const msg: WorkerOutMessage = { type: 'progress', frame, totalFrames }
    ;(self as unknown as Worker).postMessage(msg)
  }

  await output.finalize()

  if (!bufferTarget.buffer) throw new Error('ExportWorker: buffer is null after finalize')
  return bufferTarget.buffer
}

// ---------------------------------------------------------------------------
// Frame renderer
// ---------------------------------------------------------------------------

async function renderFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  scene: ReturnType<typeof resolveTimeline>,
  videoSinks: Map<string, mb.CanvasSink>,
  imageBitmaps: Map<string, ImageBitmap>,
  stageW: number,
  stageH: number,
  fps: number,
): Promise<void> {
  ctx.clearRect(0, 0, stageW, stageH)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, stageW, stageH)

  type AnyItem =
    | { kind: 'video'; item: ActiveVideoClip }
    | { kind: 'image'; item: ActiveImageClip }
    | { kind: 'text'; item: ActiveTextClip }

  const items: AnyItem[] = [
    ...scene.videos.map(item => ({ kind: 'video' as const, item })),
    ...scene.images.map(item => ({ kind: 'image' as const, item })),
    ...scene.texts.map(item => ({ kind: 'text' as const, item })),
  ].sort((a, b) => a.item.zIndex - b.item.zIndex)

  for (const entry of items) {
    ctx.save()
    ctx.globalAlpha = entry.item.opacity ?? 1

    if (entry.kind === 'video') {
      const sink = videoSinks.get(entry.item.src)
      if (sink) {
        const sourceTimeSec = entry.item.sourceFrame / fps
        const wrapped = await sink.getCanvas(sourceTimeSec)
        if (wrapped) {
          drawMedia(ctx, wrapped.canvas, entry.item.transform, stageW, stageH)
        }
      }
    } else if (entry.kind === 'image') {
      const bitmap = imageBitmaps.get(entry.item.src)
      if (bitmap) {
        drawMedia(ctx, bitmap, entry.item.transform, stageW, stageH)
      }
    } else {
      drawText(ctx, entry.item, stageW, stageH)
    }

    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Placement helpers — mirror the GPU renderer's drawRect / textLayout logic
// ---------------------------------------------------------------------------

function drawMedia(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource & { width: number; height: number },
  transform: ReturnType<typeof resolveTimeline>['videos'][0]['transform'],
  stageW: number,
  stageH: number,
): void {
  const rect = resolveDrawRect(transform, stageW, stageH, source.width, source.height)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2

  ctx.translate(cx, cy)
  ctx.rotate(rect.rotation)
  ctx.drawImage(source, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
}

function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  clip: ActiveTextClip,
  stageW: number,
  stageH: number,
): void {
  const layout = computeTextLayout(ctx, clip, { width: stageW, height: stageH })
  ctx.fillStyle = layout.style.color
  ctx.textAlign = layout.style.textAlign
  ctx.textBaseline = 'middle'

  const rotation = clip.transform?.rotation ?? 0
  if (rotation !== 0) {
    const cx = layout.center.x * stageW
    const cy = layout.center.y * stageH
    ctx.translate(cx, cy)
    ctx.rotate(rotation)
    ctx.translate(-cx, -cy)
  }

  for (let i = 0; i < layout.lines.length; i++) {
    ctx.fillText(layout.lines[i], layout.anchorX, layout.firstLineY + i * layout.lineAdvance)
  }
}
