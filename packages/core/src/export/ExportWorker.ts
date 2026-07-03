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
 * Placement for every clip kind (video/image/text/shape/freehand) mirrors the
 * GPU renderer's layers by reusing resolveDrawRect (drawRect.ts),
 * computeTextLayout (textLayout.ts), and the same shape/freehand paint logic
 * as ShapeLayer/FreehandLayer.
 */

import * as mb from 'mediabunny'

import { trace, traceEnabled, enableChannels, type TraceChannel } from '../debug/trace'

// ---------------------------------------------------------------------------
// Logging helpers — routed through the channel-based tracer.
//
// The Worker has no `window`/`localStorage`, so it can't read `__trace` state
// itself. exportVideo.ts snapshots the enabled channels on the main thread and
// forwards them in the `start` message; we seed them via enableChannels().
// Enable from the console, e.g. `__trace.on('EXPORT_AUDIO')`, then export.
// ---------------------------------------------------------------------------

const t0 = performance.now()

/** Sub-stage label → trace channel. */
const STAGE_CHANNEL: Record<string, TraceChannel> = {
  worker: 'EXPORT',
  run: 'EXPORT',
  'assets:video': 'EXPORT_ASSETS',
  'assets:image': 'EXPORT_ASSETS',
  audio: 'EXPORT_AUDIO',
  mediabunny: 'EXPORT_MUX',
  frames: 'EXPORT_FRAMES',
  'render:frame0': 'EXPORT_FRAMES',
}

/**
 * Fetches `src` and returns its bytes, throwing a clear error for a non-2xx
 * response instead of letting the caller try to decode an HTML error page as
 * media — e.g. an expired/malformed image URL fails with a cryptic
 * `EncodingError: Decoding error` from `createImageBitmap` otherwise.
 */
async function fetchAssetBlob(src: string, kind: string): Promise<Blob> {
  const res = await fetch(src)
  if (!res.ok) {
    throw new Error(`ExportWorker: failed to fetch ${kind} "${src}" (${res.status} ${res.statusText})`)
  }
  return res.blob()
}

function xlog(stage: string, msg: string, extra?: Record<string, unknown>) {
  const channel = STAGE_CHANNEL[stage] ?? 'EXPORT'
  if (!traceEnabled(channel)) return
  const elapsed = ((performance.now() - t0) / 1000).toFixed(3)
  const suffix = extra ? ' — ' + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(', ') : ''
  trace(channel, `[${stage}] +${elapsed}s ${msg}${suffix}`)
}

async function timed<T>(stage: string, label: string, fn: () => Promise<T>): Promise<T> {
  xlog(stage, `${label} ...`)
  const start = performance.now()
  const result = await fn()
  xlog(stage, `${label} done`, { ms: (performance.now() - start).toFixed(1) })
  return result
}

function fmtBytes(n: number): string {
  if (n > 1_000_000) return (n / 1_000_000).toFixed(2) + ' MB'
  if (n > 1_000) return (n / 1_000).toFixed(1) + ' KB'
  return n + ' B'
}

import { resolveTimeline } from '../resolver/resolveTimeline'
import { getTotalFrames } from '../utils/frames'
import type { Project } from '../types'
import type {
  ActiveVideoClip,
  ActiveImageClip,
  ActiveTextClip,
  ActiveShapeClip,
  ActiveFreehandClip,
} from '../resolver/scene'
import { resolveDrawRect } from '../renderer/gpu/layers/drawRect'
import { computeTextLayout } from '../renderer/gpu/layers/textLayout'
import type { ExportOptions, RenderedAudio, WorkerOutMessage } from './types'

// ---------------------------------------------------------------------------
// Worker message entry point
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
  if (e.data?.type !== 'start') return

  const { project, options, audio, trace: traceChannels } = e.data as {
    project: Project
    options: ExportOptions
    audio: RenderedAudio | null
    trace?: TraceChannel[]
  }
  if (traceChannels) enableChannels(traceChannels)
  xlog('worker', 'message received — starting export')
  try {
    const buffer = await runExport(project, options, audio)
    xlog('worker', 'posting buffer to main thread', { size: fmtBytes(buffer.byteLength) })
    const msg: WorkerOutMessage = { type: 'done', buffer }
    ;(self as unknown as Worker).postMessage(msg, [buffer])
  } catch (err) {
    xlog('worker', `export failed: ${String(err)}`)
    const msg: WorkerOutMessage = { type: 'error', message: String(err) }
    ;(self as unknown as Worker).postMessage(msg)
  }
}

// ---------------------------------------------------------------------------
// Main export logic
// ---------------------------------------------------------------------------

async function runExport(project: Project, options: ExportOptions, audio: RenderedAudio | null): Promise<ArrayBuffer> {
  const { width: stageWidth, height: stageHeight } = project.stage
  const fps = project.fps
  const totalFrames = getTotalFrames(project.clips)

  // Scale the output canvas to the requested resolution while preserving the
  // project stage's aspect ratio. Even dimensions are required by most video
  // codecs (H.264/VP9 need even width/height for chroma subsampling).
  const outputHeight = options.outputHeight ?? stageHeight
  const scale = outputHeight / stageHeight
  const width = Math.round((stageWidth * scale) / 2) * 2
  const height = Math.round(outputHeight / 2) * 2

  xlog('run', 'starting', {
    stage: `${stageWidth}x${stageHeight}`,
    output: `${width}x${height}`,
    fps,
    totalFrames,
    durationSec: (totalFrames / fps).toFixed(2),
    videoCodec: options.videoCodec ?? 'avc',
    videoBitrate: options.videoBitrate ?? 8_000_000,
    audioCodec: options.audioCodec ?? 'aac',
    audioBitrate: options.audioBitrate ?? 128_000,
  })

  if (totalFrames === 0) throw new Error('ExportWorker: project has no clips')

  const allClips = Object.values(project.clips).flat()
  xlog('run', `clip inventory`, {
    total: allClips.length,
    video: allClips.filter(c => c.type === 'video').length,
    image: allClips.filter(c => c.type === 'image').length,
    audio: allClips.filter(c => c.type === 'audio').length,
    text: allClips.filter(c => c.type === 'text').length,
  })

  // --- Open mediabunny CanvasSinks for unique video srcs ---
  const videoSrcs = [...new Set(allClips.filter(c => c.type === 'video' && c.src).map(c => c.src!))]
  xlog('assets:video', `opening ${videoSrcs.length} CanvasSink(s)`)
  const videoSinks = new Map<string, mb.CanvasSink>()
  for (let i = 0; i < videoSrcs.length; i++) {
    const src = videoSrcs[i]
    xlog('assets:video', `[${i + 1}/${videoSrcs.length}] fetching "${src.slice(-40)}"`)
    const fetchStart = performance.now()
    const blob = await fetchAssetBlob(src, 'video')
    xlog('assets:video', `[${i + 1}/${videoSrcs.length}] fetched`, { size: fmtBytes(blob.size), ms: (performance.now() - fetchStart).toFixed(1) })
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) })
    const track = await input.getPrimaryVideoTrack()
    if (track) {
      videoSinks.set(src, new mb.CanvasSink(track))
      xlog('assets:video', `[${i + 1}/${videoSrcs.length}] CanvasSink ready`)
    } else {
      xlog('assets:video', `[${i + 1}/${videoSrcs.length}] WARNING: no primary video track found`)
    }
  }

  // --- Load ImageBitmaps for unique image srcs ---
  const imageSrcs = [...new Set(allClips.filter(c => c.type === 'image' && c.src).map(c => c.src!))]
  xlog('assets:image', `loading ${imageSrcs.length} ImageBitmap(s)`)
  const imageBitmaps = new Map<string, ImageBitmap>()
  for (let i = 0; i < imageSrcs.length; i++) {
    const src = imageSrcs[i]
    xlog('assets:image', `[${i + 1}/${imageSrcs.length}] fetching "${src.slice(-40)}"`)
    const fetchStart = performance.now()
    const blob = await fetchAssetBlob(src, 'image')
    const bitmap = await createImageBitmap(blob).catch((e) => {
      throw new Error(`ExportWorker: failed to decode image "${src}" (${blob.type || 'unknown type'}, ${fmtBytes(blob.size)}): ${e instanceof Error ? e.message : e}`)
    })
    imageBitmaps.set(src, bitmap)
    xlog('assets:image', `[${i + 1}/${imageSrcs.length}] ready`, {
      size: fmtBytes(blob.size),
      bitmapW: bitmap.width,
      bitmapH: bitmap.height,
      ms: (performance.now() - fetchStart).toFixed(1),
    })
  }

  // --- Audio mix ---
  // The mix is rendered on the main thread (exportVideo.ts) because the Web
  // Audio API (OfflineAudioContext / decodeAudioData) is not exposed in Web
  // Workers. Here we just receive the finished PCM and encode it below.
  if (audio) {
    xlog('audio', `received mixed PCM`, {
      channels: audio.numberOfChannels,
      frames: audio.length,
      sampleRate: audio.sampleRate,
      durationSec: (audio.length / audio.sampleRate).toFixed(3),
    })
  } else {
    xlog('audio', 'no mixed audio received — exporting video-only')
  }

  // --- Set up mediabunny Output ---
  xlog('mediabunny', `creating OffscreenCanvas ${width}x${height}`)
  const outputCanvas = new OffscreenCanvas(width, height)
  const ctx2d = outputCanvas.getContext('2d')!

  const videoCodec = options.videoCodec ?? 'avc'
  const videoBitrate = options.videoBitrate ?? 8_000_000
  xlog('mediabunny', `creating CanvasSource`, { codec: videoCodec, bitrate: videoBitrate })
  const canvasSource = new mb.CanvasSource(outputCanvas, {
    codec: videoCodec,
    bitrate: videoBitrate,
  })

  xlog('mediabunny', 'creating BufferTarget + Mp4Output')
  const bufferTarget = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: bufferTarget })
  output.addVideoTrack(canvasSource)
  xlog('mediabunny', 'video track added to output')

  let audioSource: mb.AudioSampleSource | null = null
  if (audio) {
    const audioCodec = options.audioCodec ?? 'aac'
    const audioBitrate = options.audioBitrate ?? 128_000
    xlog('mediabunny', `creating AudioSampleSource`, { codec: audioCodec, bitrate: audioBitrate })
    audioSource = new mb.AudioSampleSource({
      codec: audioCodec,
      bitrate: audioBitrate,
    })
    output.addAudioTrack(audioSource)
    xlog('mediabunny', 'audio track added to output')
  }

  await timed('mediabunny', 'output.start()', () => output.start())

  if (audio && audioSource) {
    await timed('mediabunny', 'audioSource.add() — encoding mixed PCM', () => addAudioMix(audioSource!, audio))
  }

  // --- Per-clip sequential decoders ---
  // Each video clip gets its own canvasesAtTimestamps() generator fed with the
  // clip's source timestamps in monotonically increasing order (one per export
  // frame). This lets mediabunny decode each source packet at most once and
  // never re-seek from a keyframe — eliminating the corrupt green-band artifacts
  // that occurred when getCanvas() was called once per frame (random-access).
  type ClipDecoder = {
    gen: AsyncGenerator<mb.WrappedCanvas | null>
    clipStartFrame: number
    clipEndFrame: number
  }
  const clipDecoders = new Map<string, ClipDecoder>()
  const videoClips = allClips.filter(c => c.type === 'video' && c.src)
  xlog('frames', `setting up ${videoClips.length} per-clip sequential decoder(s)`)
  for (const clip of videoClips) {
    const sink = videoSinks.get(clip.src!)
    if (!sink) continue
    const clipEndFrame = clip.startFrame + clip.durationFrames
    // Pre-compute source timestamps for every export frame this clip covers.
    // Using +0.5 midpoint matches the preview's Math.round(PTS / usPerFrame)
    // convention and avoids off-by-one on sources with a different frame rate.
    const sourceTimestamps = Array.from({ length: clip.durationFrames }, (_, i) =>
      (clip.sourceStartFrame + i + 0.5) / fps,
    )
    clipDecoders.set(clip.id, {
      gen: sink.canvasesAtTimestamps(sourceTimestamps),
      clipStartFrame: clip.startFrame,
      clipEndFrame,
    })
  }

  // --- Sequential frame render loop ---
  xlog('frames', `starting frame loop`, { totalFrames, fps })
  const loopStart = performance.now()
  const logEvery = Math.max(1, Math.floor(totalFrames / 10))
  let lastFrameTime = loopStart

  // Holds a frozen bitmap of each outgoing clip for the duration of its
  // transition window. Drawn on top at globalAlpha=1-t to produce a crossfade
  // while the GPU only decodes the incoming clip (same logic as TransitionOverlay
  // in preview, mirroring it for export parity).
  type SnapshotEntry = { source: CanvasImageSource & { width: number; height: number }; owned: boolean }
  const transitionSnapshots = new Map<string, SnapshotEntry>()

  for (let frame = 0; frame < totalFrames; frame++) {
    if (frame === 0 || frame % logEvery === 0 || frame === totalFrames - 1) {
      const now = performance.now()
      const elapsed = now - loopStart
      const avgMsPerFrame = frame > 0 ? elapsed / frame : 0
      const pct = Math.round((frame / totalFrames) * 100)
      xlog('frames', `frame ${frame}/${totalFrames} (${pct}%)`, {
        avgMsPerFrame: avgMsPerFrame.toFixed(1),
        sinceLastLog: (now - lastFrameTime).toFixed(1) + 'ms',
      })
      lastFrameTime = now
    }

    const scene = resolveTimeline(frame, project)

    // Advance each active clip's decoder by one step and collect the resulting
    // canvases. Every generator was seeded with exactly one timestamp per export
    // frame in order, so each .next() call returns the canvas for this frame.
    const clipCanvases = new Map<string, mb.WrappedCanvas | null>()
    for (const [clipId, decoder] of clipDecoders) {
      if (frame >= decoder.clipStartFrame && frame < decoder.clipEndFrame) {
        const result = await decoder.gen.next()
        clipCanvases.set(clipId, result.done ? null : result.value)
      }
    }

    // Capture a snapshot of the outgoing clip on the first frame of each
    // transition. The canvas is already decoded above — no extra seek needed.
    for (const tr of scene.transitions) {
      if (transitionSnapshots.has(tr.id)) continue
      const fromVideo = scene.videos.find(v => v.id === tr.fromClipId)
      const fromImage = scene.images.find(i => i.id === tr.fromClipId)
      if (fromVideo) {
        const wrapped = clipCanvases.get(fromVideo.id) ?? null
        if (wrapped) {
          const bmp = await createImageBitmap(wrapped.canvas)
          transitionSnapshots.set(tr.id, { source: bmp, owned: true })
        }
      } else if (fromImage) {
        const bmp = imageBitmaps.get(fromImage.src)
        if (bmp) transitionSnapshots.set(tr.id, { source: bmp, owned: false })
      }
    }

    await renderFrame(ctx2d, scene, clipCanvases, imageBitmaps, transitionSnapshots, width, height, frame)
    await canvasSource.add(frame / fps, 1 / fps)

    // Release snapshots whose transition window has closed.
    const activeIds = new Set(scene.transitions.map(tr => tr.id))
    for (const [id, snap] of transitionSnapshots) {
      if (!activeIds.has(id)) {
        if (snap.owned) (snap.source as ImageBitmap).close()
        transitionSnapshots.delete(id)
      }
    }

    const msg: WorkerOutMessage = { type: 'progress', frame, totalFrames }
    ;(self as unknown as Worker).postMessage(msg)
  }

  const loopMs = performance.now() - loopStart
  xlog('frames', `loop complete`, {
    totalFrames,
    totalMs: loopMs.toFixed(0),
    avgMsPerFrame: (loopMs / totalFrames).toFixed(1),
  })

  await timed('mediabunny', 'output.finalize()', () => output.finalize())

  if (!bufferTarget.buffer) throw new Error('ExportWorker: buffer is null after finalize')
  xlog('run', `export complete`, { outputSize: fmtBytes(bufferTarget.buffer.byteLength) })
  return bufferTarget.buffer
}

// ---------------------------------------------------------------------------
// Audio encoding — build AudioSamples from the mixed PCM (no Web Audio API)
// ---------------------------------------------------------------------------

/**
 * Encode the main-thread audio mix into the output via {@link mb.AudioSampleSource}.
 *
 * The PCM is fed in ~1-second chunks of `f32-planar` {@link mb.AudioSample}s so
 * we respect encoder backpressure and avoid allocating one enormous sample for
 * long projects. `await source.add()` applies the backpressure.
 */
async function addAudioMix(source: mb.AudioSampleSource, audio: RenderedAudio): Promise<void> {
  const { sampleRate, numberOfChannels, length } = audio
  const channels = audio.channels.map(b => new Float32Array(b))
  const chunkFrames = sampleRate // 1 second per chunk
  const totalChunks = Math.ceil(length / chunkFrames)
  xlog('audio', `encoding PCM in chunks`, { totalChunks, chunkFrames, numberOfChannels, sampleRate })

  let chunkIndex = 0
  for (let start = 0; start < length; start += chunkFrames) {
    const frames = Math.min(chunkFrames, length - start)
    // f32-planar layout: channel 0's frames, then channel 1's frames, ...
    const data = new Float32Array(frames * numberOfChannels)
    for (let c = 0; c < numberOfChannels; c++) {
      data.set(channels[c].subarray(start, start + frames), c * frames)
    }
    const sample = new mb.AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels,
      sampleRate,
      timestamp: start / sampleRate,
    })
    const addStart = performance.now()
    await source.add(sample)
    sample.close()
    chunkIndex++
    xlog('audio', `chunk ${chunkIndex}/${totalChunks} encoded`, {
      timestampSec: (start / sampleRate).toFixed(3),
      frames,
      ms: (performance.now() - addStart).toFixed(1),
    })
  }
  xlog('audio', `PCM encode complete`, { totalChunks })
}

// ---------------------------------------------------------------------------
// Frame renderer
// ---------------------------------------------------------------------------

async function renderFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  scene: ReturnType<typeof resolveTimeline>,
  clipCanvases: Map<string, mb.WrappedCanvas | null>,
  imageBitmaps: Map<string, ImageBitmap>,
  transitionSnapshots: Map<string, { source: CanvasImageSource & { width: number; height: number }; owned: boolean }>,
  stageW: number,
  stageH: number,
  frameIndex: number,
): Promise<void> {
  const isDebugFrame = frameIndex === 0

  if (isDebugFrame) {
    xlog('render:frame0', `scene layers`, {
      videos: scene.videos.length,
      images: scene.images.length,
      texts: scene.texts.length,
      shapes: scene.shapes.length,
      freehand: scene.freehand.length,
    })
  }

  ctx.clearRect(0, 0, stageW, stageH)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, stageW, stageH)

  type AnyItem =
    | { kind: 'video'; item: ActiveVideoClip }
    | { kind: 'image'; item: ActiveImageClip }
    | { kind: 'text'; item: ActiveTextClip }
    | { kind: 'shape'; item: ActiveShapeClip }
    | { kind: 'freehand'; item: ActiveFreehandClip }

  const items: AnyItem[] = [
    ...scene.videos.map(item => ({ kind: 'video' as const, item })),
    ...scene.images.map(item => ({ kind: 'image' as const, item })),
    ...scene.texts.map(item => ({ kind: 'text' as const, item })),
    ...scene.shapes.map(item => ({ kind: 'shape' as const, item })),
    ...scene.freehand.map(item => ({ kind: 'freehand' as const, item })),
  ].sort((a, b) => a.item.zIndex - b.item.zIndex)

  for (const entry of items) {
    ctx.save()
    ctx.globalAlpha = entry.item.opacity ?? 1

    if (entry.kind === 'video') {
      // Canvases are pre-decoded sequentially by clip id — no per-frame seek.
      const wrapped = clipCanvases.get(entry.item.id) ?? null
      if (isDebugFrame) {
        xlog('render:frame0', `video layer — sequential canvas`, {
          clipId: entry.item.id,
          gotFrame: !!wrapped,
          zIndex: entry.item.zIndex,
          opacity: entry.item.opacity ?? 1,
          ...(wrapped ? { canvasW: wrapped.canvas.width, canvasH: wrapped.canvas.height } : {}),
        })
      }
      if (wrapped) {
        drawMedia(ctx, wrapped.canvas, entry.item.transform, stageW, stageH)
      } else {
        if (isDebugFrame) xlog('render:frame0', `video layer — WARNING: no canvas for clip "${entry.item.id}"`)
      }
    } else if (entry.kind === 'image') {
      const bitmap = imageBitmaps.get(entry.item.src)
      if (isDebugFrame) {
        xlog('render:frame0', `image layer`, {
          src: entry.item.src.slice(-40),
          zIndex: entry.item.zIndex,
          hasBitmap: !!bitmap,
          ...(bitmap ? { bitmapW: bitmap.width, bitmapH: bitmap.height } : {}),
        })
      }
      if (bitmap) {
        drawMedia(ctx, bitmap, entry.item.transform, stageW, stageH)
      }
    } else if (entry.kind === 'text') {
      if (isDebugFrame) {
        xlog('render:frame0', `text layer`, {
          content: entry.item.content?.slice(0, 30),
          zIndex: entry.item.zIndex,
          fontSize: entry.item.fontSize,
        })
      }
      drawText(ctx, entry.item, stageW, stageH)
    } else if (entry.kind === 'shape') {
      if (isDebugFrame) {
        xlog('render:frame0', `shape layer`, {
          shapeKind: entry.item.shapeKind,
          zIndex: entry.item.zIndex,
        })
      }
      drawShape(ctx, entry.item, stageW, stageH)
    } else {
      if (isDebugFrame) {
        xlog('render:frame0', `freehand layer`, {
          zIndex: entry.item.zIndex,
        })
      }
      drawFreehand(ctx, entry.item)
    }

    ctx.restore()
  }

  // Transition snapshot pass — mirrors TransitionOverlay CSS logic in the 2D canvas API.
  for (const tr of scene.transitions) {
    const snap = transitionSnapshots.get(tr.id)
    if (!snap) continue
    ctx.save()

    if (tr.kind === 'slide') {
      const sign = tr.direction === 'left' ? -1 : 1
      ctx.translate(sign * tr.t * stageW, 0)
      drawMedia(ctx, snap.source, undefined, stageW, stageH)
    } else if (tr.kind === 'wipe') {
      // Reveal incoming clip from the right by shrinking the snapshot's visible area
      ctx.beginPath()
      ctx.rect(0, 0, stageW * (1 - tr.t), stageH)
      ctx.clip()
      drawMedia(ctx, snap.source, undefined, stageW, stageH)
    } else {
      // fade (default)
      ctx.globalAlpha = 1 - tr.t
      drawMedia(ctx, snap.source, undefined, stageW, stageH)
    }

    ctx.restore()
  }

  if (isDebugFrame) {
    xlog('render:frame0', `frame 0 draw complete — ${items.length} layer(s) composited onto ${stageW}x${stageH}`)
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

/** Mirrors ShapeLayer.paintShape — same centered rect/circle/triangle geometry. */
function drawShape(
  ctx: OffscreenCanvasRenderingContext2D,
  item: ActiveShapeClip,
  stageW: number,
  stageH: number,
): void {
  const cx = (item.transform?.x ?? 0.5) * stageW
  const cy = (item.transform?.y ?? 0.5) * stageH
  const shortSide = Math.min(stageW, stageH)
  const half = (item.transform?.scale ?? 0.5) * shortSide * 0.5

  ctx.fillStyle = item.shapeFill
  ctx.strokeStyle = item.shapeStroke
  ctx.lineWidth = item.shapeStrokeWidth

  if (item.shapeKind === 'rect') {
    ctx.beginPath()
    ctx.rect(cx - half, cy - half, half * 2, half * 2)
    ctx.fill()
    if (item.shapeStrokeWidth > 0) ctx.stroke()
  } else if (item.shapeKind === 'circle') {
    ctx.beginPath()
    ctx.arc(cx, cy, half, 0, Math.PI * 2)
    ctx.fill()
    if (item.shapeStrokeWidth > 0) ctx.stroke()
  } else if (item.shapeKind === 'triangle') {
    ctx.beginPath()
    ctx.moveTo(cx, cy - half)
    ctx.lineTo(cx + half, cy + half)
    ctx.lineTo(cx - half, cy + half)
    ctx.closePath()
    ctx.fill()
    if (item.shapeStrokeWidth > 0) ctx.stroke()
  }
}

/** Mirrors FreehandLayer.paintFreehand — same Path2D stroke, invalid pathData is a no-op. */
function drawFreehand(ctx: OffscreenCanvasRenderingContext2D, item: ActiveFreehandClip): void {
  if (!item.pathData) return

  ctx.strokeStyle = item.strokeColor
  ctx.lineWidth = item.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  try {
    const path = new Path2D(item.pathData)
    ctx.stroke(path)
  } catch {
    // Invalid pathData — render nothing.
  }
}
