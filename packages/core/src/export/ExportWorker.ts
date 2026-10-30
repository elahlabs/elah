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
import { paintGenerator } from '../renderer/gpu/layers/generatorPaint'
import { clipFrameSource, type CanvasSinkLike, type ClipFrameSource } from './clipFrames'
import { resilientCanvasSink } from './resilientSink'
import { collectClips, compoundSourceFrames, occurrenceKey } from './compoundFrames'
import { remappedSourceFrames } from '../resolver/sourceTime'
import { createSequenceFrameStore, type SequenceFrameStore } from './sequenceFrames'
import { FrameAckGate, pngFrameName } from './pngSink'
import { GifEncoder, gifOutputHeight, planGifFrames } from './gifEncode'
import { openAnimatedImage, openFrameSequence, type SequenceFrameReader, type SequenceImage } from '../media/sequence/SequenceReader'

import { trace, traceEnabled, enableChannels, type TraceChannel } from '../debug/trace'
import { computeExportDimensions } from './outputDimensions'

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
  'assets:sequence': 'EXPORT_ASSETS',
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
import { layoutResolveOptions } from '../resolver/resolveOptions'
import { getTotalFrames } from '../utils/frames'
import { MAX_COMPOUND_DEPTH, type Project } from '../types'
import { resolveExportFormat, type ResolvedExportFormat } from './capabilities'
import { resolveExportRange } from './range'
import type {
  ActiveVideoClip,
  ActiveImageClip,
  ActiveTextClip,
  ActiveShapeClip,
  ActiveFreehandClip,
  ActiveAdjustmentClip,
  ActiveGeneratorClip,
  ActiveCompoundClip,
  ActiveSequenceClip,
  ActiveTransition,
  Scene,
} from '../resolver/scene'
import { resolveDrawRect, normalizeCrop, rectShear, rectTilt, applyShear, type CropRect } from '../renderer/gpu/layers/drawRect'
import { MAX_COMPOUND_SIDE } from '../renderer/gpu/layers/compoundTarget'
import { SCENE_LAYER_ORDER, type SceneLayerKey } from './sceneLayerOrder'
import { type MeasureContext } from '../renderer/gpu/layers/textMeasure'
import { paintText } from '../renderer/gpu/layers/textPaint'
import { freehandFrame, shapeMaskFrame, textMaskFrame } from '../renderer/gpu/layers/elementFrame'
import { paintFreehand } from '../renderer/gpu/layers/freehandPaint'
import { paintShape } from '../renderer/gpu/layers/shapePaint'
import { collectFontIds, ensureFonts } from '../fonts/loader'
import type { ExportOptions, RenderedAudio, WorkerOutMessage } from './types'
import { sourceAwareFetch } from './sources'
import { ExportCapabilityError, WorkerEffectRenderer, kindDrawsTilt, projectNeedsGpu, type ExportSource, type GpuView } from './gpuExport'
import { CANVAS_COMPOSITE_OP, isDrawableMask } from '../renderer/gpu/compositing'

// ---------------------------------------------------------------------------
// Worker message entry point
//
// Installed ONLY inside a real dedicated worker. The check is a WorkerGlobalScope
// instance test, not `typeof self !== 'undefined'`: in a WINDOW `self` exists and
// is `window`, so a presence check would install this handler on the page and
// hijack `window.onmessage`. In Node `self` is absent, and the export unit tests
// import this module directly to drive `renderFrame` — which is the reason this
// guard exists at all, along with the /dev/compound preview-vs-export comparison.
// ---------------------------------------------------------------------------

// PV-P9a-2: the PNG-sequence frame loop (inside `runExport`, one worker
// instance per export) registers its `FrameAckGate` here so this same
// top-level handler can route `png-ack` replies to it. A worker only ever
// runs one export, so a single module-level slot (cleared in `runExport`'s
// existing `finally`) is enough — no export id is needed to disambiguate.
let activePngAckGate: FrameAckGate | null = null

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async (e: MessageEvent) => {
    if (e.data?.type === 'png-ack') {
      activePngAckGate?.ack((e.data as { index: number }).index)
      return
    }
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
      const { buffer, mimeType, container } = await runExport(project, options, audio)
      xlog('worker', 'posting buffer to main thread', { size: fmtBytes(buffer.byteLength), mimeType, container })
      const msg: WorkerOutMessage = { type: 'done', buffer, mimeType, container }
      ;(self as unknown as Worker).postMessage(msg, [buffer])
    } catch (err) {
      xlog('worker', `export failed: ${String(err)}`)
      const msg: WorkerOutMessage =
        err instanceof ExportCapabilityError
          ? { type: 'error', message: err.message, code: 'capability' }
          : { type: 'error', message: String(err) }
      ;(self as unknown as Worker).postMessage(msg)
    }
  }
}

// ---------------------------------------------------------------------------
// Main export logic
// ---------------------------------------------------------------------------

interface RunExportResult {
  buffer: ArrayBuffer
  mimeType: string
  container: string
}

async function runExport(project: Project, options: ExportOptions, audio: RenderedAudio | null): Promise<RunExportResult> {
  const { width: stageWidth, height: stageHeight } = project.stage
  const fps = project.fps
  // The project's FULL frame count. The frame loop below still walks every
  // frame from 0 up to `range.endFrame` (not from `range.startFrame`) so
  // every video/sequence decoder — sequential by contract, see clipFrames.ts
  // — is primed in order right up to the export window; frames before
  // `range.startFrame` are decoded and discarded rather than painted or
  // encoded. This is PV-P9a-1's simplest correct option: it changes nothing
  // about decoder setup or ordering, at the cost of decoding (but not
  // painting/encoding) a prefix the caller does not want.
  const legacyTotalFrames = getTotalFrames(project.clips)

  // PV-P9a-1: container/codec matrix and export range, resolved (and, for the
  // range, validated) here too — independently of exportVideo.ts's own
  // up-front check — so a worker driven directly (e.g. a future non-browser
  // caller) gets the same guarantees. Both are pure/sync; recomputing them
  // from `project`/`options` costs nothing and keeps this the single source
  // of truth rather than trusting a value serialized across the postMessage
  // boundary.
  // PV-P9a-2: PNG sequences have no video/audio codec to resolve and
  // `capabilities.ts` (outside this ticket's file allowlist — it still
  // rejects `container: 'png-sequence'` for PV-P9a-1's own reasons) is
  // never called for this container. `isPng` gates every mediabunny-only
  // step below (CanvasSource/Output/audio track); `format` still gets a
  // real, resolved value from `resolveExportFormat` for every OTHER
  // container so that path is completely unchanged.
  const isPng = (options.container ?? 'mp4') === 'png-sequence'
  const format: ResolvedExportFormat = isPng
    ? { container: 'png-sequence', videoCodec: 'avc', audioCodec: 'aac', mimeType: 'application/zip' }
    : resolveExportFormat({
        container: options.container,
        videoCodec: options.videoCodec,
        audioCodec: options.audioCodec,
        audioBitrate: options.audioBitrate,
        transparent: options.transparent,
      })
  const isGif = format.container === 'gif'
  const range = resolveExportRange(project, options.range)
  // PNG carries alpha natively, per frame, with no encoder/decoder round
  // trip to verify (unlike transparent WebM) — `ensureTransparencyGate`
  // (capabilities.ts) is never consulted here either.
  const transparent = !!options.transparent && (isPng || format.container === 'webm')
  const outputTotalFrames = range.totalFrames

  // Scale the output canvas to the requested resolution while preserving the
  // project stage's aspect ratio — see computeExportDimensions for why this
  // scales against the short edge rather than raw height.
  // REN-5: a GIF defaults to a 480 short edge; an explicit outputHeight overrides the cap.
  const { width, height } = computeExportDimensions(
    stageWidth,
    stageHeight,
    isGif ? gifOutputHeight(stageWidth, stageHeight, options.outputHeight) : options.outputHeight,
  )

  xlog('run', 'starting', {
    stage: `${stageWidth}x${stageHeight}`,
    output: `${width}x${height}`,
    fps,
    legacyTotalFrames,
    range: `[${range.startFrame}, ${range.endFrame})`,
    outputTotalFrames,
    durationSec: (outputTotalFrames / fps).toFixed(2),
    container: format.container,
    transparent,
    videoCodec: format.videoCodec,
    videoBitrate: options.videoBitrate ?? 8_000_000,
    audioCodec: format.audioCodec,
    audioBitrate: options.audioBitrate ?? 128_000,
  })

  if (legacyTotalFrames === 0) throw new Error('ExportWorker: project has no clips')

  // EDX-P3: clips with effects render through the preview's EffectChain on a
  // WebGL2 OffscreenCanvas; everything else stays on the 2D path below.
  // Opened first so a missing capability fails fast, before asset fetches.
  let gpu: WorkerEffectRenderer | null = null
  if (projectNeedsGpu(project)) {
    gpu = WorkerEffectRenderer.create({ width, height }, project.stage, fps)
    xlog('run', 'GPU effect renderer ready (WebGL2 in worker)')
  } else if (project.transitions.length > 0) {
    // Fade/slide/wipe look best on the GPU (both clips keep playing and keep
    // their effects, EDX-P9c) but still export without it via the 2D snapshot.
    try {
      gpu = WorkerEffectRenderer.create({ width, height }, project.stage, fps)
      xlog('run', 'GPU transitions ready (WebGL2 in worker)')
    } catch {
      gpu = null
      xlog('run', 'no WebGL2: transitions use the 2D snapshot fallback')
    }
  }

  const allClips = Object.values(project.clips).flat()
  // Every clip occurrence, compounds expanded, each with the path that
  // identifies it (PV-P1b-1). `allClips` above is TOP-LEVEL ONLY, which is why a
  // compound's video used to get no CanvasSink and its image no ImageBitmap —
  // the asset scan never saw them. Occurrences are a superset, so a project with
  // no compounds behaves exactly as before.
  const occurrences = collectClips(project)
  const nestedOccurrences = occurrences.filter((o) => o.path.length > 1)
  const nestedVideoOccurrences = nestedOccurrences.filter((o) => o.clip.type === 'video' && o.clip.src)
  xlog('run', `clip inventory`, {
    total: allClips.length,
    video: allClips.filter(c => c.type === 'video').length,
    image: allClips.filter(c => c.type === 'image').length,
    audio: allClips.filter(c => c.type === 'audio').length,
    // Merged video clips (embeddedAudio) are in the audio mix too.
    mergedAudio: allClips.filter(c => c.type === 'video' && c.embeddedAudio === true).length,
    text: allClips.filter(c => c.type === 'text').length,
    nestedOccurrences: nestedOccurrences.length,
    nestedVideoOccurrences: nestedVideoOccurrences.length,
  })

  // LM-P1: caller-supplied Blobs (local files) win over fetching the src.
  const fetchBlob = sourceAwareFetch(options.sources, fetchAssetBlob)

  // --- Open mediabunny CanvasSinks for unique video srcs ---
  const videoSrcs = [...new Set(occurrences.filter(c => c.clip.type === 'video' && c.clip.src).map(c => c.clip.src!))]
  xlog('assets:video', `opening ${videoSrcs.length} CanvasSink(s)`)
  const videoSinks = new Map<string, CanvasSinkLike<mb.WrappedCanvas>>()
  for (let i = 0; i < videoSrcs.length; i++) {
    const src = videoSrcs[i]
    xlog('assets:video', `[${i + 1}/${videoSrcs.length}] fetching "${src.slice(-40)}"`)
    const fetchStart = performance.now()
    const blob = await fetchBlob(src, 'video')
    xlog('assets:video', `[${i + 1}/${videoSrcs.length}] fetched`, { size: fmtBytes(blob.size), ms: (performance.now() - fetchStart).toFixed(1) })
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) })
    const track = await input.getPrimaryVideoTrack()
    if (track) {
      // The browser's decoder can die mid-stream on valid files (see
      // resilientSink.ts). Attempt 0 is the default configuration; a failure
      // escalates to software, then hardware.
      videoSinks.set(src, resilientCanvasSink<mb.WrappedCanvas>(
        (attempt) => new mb.CanvasSink(track, attempt === 0 ? undefined : { decoderOptions: { hardwareAcceleration: attempt === 1 ? 'prefer-software' : 'prefer-hardware' } }),
        {
          onRebuild: ({ attempt, resumeIndex, error }) => {
            const message = `Video decoder failed on "${src.slice(-40)}" after ${resumeIndex} frame(s) (${error instanceof Error ? error.message : String(error)}); retrying with ${attempt === 1 ? 'software' : 'hardware'} decoding.`
            xlog('assets:video', message, { attempt, resumeIndex })
            const msg: WorkerOutMessage = { type: 'warning', message }
            ;(self as unknown as Worker).postMessage(msg)
          },
        },
      ))
      xlog('assets:video', `[${i + 1}/${videoSrcs.length}] CanvasSink ready`)
    } else {
      xlog('assets:video', `[${i + 1}/${videoSrcs.length}] WARNING: no primary video track found`)
    }
  }

  // --- Load ImageBitmaps for unique image srcs ---
  const imageSrcs = [...new Set(occurrences.filter(c => c.clip.type === 'image' && c.clip.src).map(c => c.clip.src!))]
  xlog('assets:image', `loading ${imageSrcs.length} ImageBitmap(s)`)
  const imageBitmaps = new Map<string, ImageBitmap>()
  for (let i = 0; i < imageSrcs.length; i++) {
    const src = imageSrcs[i]
    // PV-P6b-4: the main thread already rasterised this src (an SVG, which
    // this worker cannot decode, or a data: URL, which a sandboxed host may
    // refuse to let this worker fetch) and transferred the bitmap in with the
    // start message. Use it as-is instead of fetching/decoding again.
    const pre = options.preDecoded?.[src]
    if (pre) {
      imageBitmaps.set(src, pre)
      xlog('assets:image', `[${i + 1}/${imageSrcs.length}] pre-decoded on the main thread`, { bitmapW: pre.width, bitmapH: pre.height })
      continue
    }
    xlog('assets:image', `[${i + 1}/${imageSrcs.length}] fetching "${src.slice(-40)}"`)
    const fetchStart = performance.now()
    const blob = await fetchBlob(src, 'image')
    const bitmap = await createImageBitmap(blob).catch((e) => {
      if (blob.type.startsWith('image/svg+xml')) {
        throw new Error(`ExportWorker: SVG image "${src}" was not pre-decoded on the main thread`)
      }
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

  // --- Sequence clips (GIF/WebP/PNG/AVIF or numbered frame sequences, PV-P8c) ---
  // Readers are shared by source (sequenceFrames.ts), and every warning is
  // reported at most once per source even though it is checked once per
  // occurrence per frame.
  const reportedSequenceFallback = new Set<string>()
  const reportedSequenceError = new Set<string>()
  const sequences: SequenceFrameStore = createSequenceFrameStore({
    open: (item: ActiveSequenceClip): Promise<SequenceFrameReader> => {
      xlog('assets:sequence', `opening "${(item.src ?? item.frameUrlTemplate ?? '').slice(-40)}"`, { kind: item.kind })
      if (item.kind === 'animated-image') {
        return fetchBlob(item.src!, 'animated image').then((blob) =>
          openAnimatedImage(blob, { src: item.src!, flipY: false }),
        )
      }
      return Promise.resolve(
        openFrameSequence({
          template: item.frameUrlTemplate!,
          frameCount: item.frameCount,
          startNumber: item.startNumber,
          flipY: false,
          loader: (url) => fetchBlob(url, 'sequence frame'),
        }),
      )
    },
    onFallback: (item, reason) => {
      const key = item.id
      if (reportedSequenceFallback.has(key)) return
      reportedSequenceFallback.add(key)
      const why =
        reason === 'no-image-decoder'
          ? 'this browser cannot decode animated images in a background worker'
          : 'this browser cannot decode this image type'
      const message = `"${item.name}" was exported as a still: ${why}.`
      xlog('assets:sequence', message)
      const msg: WorkerOutMessage = { type: 'warning', message }
      ;(self as unknown as Worker).postMessage(msg)
    },
    onError: (item, errMessage) => {
      const key = item.id
      if (reportedSequenceError.has(key)) return
      reportedSequenceError.add(key)
      const message = `"${item.name}" could not be read and was left out: ${errMessage}`
      xlog('assets:sequence', message)
      const msg: WorkerOutMessage = { type: 'warning', message }
      ;(self as unknown as Worker).postMessage(msg)
    },
  })

  // --- Bundled fonts (PV-P4a-2) ---
  // Text paints with the faces the project names by id: load them before the
  // first frame so frame 0 matches the preview. A face that cannot load falls
  // back to its generic family and is reported, never fatal. Nothing inside
  // render()/renderFrame awaits fonts; the only await is before the frame loop.
  const fontIds = collectFontIds(project)
  if (fontIds.length > 0) {
    const warnFont = (message: string) => {
      xlog('run', `font: ${message}`)
      const msg: WorkerOutMessage = { type: 'warning', message }
      ;(self as unknown as Worker).postMessage(msg)
    }
    const fontSet = (self as unknown as { fonts?: FontFaceSet }).fonts
    const baseUrl = options.fonts?.baseUrl
    if (!baseUrl) {
      warnFont(`${fontIds.length} bundled font(s) are used but no font location was given; system fonts are used instead`)
    } else if (!fontSet) {
      warnFont('This browser cannot load fonts inside the export worker; system fonts are used instead')
    } else {
      await timed('run', `ensureFonts(${fontIds.join(', ')})`, () =>
        ensureFonts(fontIds, { baseUrl, fonts: fontSet, onWarning: warnFont }),
      )
    }
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

  // --- Set up the output canvas, and (unless this is a PNG sequence) the
  // mediabunny Output that muxes it into MP4/WebM. A PNG sequence has no
  // container to mux into — each frame becomes its own PNG file below — so
  // none of the mediabunny objects in this block are created for it.
  xlog('mediabunny', `creating OffscreenCanvas ${width}x${height}`)
  const outputCanvas = new OffscreenCanvas(width, height)
  const ctx2d = outputCanvas.getContext('2d')!

  let canvasSource: mb.CanvasSource | null = null
  let output: mb.Output | null = null
  let bufferTarget: mb.BufferTarget | null = null
  let audioSource: mb.AudioSampleSource | null = null
  let pngAckGate: FrameAckGate | null = null
  // REN-5: GIF has no mediabunny Output either; frames go to the in-repo encoder.
  let gifEncoder: GifEncoder | null = null
  let gifPlan: ReturnType<typeof planGifFrames> | null = null
  if (isGif) {
    gifEncoder = new GifEncoder(width, height, 0)
    gifPlan = planGifFrames(outputTotalFrames, fps, options.gifFps)
    xlog('run', 'GIF export — no mediabunny Output', { gifStep: gifPlan.step, gifFrames: gifPlan.delays.length })
  }

  if (isPng) {
    xlog('run', 'PNG sequence export — no mediabunny Output', { pngSinkMode: !!options.pngSinkMode })
    pngAckGate = new FrameAckGate()
    activePngAckGate = pngAckGate
  } else if (!isGif) {
    // PV-P9a-1: `format` (resolved above, before any asset was fetched) is the
    // single source for container/codec — no more hardcoded 'avc'/'aac'/MP4.
    const videoBitrate = options.videoBitrate ?? 8_000_000
    xlog('mediabunny', `creating CanvasSource`, { codec: format.videoCodec, bitrate: videoBitrate, alpha: transparent ? 'keep' : 'discard' })
    canvasSource = new mb.CanvasSource(outputCanvas, {
      codec: format.videoCodec,
      bitrate: videoBitrate,
      // Only a transparent WebM asks the encoder to keep alpha; MP4 can't carry
      // it (resolveExportFormat already rejected that combination) and an
      // opaque WebM keeps the smaller, encoder-default 'discard' path.
      ...(transparent ? { alpha: 'keep' as const } : {}),
    })

    xlog('mediabunny', `creating BufferTarget + ${format.container.toUpperCase()} Output`)
    bufferTarget = new mb.BufferTarget()
    const outputFormat = format.container === 'webm' ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat()
    output = new mb.Output({ format: outputFormat, target: bufferTarget })
    output.addVideoTrack(canvasSource)
    xlog('mediabunny', 'video track added to output')

    if (audio) {
      const audioBitrate = options.audioBitrate ?? 128_000
      xlog('mediabunny', `creating AudioSampleSource`, { codec: format.audioCodec, bitrate: audioBitrate })
      audioSource = new mb.AudioSampleSource({
        codec: format.audioCodec,
        bitrate: audioBitrate,
      })
      output.addAudioTrack(audioSource)
      xlog('mediabunny', 'audio track added to output')
    }

    await timed('mediabunny', 'output.start()', () => output!.start())

    if (audio && audioSource) {
      await timed('mediabunny', 'audioSource.add() — encoding mixed PCM', () => addAudioMix(audioSource!, audio))
    }
  }

  // --- Per-clip sequential decoders ---
  // Each video clip gets its own canvasesAtTimestamps() generator fed with the
  // clip's source timestamps in monotonically increasing order (one per export
  // frame). This lets mediabunny decode each source packet at most once and
  // never re-seek from a keyframe — eliminating the corrupt green-band artifacts
  // that occurred when getCanvas() was called once per frame (random-access).
  type ClipDecoder = {
    source: ClipFrameSource<mb.WrappedCanvas>
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
    // `speed` (fast-forward/slow-down) scales how far the source advances per
    // export frame — the timestamps stay monotonically increasing for any
    // speed >= 0, so the sequential canvasesAtTimestamps() generator handles
    // 2x/4x by naturally skipping source frames, with no re-seek required.
    // A time-remapped clip (EDX-P6) takes its frames from the SAME mapping the
    // preview uses; clipFrameSource keeps decode sequential for ramps, freezes
    // and reverse (clipFrames.ts).
    clipDecoders.set(clip.id, {
      source: clipFrameSource(sink, clip, remappedSourceFrames(clip), fps),
      clipStartFrame: clip.startFrame,
      clipEndFrame,
    })
  }

  // --- Per-occurrence decoders for videos inside compounds (PV-P1b-1) ---
  // Same sequential contract as above, one decoder per OCCURRENCE rather than per
  // clip id, keyed by `occurrenceKey`. A decoder per clip id is not enough: the
  // same child clip can appear in two compounds, and the two occurrences want
  // different source frames on the same output frame, so one id cannot key both.
  //
  // A nested clip's active window is expressed in its own level's frames, so the
  // frame loop cannot test `frame >= clip.startFrame` the way it does at the
  // root. It asks `compoundSourceFrames` instead, which resolves the whole
  // occurrence tree for one output frame and simply omits what is not active —
  // the same answer the resolver used to build the scene being painted.
  const occurrenceDecoders = new Map<string, ClipDecoder>()
  for (const occurrence of nestedVideoOccurrences) {
    const sink = videoSinks.get(occurrence.clip.src!)
    if (!sink) continue
    occurrenceDecoders.set(occurrence.key, {
      source: clipFrameSource(sink, occurrence.clip, remappedSourceFrames(occurrence.clip), fps),
      // The window is resolved per frame by `compoundSourceFrames`, not here;
      // these are never read for occurrences and exist only to satisfy the shape.
      clipStartFrame: 0,
      clipEndFrame: 0,
    })
  }
  // Zero cost for a project with no nested video: the per-frame project walk that
  // answers "which occurrences are active" is skipped entirely.
  const needsOccurrenceWalk = occurrenceDecoders.size > 0
  if (nestedVideoOccurrences.length > 0) {
    xlog('frames', `setting up ${occurrenceDecoders.size} per-occurrence decoder(s) for compound video`)
  }

  // PV-P3b: a measurer over a dedicated 1×1 OffscreenCanvas, built once and
  // only when the project uses layout — the same engine the preview uses, so
  // a text-dependent constraint measures identically in both.
  const resolveOptions = layoutResolveOptions(project, () => new OffscreenCanvas(1, 1).getContext('2d'))

  // --- Sequential frame render loop ---
  //
  // PV-P9a-1: the loop still walks every ABSOLUTE frame from 0, not from
  // `range.startFrame` — every clip decoder above (video, occurrence,
  // sequence) is sequential by contract (clipFrames.ts) and was seeded with
  // one timestamp per frame of its own active window, so skipping straight to
  // `range.startFrame` would desync any decoder whose clip started earlier
  // and hand back the wrong canvas. Frames before `range.startFrame` are
  // decoded (to keep every decoder in step) but never painted or encoded —
  // see the `inRange` gate below. The loop stops at `range.endFrame`, so a
  // range near the project's start pays almost nothing extra, and `range`
  // covering everything (the default) is byte-identical to the old
  // `[0, totalFrames)` loop.
  xlog('frames', `starting frame loop`, { legacyTotalFrames, range: `[${range.startFrame}, ${range.endFrame})`, outputTotalFrames, fps })
  const loopStart = performance.now()
  const logEvery = Math.max(1, Math.floor(range.endFrame / 10))
  let lastFrameTime = loopStart
  let outputFrame = 0

  // Holds a frozen bitmap of each outgoing clip for the duration of its
  // transition window. Drawn on top at globalAlpha=1-t to produce a crossfade
  // while the GPU only decodes the incoming clip. This is the snapshot path for
  // transitions the GPU transition pass does not draw.
  type SnapshotEntry = { source: CanvasImageSource & { width: number; height: number }; owned: boolean }
  const transitionSnapshots = new Map<string, SnapshotEntry>()

  try {
    for (let frame = 0; frame < range.endFrame; frame++) {
    const inRange = frame >= range.startFrame
    if (frame === 0 || frame % logEvery === 0 || frame === range.endFrame - 1) {
      const now = performance.now()
      const elapsed = now - loopStart
      const avgMsPerFrame = frame > 0 ? elapsed / frame : 0
      const pct = Math.round((frame / range.endFrame) * 100)
      xlog('frames', `frame ${frame}/${range.endFrame} (${pct}%)`, {
        avgMsPerFrame: avgMsPerFrame.toFixed(1),
        sinceLastLog: (now - lastFrameTime).toFixed(1) + 'ms',
        inRange,
      })
      lastFrameTime = now
    }

    const scene = resolveTimeline(frame, project, resolveOptions)

    // Advance each active clip's decoder by one step and collect the resulting
    // canvases. Every generator was seeded with exactly one timestamp per export
    // frame in order, so each .next() call returns the canvas for this frame.
    const clipCanvases = new Map<string, mb.WrappedCanvas | null>()
    for (const [clipId, decoder] of clipDecoders) {
      if (frame >= decoder.clipStartFrame && frame < decoder.clipEndFrame) {
        clipCanvases.set(clipId, await decoder.source.next())
      }
    }

    // Videos inside compounds, keyed by occurrence. `compoundSourceFrames`
    // resolves the occurrence tree for THIS output frame and omits whatever is
    // not active, which is the only thing that knows a nested clip's window.
    // The await stays here, outside `paintScene`, so the paint walk stays
    // synchronous and re-entrant.
    const occurrenceCanvases = new Map<string, mb.WrappedCanvas | null>()
    if (needsOccurrenceWalk) {
      const active = compoundSourceFrames(project, frame)
      for (const [key, decoder] of occurrenceDecoders) {
        if (!active.has(key)) continue
        occurrenceCanvases.set(key, await decoder.source.next())
      }
    }

    // Sequence clips (GIF/WebP/PNG/AVIF or numbered sequences, PV-P8c), at this
    // level and inside every active compound. The await stays here, outside
    // `paintScene`, for the same reason the video decoders do: the paint walk
    // stays synchronous. A project with no sequence clips walks an empty list
    // and never opens a reader.
    const sequenceImages = new Map<string, SequenceImage>()
    for (const { key, item } of collectSequenceItems(scene, [])) {
      const img = await sequences.frameFor(key, item)
      if (img) sequenceImages.set(key, img)
    }
    sequences.retain(new Set(sequenceImages.keys()))

    // Everything below this point is the actual paint + encode: it only runs
    // for a frame inside the export range. A frame decoded above just to keep
    // the sequential decoders in step is otherwise inert — no snapshot is
    // captured for a transition that plays before the range, nothing is
    // painted, and no packet is encoded for it.
    if (inRange) {
      // 2D fallback only (no WebGL2): capture a snapshot of the outgoing clip on
      // the first frame of each transition. The canvas is already decoded above.
      for (const tr of gpu ? [] : scene.transitions) {
        if (transitionSnapshots.has(tr.id)) continue
        const fromVideo = scene.videos.find(v => v.id === tr.fromClipId)
        const fromImage = scene.images.find(i => i.id === tr.fromClipId)
        const fromSequence = scene.sequences?.find(s => s.id === tr.fromClipId)
        if (fromVideo) {
          const wrapped = clipCanvases.get(fromVideo.id) ?? null
          if (wrapped) {
            const bmp = await createImageBitmap(wrapped.canvas)
            transitionSnapshots.set(tr.id, { source: bmp, owned: true })
          }
        } else if (fromImage) {
          const bmp = imageBitmaps.get(fromImage.src)
          if (bmp) transitionSnapshots.set(tr.id, { source: bmp, owned: false })
        } else if (fromSequence) {
          // A copy, not the store's own image: the store closes it the moment
          // the sequence's index changes, which would leave a closed bitmap
          // under the snapshot for the rest of the transition window.
          const img = sequenceImages.get(fromSequence.id)
          if (img) {
            const bmp = await createImageBitmap(img.source)
            transitionSnapshots.set(tr.id, { source: bmp, owned: true })
          }
        }
      }

      await renderFrame(ctx2d, scene, clipCanvases, imageBitmaps, transitionSnapshots, width, height, frame, gpu, occurrenceCanvases, sequenceImages, transparent)
      if (isPng) {
        // PV-P9a-2: encode the painted canvas to a PNG and hand it to the
        // main thread, then WAIT for its ack before this loop iterates
        // again — `pngAckGate.expect` below throws synchronously if a
        // previous frame is somehow still unacknowledged, which is what
        // keeps at most one frame's bytes ever in flight regardless of how
        // many frames the export has.
        const pngBlob = await outputCanvas.convertToBlob({ type: 'image/png' })
        const buffer = await pngBlob.arrayBuffer()
        const name = pngFrameName(outputFrame)
        const waiter = pngAckGate!.expect(outputFrame)
        const frameMsg: WorkerOutMessage = { type: 'png-frame', index: outputFrame, name, buffer }
        ;(self as unknown as Worker).postMessage(frameMsg, [buffer])
        await waiter
      } else if (isGif) {
        // Keep every gifPlan.step-th frame; the rest were rendered only to keep
        // the sequential decoders in step with the timeline.
        if (outputFrame % gifPlan!.step === 0) {
          const img = ctx2d.getImageData(0, 0, width, height)
          gifEncoder!.addFrame(img.data, gifPlan!.delays[outputFrame / gifPlan!.step])
        }
      } else {
        // Encoded timestamp is ZERO-BASED (`outputFrame`, i.e. `frame - range.startFrame`),
        // not the absolute project frame — PV-P9a-1's contract for a ranged
        // export: output frame 0 is always the export's own t=0, matching the
        // range-aware audio mix's zero-based schedule (exportVideo.ts).
        await canvasSource!.add(outputFrame / fps, 1 / fps)
      }

      // Release snapshots whose transition window has closed.
      const activeIds = new Set(scene.transitions.map(tr => tr.id))
      for (const [id, snap] of transitionSnapshots) {
        if (!activeIds.has(id)) {
          if (snap.owned) (snap.source as ImageBitmap).close()
          transitionSnapshots.delete(id)
        }
      }

      const msg: WorkerOutMessage = { type: 'progress', frame: outputFrame, totalFrames: outputTotalFrames }
      ;(self as unknown as Worker).postMessage(msg)
      outputFrame++
    }
    }
  } finally {
    // Runs whether the loop finished, threw, or the export was aborted. Without
    // this, an error mid-export leaked every loaded ImageBitmap, any transition
    // snapshot still open, and the WebGL2 context.
    //
    // `gpu.runs` is read BEFORE dispose, and the bitmaps are released exactly
    // once — see `releaseOwnedBitmaps`, which clears as it closes so a second
    // call is a no-op rather than a double `close()`.
    const released = releaseOwnedBitmaps(imageBitmaps, transitionSnapshots)
    sequences.dispose()
    if (gpu) {
      xlog('run', `GPU effect passes`, { clipDraws: gpu.runs })
      gpu.dispose()
    }
    // PV-P9a-2: whether the loop finished, threw or aborted, this worker's
    // export is over — never leave a stale gate around to (mis)route a
    // stray 'png-ack' into a promise nothing is awaiting any more.
    activePngAckGate = null
    xlog('run', `cleanup complete`, { releasedBitmaps: released })
  }

  const loopMs = performance.now() - loopStart
  xlog('frames', `loop complete`, {
    legacyTotalFrames,
    outputTotalFrames,
    totalMs: loopMs.toFixed(0),
    avgMsPerFrame: (loopMs / range.endFrame).toFixed(1),
  })

  if (isPng) {
    // Every frame was already sent (and acknowledged) individually above;
    // there is no muxed buffer to finalize. exportVideo.ts builds the real
    // Blob (a bounded in-memory ZIP, or an empty one when a directory sink
    // was used) from the frames it already wrote — this empty buffer is
    // never treated as the export's output.
    xlog('run', 'export complete', { outputTotalFrames, container: format.container })
    return { buffer: new ArrayBuffer(0), mimeType: 'application/octet-stream', container: format.container }
  }

  if (isGif) {
    const bytes = gifEncoder!.finish()
    xlog('run', 'export complete', { outputSize: fmtBytes(bytes.byteLength), mimeType: format.mimeType, container: format.container })
    // A copy: finish() returns a view that may not own its whole buffer.
    return { buffer: bytes.slice().buffer as ArrayBuffer, mimeType: format.mimeType, container: format.container }
  }

  await timed('mediabunny', 'output.finalize()', () => output!.finalize())

  if (!bufferTarget!.buffer) throw new Error('ExportWorker: buffer is null after finalize')
  xlog('run', `export complete`, { outputSize: fmtBytes(bufferTarget!.buffer.byteLength), mimeType: format.mimeType, container: format.container })
  return { buffer: bufferTarget!.buffer, mimeType: format.mimeType, container: format.container }
}

/**
 * Close every ImageBitmap the export worker owns, exactly once.
 *
 * Two sources of ownership: the bitmaps loaded for image clips, and the
 * snapshots the 2D transition fallback creates with `createImageBitmap` (the ones
 * taken from an image clip are NOT owned — they alias a loaded bitmap, and
 * closing them here would close a bitmap the picture still needs).
 *
 * Clearing each map as it closes is what makes "exactly once" true by
 * construction rather than by discipline: a second call finds empty maps and
 * closes nothing, so a `finally` can call this unconditionally without knowing
 * whether the loop already ran the per-frame release. Identity is de-duplicated
 * too, so a bitmap reachable from both maps is still closed once.
 *
 * Returns how many bitmaps were closed, for the trace.
 */
export function releaseOwnedBitmaps(
  imageBitmaps: Map<string, ImageBitmap>,
  transitionSnapshots: Map<string, { source: CanvasImageSource & { width: number; height: number }; owned: boolean }>,
): number {
  const closed = new Set<unknown>()
  let count = 0
  const closeOnce = (bmp: ImageBitmap) => {
    if (closed.has(bmp)) return
    closed.add(bmp)
    bmp.close()
    count++
  }

  for (const snap of transitionSnapshots.values()) {
    if (snap.owned) closeOnce(snap.source as ImageBitmap)
  }
  transitionSnapshots.clear()

  for (const bmp of imageBitmaps.values()) closeOnce(bmp)
  imageBitmaps.clear()

  return count
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
// Sequence clips (GIF/WebP/PNG/AVIF or numbered sequences, PV-P8c)
// ---------------------------------------------------------------------------

/**
 * Every sequence item this scene shows, at this level and inside every active
 * compound, each with the key its decoded image is held under.
 *
 * A top-level item is keyed by its bare clip id, matching `clipCanvases`; an
 * item inside a compound is keyed the same way `occurrenceCanvases` keys a
 * nested video — `occurrenceKey([...path, item.id])` — because one child id
 * can be live in two compounds on the same frame holding different pictures.
 * Bounded by `MAX_COMPOUND_DEPTH`, exactly as `collectClips`/`compoundSourceFrames`
 * are: a compound deeper than the resolver draws nothing there.
 */
/** The key a sequence item's decoded image is held/looked up under — see {@link collectSequenceItems}. */
function sequenceKeyFor(path: readonly string[], id: string): string {
  return path.length > 0 ? occurrenceKey([...path, id]) : id
}

function collectSequenceItems(
  scene: Scene,
  path: readonly string[],
  depth = 0,
): Array<{ key: string; item: ActiveSequenceClip }> {
  const out: Array<{ key: string; item: ActiveSequenceClip }> = []
  for (const item of scene.sequences ?? []) {
    out.push({ key: sequenceKeyFor(path, item.id), item })
  }
  if (depth < MAX_COMPOUND_DEPTH) {
    for (const compound of scene.compounds ?? []) {
      out.push(...collectSequenceItems(compound.scene, [...path, compound.id], depth + 1))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Frame renderer
// ---------------------------------------------------------------------------

/**
 * Composite one frame. Exported for the parity harness and tests only.
 *
 * Everything is drawn in the project's LOGICAL stage units (the same units
 * the preview's draw rects, font sizes and transforms use) under one scale
 * transform onto the output canvas. Drawing in output pixels instead — as
 * this function did before EDX-P3 — sized text and transformed clips
 * against the output resolution, so a 480p export of a 1080-wide project
 * drew them 2.25× too large. At native resolution the scale is 1 and the
 * output is unchanged.
 */
export async function renderFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  scene: ReturnType<typeof resolveTimeline>,
  clipCanvases: Map<string, mb.WrappedCanvas | null>,
  imageBitmaps: Map<string, ImageBitmap>,
  transitionSnapshots: Map<string, { source: CanvasImageSource & { width: number; height: number }; owned: boolean }>,
  outW: number,
  outH: number,
  frameIndex: number,
  gpu: WorkerEffectRenderer | null = null,
  occurrenceCanvases: Map<string, mb.WrappedCanvas | null> = new Map(),
  sequenceImages: Map<string, SequenceImage> = new Map(),
  /**
   * PV-P9a-1: skip the opaque black background fill for a transparent WebM
   * export, so the canvas's own alpha channel (cleared, not filled) survives
   * into the encoded frame. Every existing caller omits this and keeps the
   * exact opaque behaviour — clear + black fill — that predates this ticket.
   */
  transparent = false,
): Promise<void> {
  const isDebugFrame = frameIndex === 0
  const stageW = scene.stage.width
  const stageH = scene.stage.height

  if (isDebugFrame) {
    xlog('render:frame0', `scene layers`, {
      videos: scene.videos.length,
      images: scene.images.length,
      texts: scene.texts.length,
      shapes: scene.shapes.length,
      freehand: scene.freehand.length,
    })
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, outW, outH)
  if (!transparent) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, outW, outH)
  }
  // Transparent output stops here: the canvas stays cleared (alpha 0) behind
  // whatever the scene paints, and every layer below composites onto it with
  // its normal premultiplied alpha — nothing about how a layer draws itself
  // changes for transparency, only that there is no opaque backdrop under it.
  // Logical stage units from here on (see the doc comment above).
  ctx.setTransform(outW / stageW, 0, 0, outH / stageH, 0, 0)

  const env: DrawEnv = {
    gpu,
    clipCanvases,
    occurrenceCanvases,
    imageBitmaps,
    sequenceImages,
    transitionSnapshots,
    stageW,
    stageH,
    outW,
    outH,
    frameIndex,
    // A compound's picture is never smaller than the stage-sized buffer it has
    // always had, whatever the stage: only content bigger than both is capped.
    pictureCap: Math.max(MAX_COMPOUND_SIDE, stageW, stageH),
    isDebugFrame,
    stats: { entries: 0, compounds: 0, deepest: 0 },
  }

  paintScene(scene, env, ctx, 0, [])

  ctx.setTransform(1, 0, 0, 1, 0, 0)

  if (isDebugFrame) {
    const { entries, compounds, deepest } = env.stats
    xlog('render:frame0', `frame 0 draw complete — ${entries} layer(s) composited onto ${stageW}x${stageH}`, {
      compounds,
      deepestCompoundDepth: deepest,
    })
  }
}

/**
 * Paint one scene onto `target`, which is already in stage units.
 *
 * The depth-0 walk is the body this function was extracted from, in the same
 * order, and `__tests__/compoundExport.test.ts` pins that order — if this
 * reorders, drops or double-paints a clip at depth 0, that test fails.
 *
 * `depth` selects the scratch record (see `DepthScratch`): every buffer a clip
 * is painted through is the one owned by this depth, so a child scene can
 * never overwrite a buffer its parent still holds.
 *
 * `path` is this occurrence's clip-id path, empty at the root. It is how a
 * nested call will find the decoded picture for each child clip, keyed the same
 * way as `compoundFrames.occurrenceKey`; nothing reads it until compounds are
 * wired, and it must not be used for anything order-dependent.
 *
 * Tallying the paint for the frame-0 trace goes through `env.stats`, so this
 * function returns nothing.
 */
function paintScene(
  scene: ReturnType<typeof resolveTimeline>,
  env: DrawEnv,
  target: OffscreenCanvasRenderingContext2D,
  depth: number,
  path: readonly string[],
): void {
  const { gpu, stageW, stageH, outW, outH, frameIndex, transitionSnapshots } = env

  // Concatenated in the preview's layer-registration order, so the stable sort
  // below breaks a zIndex tie the way RenderGraph does. Roto masks are a review
  // overlay the export never draws.
  const items: EffectEntry[] = SCENE_LAYER_ORDER.flatMap((key): EffectEntry[] => {
    const kind = ENTRY_KIND[key]
    if (!kind) return []
    return ((scene[key] ?? []) as Array<EffectEntry['item']>).map(item => ({ kind, item }) as EffectEntry)
  }).sort((a, b) => a.item.zIndex - b.item.zIndex)

  // Tally for the frame-0 trace: every entry at this level, plus how deep the
  // compound nesting actually went. `deepest` counts levels of compounds, so a
  // flat project reports 0 and a compound inside a compound reports 2.
  env.stats.entries += items.length
  for (const entry of items) {
    if (entry.kind !== 'compound') continue
    env.stats.compounds++
    if (depth + 1 > env.stats.deepest) env.stats.deepest = depth + 1
  }

  // Track mattes (EDX-P7): paint each matte source alone at output size, hand
  // it to the GPU, and hide it from the picture — as the preview does.
  const matteIds = mattesInUse(items)
  if (gpu && matteIds.size > 0) {
    let slot = 0
    for (const entry of items) {
      if (!matteIds.has(entry.item.id)) continue
      const canvas = matteCanvas(depth, slot++, outW, outH)
      const mctx = canvas.getContext('2d')
      if (!mctx) continue
      mctx.setTransform(1, 0, 0, 1, 0, 0)
      mctx.globalAlpha = 1
      mctx.globalCompositeOperation = 'source-over'
      mctx.clearRect(0, 0, outW, outH)
      mctx.setTransform(outW / stageW, 0, 0, outH / stageH, 0, 0)
      drawEntry(depth, path, mctx, entry, env)
      gpu.setMatte(entry.item.id, canvas, env.gpuView?.keyPrefix)
    }
  }

  // Transitions (EDX-P9c). On the GPU: paint each clip of the pair alone at
  // output size (effects and all) and composite them with the preview's
  // transition shader where the incoming clip sits. Without it: hide the
  // outgoing clip and paint its snapshot at the end (the legacy 2D path).
  const trFrom = new Map<string, ActiveTransition>()
  const trTo = new Map<string, ActiveTransition>()
  for (const tr of scene.transitions) {
    const hasFrom = items.some((e) => e.item.id === tr.fromClipId)
    const hasTo = items.some((e) => e.item.id === tr.toClipId)
    if (!hasFrom || (gpu && !hasTo)) continue
    trFrom.set(tr.fromClipId, tr)
    if (gpu) trTo.set(tr.toClipId, tr)
  }

  for (const entry of items) {
    if (matteIds.size > 0 && matteIds.has(entry.item.id)) continue
    if (trFrom.has(entry.item.id)) continue
    const tr = gpu ? trTo.get(entry.item.id) : undefined
    if (tr && gpu) {
      const fromEntry = items.find((e) => e.item.id === tr.fromClipId)!
      const a = paintAlone(depth, path, 0, fromEntry, env, outW, outH)
      const b = paintAlone(depth, path, 1, entry, env, outW, outH)
      const out = a && b ? gpu.drawTransition(a, b, { kind: tr.kind, t: tr.t, ...(tr.direction ? { direction: tr.direction } : {}) }, frameIndex, env.gpuView) : null
      if (out) {
        target.save()
        target.globalAlpha = 1
        target.drawImage(out, 0, 0, stageW, stageH)
        target.restore()
        continue
      }
      drawEntry(depth, path, target, fromEntry, env)
    }
    drawEntry(depth, path, target, entry, env)
  }
  // Only the top level ends the frame, as RenderGraph does: a nested scene's
  // mattes are released by its compound (paintCompoundPicture), and ending the
  // frame here would free the parent's mattes while the parent still needs them.
  if (gpu && depth === 0 && (matteIds.size > 0 || trTo.size > 0)) gpu.endFrame()

  // 2D fallback transition pass — the snapshot of the outgoing clip.
  for (const tr of gpu ? [] : scene.transitions) {
    const snap = transitionSnapshots.get(tr.id)
    if (!snap) continue
    target.save()

    if (tr.kind === 'slide') {
      const sign = tr.direction === 'left' ? -1 : 1
      target.translate(sign * tr.t * stageW, 0)
      drawMedia(target, snap.source, undefined, stageW, stageH)
    } else if (tr.kind === 'wipe') {
      // Reveal incoming clip from the right by shrinking the snapshot's visible area
      target.beginPath()
      target.rect(0, 0, stageW * (1 - tr.t), stageH)
      target.clip()
      drawMedia(target, snap.source, undefined, stageW, stageH)
    } else {
      // fade (default)
      target.globalAlpha = 1 - tr.t
      drawMedia(target, snap.source, undefined, stageW, stageH)
    }

    target.restore()
  }
}

// ---------------------------------------------------------------------------
// One clip onto a 2D context (the frame, or a matte canvas)
// ---------------------------------------------------------------------------

interface DrawEnv {
  gpu: WorkerEffectRenderer | null
  clipCanvases: Map<string, mb.WrappedCanvas | null>
  /**
   * Decoded frames for videos inside compounds, keyed by `occurrenceKey`.
   *
   * A separate map from `clipCanvases` on purpose: that one is keyed by bare clip
   * id because that is what the root walk and the transition-snapshot lookups
   * have always used, and changing it would touch the flat path for no gain. A
   * nested lookup must use the full path, because one child id can be live in two
   * compounds at once and the two occurrences want different pictures.
   */
  occurrenceCanvases: Map<string, mb.WrappedCanvas | null>
  imageBitmaps: Map<string, ImageBitmap>
  /**
   * Decoded sequence-clip frames, at this level and inside every active
   * compound (PV-P8c). Keyed the same way `collectSequenceItems` builds its
   * keys: a top-level item by its bare clip id, a nested one by
   * `occurrenceKey([...path, item.id])` — one map covers both because the two
   * key shapes never collide (a JSON-encoded path always starts with `[`).
   */
  sequenceImages: Map<string, SequenceImage>
  /** Outgoing-clip snapshots for the 2D fallback transition pass. */
  transitionSnapshots: Map<string, { source: CanvasImageSource & { width: number; height: number }; owned: boolean }>
  stageW: number
  stageH: number
  /** Output size. Equals the stage size at scale 1; they differ otherwise. */
  outW: number
  outH: number
  frameIndex: number
  /**
   * Where GPU draws at this level happen, when it is not the root of the frame:
   * a compound's nested scene has its own stage, fps, matte namespace and
   * target size (EXP-1). Undefined at the root, where the renderer's defaults
   * are the output frame.
   */
  gpuView?: GpuView
  /** Longest edge a compound's picture may have; see `compoundPictureSize`. */
  pictureCap: number
  isDebugFrame: boolean
  /**
   * Per-frame paint tally, read by the frame-0 trace.
   *
   * Accumulated through `env` rather than returned, because the count has to
   * travel back up through `drawEntry`, which returns nothing and is called from
   * four places. `deepest` is the compound nesting actually painted, so the
   * trace distinguishes "4 layers" at the root from "4 layers across 3 levels".
   */
  stats: { entries: number; compounds: number; deepest: number }
}

/** Ids of drawn clips that another drawn clip uses as its track matte. */
function mattesInUse(items: ReadonlyArray<EffectEntry>): Set<string> {
  const wanted = new Set<string>()
  for (const e of items) if (e.item.matte?.sourceClipId) wanted.add(e.item.matte.sourceClipId)
  const present = new Set<string>()
  if (wanted.size === 0) return present
  for (const e of items) if (wanted.has(e.item.id)) present.add(e.item.id)
  return present
}

/**
 * Per-depth scratch, so a child paint can never overwrite a buffer its parent
 * is still holding.
 *
 * `paintToScratch` RETURNS the shared canvas and its caller reads it back
 * immediately (`ctx.drawImage(flat, …)` or `gpu.draw({ source: flat })`). With
 * one module-level scratch, a child painting at depth 1 while a parent is
 * midway through `drawWithEffects` would hand back the very buffer the parent
 * is about to read — the child's content, at the parent's opacity. A stack
 * indexed by depth is the fix; a "reuse it if the size matches" cache is not,
 * because that is what makes the bug intermittent.
 *
 * Depth 0 keeps the old behaviour exactly: the first use at each slot
 * allocates, later frames reuse. `MAX_COMPOUND_DEPTH` bounds the stack.
 */
interface DepthScratch {
  /** Stage-sized scratch for painting text/shape/freehand before the GPU pass. */
  paint: OffscreenCanvas | null
  /**
   * Stage-sized scratch holding a compound's flattened picture: the whole child
   * scene painted at this depth, which `drawMedia` then places like an image.
   * Separate from `paint` so a compound's picture and a blend-mode clip's
   * flattening never share a buffer.
   */
  picture: OffscreenCanvas | null
  /**
   * Scratch holding a faded layer flattened at the resolution it is drawn at
   * (EXP-2); separate from `paint` so a stage-sized effect/blend flatten and an
   * output-sized fade never trade buffers.
   */
  fade: OffscreenCanvas | null
  /** Output-sized scratch canvases, one per matte slot. */
  mattes: OffscreenCanvas[]
  /** Output-sized scratch canvases for the two sides of a transition. */
  transitions: OffscreenCanvas[]
}

const scratchStack: DepthScratch[] = []

/** The scratch record owned by `depth`, created on first use. */
function scratchAt(depth: number): DepthScratch {
  let s = scratchStack[depth]
  if (!s) {
    s = { paint: null, picture: null, fade: null, mattes: [], transitions: [] }
    scratchStack[depth] = s
  }
  return s
}

/** Paint one clip alone, at output size, into transition slot `slot`. */
function paintAlone(depth: number, path: readonly string[], slot: number, entry: EffectEntry, env: DrawEnv, outW: number, outH: number): OffscreenCanvas | null {
  const scratch = scratchAt(depth)
  let c = scratch.transitions[slot]
  if (!c || c.width !== outW || c.height !== outH) {
    c = new OffscreenCanvas(outW, outH)
    scratch.transitions[slot] = c
  }
  const p = c.getContext('2d')
  if (!p) return null
  p.setTransform(1, 0, 0, 1, 0, 0)
  p.globalAlpha = 1
  p.globalCompositeOperation = 'source-over'
  p.clearRect(0, 0, outW, outH)
  p.setTransform(outW / env.stageW, 0, 0, outH / env.stageH, 0, 0)
  drawEntry(depth, path, p, entry, env)
  return c
}

function matteCanvas(depth: number, slot: number, w: number, h: number): OffscreenCanvas {
  const scratch = scratchAt(depth)
  let c = scratch.mattes[slot]
  if (!c || c.width !== w || c.height !== h) {
    c = new OffscreenCanvas(w, h)
    scratch.mattes[slot] = c
  }
  return c
}

/**
 * Draw one clip onto `ctx` (already in stage units). GPU for effects, masks,
 * mattes and adjustment clips; Canvas2D for everything else, with blend
 * modes as composite operations.
 */
function drawEntry(depth: number, path: readonly string[], ctx: OffscreenCanvasRenderingContext2D, entry: EffectEntry, env: DrawEnv): void {
  const { gpu, clipCanvases, imageBitmaps, stageW, stageH, frameIndex, isDebugFrame } = env

  if (entry.kind === 'adjustment') {
    if (gpu) drawAdjustment(ctx, gpu, entry.item, stageW, stageH, frameIndex, env.gpuView)
    return
  }

  // Effects, masks and mattes: the GPU draws the whole clip (placement and
  // opacity included) onto a transparent frame-sized canvas, composited here.
  if (
    gpu &&
    (entry.item.effects?.length || isDrawableMask(entry.item.mask) || entry.item.matte || entryTilts(entry)) &&
    drawWithEffects(depth, path, ctx, gpu, entry, env)
  ) {
    return
  }

  // Blend modes (EDX-P7): Canvas2D's composite operations implement the
  // same W3C formulas as the preview's blend shader. Painted kinds are
  // flattened first so a text panel and its glyphs blend as one layer,
  // exactly as the preview blends the whole text texture.
  const blend = entry.item.blend && entry.item.blend !== 'normal' ? entry.item.blend : undefined
  if (blend && (entry.kind === 'text' || entry.kind === 'shape' || entry.kind === 'freehand' || entry.kind === 'generator' || entry.kind === 'compound')) {
    const flat = paintToScratch(depth, path, entry, env)
    if (flat) {
      ctx.save()
      ctx.globalAlpha = entry.item.opacity ?? 1
      ctx.globalCompositeOperation = CANVAS_COMPOSITE_OP[blend]
      // A compound's picture is its content, not a stage: it is placed like an
      // image (below), not stretched over the frame.
      if (entry.kind === 'compound') {
        drawMedia(ctx, flat, entry.item.transform, stageW, stageH, entry.item.cornerRadius, entry.item.crop, compoundContent(entry.item, env))
      } else {
        ctx.drawImage(flat, 0, 0, stageW, stageH)
      }
      ctx.restore()
      return
    }
  }

  // Opacity (EXP-2): the preview rasterises a painted layer to one texture and
  // draws it once with uOpacity. A globalAlpha on the direct paint would instead
  // composite its parts one by one (outline, glyph, shadow, panel, stroke, fill),
  // each showing through the next. Flatten at alpha 1 first, then fade the whole.
  // Opacity 1 keeps the direct path, call for call; so does a layer that is one
  // fill or one stroke, where the two are the same pixels and the flatten (a
  // stage-sized clear and blend per layer per frame) would be pure cost.
  const opacity = entry.item.opacity ?? 1
  if (opacity < 1 && (entry.kind === 'text' || entry.kind === 'shape' || entry.kind === 'freehand' || entry.kind === 'generator') && !isSinglePart(entry)) {
    const faded = paintFaded(depth, ctx, entry, env)
    if (faded) {
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.drawImage(faded, 0, 0, stageW, stageH)
      ctx.restore()
      return
    }
  }

  ctx.save()
  ctx.globalAlpha = entry.item.opacity ?? 1
  if (blend) ctx.globalCompositeOperation = CANVAS_COMPOSITE_OP[blend]

  if (entry.kind === 'video') {
    // Canvases are pre-decoded sequentially — no per-frame seek. At the root the
    // key is the bare clip id; inside a compound it is the whole occurrence path,
    // because the same child id can be live in two compounds on one frame and the
    // two occurrences hold different decoded pictures.
    const nested = path.length > 0
    const wrapped = nested
      ? env.occurrenceCanvases.get(occurrenceKey([...path, entry.item.id])) ?? null
      : clipCanvases.get(entry.item.id) ?? null
    if (isDebugFrame) {
      xlog('render:frame0', `video layer — sequential canvas`, {
        clipId: entry.item.id,
        nested,
        gotFrame: !!wrapped,
        zIndex: entry.item.zIndex,
        opacity: entry.item.opacity ?? 1,
        ...(wrapped ? { canvasW: wrapped.canvas.width, canvasH: wrapped.canvas.height } : {}),
      })
    }
    if (wrapped) {
      drawMedia(ctx, wrapped.canvas, entry.item.transform, stageW, stageH, entry.item.cornerRadius, entry.item.crop)
    } else if (isDebugFrame) {
      xlog('render:frame0', `video layer — WARNING: no canvas for clip "${entry.item.id}"${nested ? ` at ${JSON.stringify([...path, entry.item.id])}` : ''}`)
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
      drawMedia(ctx, bitmap, entry.item.transform, stageW, stageH, entry.item.cornerRadius, entry.item.crop)
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
      xlog('render:frame0', `shape layer`, { shapeKind: entry.item.shapeKind, zIndex: entry.item.zIndex })
    }
    drawShape(ctx, entry.item, stageW, stageH)
  } else if (entry.kind === 'generator') {
    paintGenerator(ctx, entry.item, { width: stageW, height: stageH })
  } else if (entry.kind === 'compound') {
    // A compound is placed like an image (PV-P1a-2): its children are painted
    // into this depth's picture buffer, and that flattened picture goes through
    // the same drawMedia path a video or image takes — transform, crop, corner
    // radius and all. The compound's own opacity is applied HERE, once, by the
    // globalAlpha set above; each child applied its own inside its own draw, so
    // nested opacities multiply by construction rather than by bookkeeping.
    const picture = paintCompoundPicture(depth, path, entry.item, env)
    if (picture) {
      drawMedia(ctx, picture, entry.item.transform, stageW, stageH, entry.item.cornerRadius, entry.item.crop, compoundContent(entry.item, env))
    }
  } else if (entry.kind === 'sequence') {
    // Same drawMedia path a video or image takes; a store miss (still opening,
    // failed to open, or the failed-frame case) draws nothing for this frame,
    // exactly like a video clip with no decoded canvas yet.
    const img = env.sequenceImages.get(sequenceKeyFor(path, entry.item.id))
    if (isDebugFrame) {
      xlog('render:frame0', `sequence layer`, {
        clipId: entry.item.id,
        zIndex: entry.item.zIndex,
        frameIndex: entry.item.frameIndex,
        hasImage: !!img,
      })
    }
    if (img) {
      drawMedia(ctx, img.source, entry.item.transform, stageW, stageH, entry.item.cornerRadius, entry.item.crop)
    }
  } else {
    if (isDebugFrame) xlog('render:frame0', `freehand layer`, { zIndex: entry.item.zIndex })
    drawFreehand(ctx, entry.item, stageW, stageH)
  }

  ctx.restore()
}

/**
 * MOT-8 phase B: whether this clip draws a rotateX / rotateY tilt this frame. The 2D canvas cannot
 * draw a projective quad, so such a clip goes through the worker's WebGL2 renderer, which uses
 * the preview's shader and matrix. Only the kinds placed as one textured quad draw a tilt.
 */
function entryTilts(entry: EffectEntry): boolean {
  if (!kindDrawsTilt(entry.kind)) return false
  const t = (entry.item as { transform?: { rotateX?: number; rotateY?: number; perspective?: number } }).transform
  return !!t && !!rectTilt(t)
}

/**
 * An adjustment clip (EDX-P7): the frame composited so far, run through the
 * clip's chain as a full-stage source and drawn back over itself.
 */
function drawAdjustment(
  ctx: OffscreenCanvasRenderingContext2D,
  gpu: WorkerEffectRenderer,
  item: ActiveAdjustmentClip,
  stageW: number,
  stageH: number,
  frameIndex: number,
  view?: GpuView,
): void {
  const source = ctx.canvas as OffscreenCanvas
  const out = gpu.draw(
    {
      source,
      fullStage: true,
      opacity: item.opacity ?? 1,
      effects: item.effects ?? [],
      ...(item.mask ? { mask: item.mask } : {}),
      ...(item.matte ? { matte: item.matte } : {}),
    },
    frameIndex,
    view,
  )
  if (!out) return
  ctx.save()
  ctx.globalAlpha = 1
  if (item.blend && item.blend !== 'normal') ctx.globalCompositeOperation = CANVAS_COMPOSITE_OP[item.blend]
  ctx.drawImage(out, 0, 0, stageW, stageH)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Effects (EDX-P3)
// ---------------------------------------------------------------------------

type EffectEntry =
  | { kind: 'video'; item: ActiveVideoClip }
  | { kind: 'image'; item: ActiveImageClip }
  | { kind: 'text'; item: ActiveTextClip }
  | { kind: 'shape'; item: ActiveShapeClip }
  | { kind: 'freehand'; item: ActiveFreehandClip }
  | { kind: 'adjustment'; item: ActiveAdjustmentClip }
  | { kind: 'generator'; item: ActiveGeneratorClip }
  | { kind: 'compound'; item: ActiveCompoundClip }
  | { kind: 'sequence'; item: ActiveSequenceClip }

/** The `EffectEntry` kind each Scene array holds; roto masks are not exported. */
const ENTRY_KIND: Partial<Record<SceneLayerKey, EffectEntry['kind']>> = {
  videos: 'video',
  images: 'image',
  sequences: 'sequence',
  texts: 'text',
  shapes: 'shape',
  freehand: 'freehand',
  generators: 'generator',
  adjustments: 'adjustment',
  compounds: 'compound',
}

/**
 * Draw one clip through its effect stack. True when drawn; false means the
 * chain could not run (no source yet, nothing runnable) and the caller should
 * fall back to the plain 2D draw.
 */
function drawWithEffects(
  depth: number,
  path: readonly string[],
  ctx: OffscreenCanvasRenderingContext2D,
  gpu: WorkerEffectRenderer,
  entry: EffectEntry,
  env: DrawEnv,
): boolean {
  const { clipCanvases, imageBitmaps, stageW, stageH, frameIndex } = env
  const item = entry.item
  const effects = item.effects ?? []
  let out: OffscreenCanvas | HTMLCanvasElement | null = null

  if (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'sequence') {
    const source: ExportSource | undefined =
      entry.kind === 'video'
        ? ((path.length > 0
            ? env.occurrenceCanvases.get(occurrenceKey([...path, entry.item.id]))?.canvas
            : clipCanvases.get(entry.item.id)?.canvas) as ExportSource | undefined)
        : entry.kind === 'image'
          ? imageBitmaps.get(entry.item.src)
          : env.sequenceImages.get(sequenceKeyFor(path, entry.item.id))?.source
    if (!source) return false
    out = gpu.draw(
      {
        source,
        ...(item.transform ? { transform: item.transform } : {}),
        ...(entry.item.crop ? { crop: entry.item.crop } : {}),
        cornerRadius: entry.item.cornerRadius ?? 0,
        opacity: item.opacity ?? 1,
        effects,
        ...(item.mask ? { mask: item.mask } : {}),
        ...(item.matte ? { matte: item.matte } : {}),
      },
      frameIndex,
      env.gpuView,
    )
  } else if (entry.kind === 'compound') {
    // Placed exactly as the preview's CompoundLayer places it: the picture is
    // the nested scene at its content size, and the chain gets the compound's
    // own rect, crop, corner radius and mask — not a stage-sized flat copy.
    const picture = paintCompoundPicture(depth, path, entry.item, env)
    if (!picture) return false
    out = gpu.draw(
      {
        source: picture,
        contentSize: compoundContent(entry.item, env),
        ...(item.transform ? { transform: item.transform } : {}),
        ...(entry.item.crop ? { crop: entry.item.crop } : {}),
        cornerRadius: entry.item.cornerRadius ?? 0,
        opacity: item.opacity ?? 1,
        effects,
        ...(item.mask ? { mask: item.mask } : {}),
        ...(item.matte ? { matte: item.matte } : {}),
      },
      frameIndex,
      env.gpuView,
    )
  } else {
    const flat = paintToScratch(depth, path, entry, env)
    if (!flat) return false
    // Masks on text/shape/freehand are measured in the element's own box
    // (EDX-P7c). A legacy freehand has no box - its transform is not read - so
    // its mask stays full-stage (PV-P2b).
    const measure = flat.getContext('2d')
    const maskFrame =
      !item.mask ? undefined
      : entry.kind === 'text' && measure ? textMaskFrame(measure as unknown as MeasureContext, entry.item, { width: stageW, height: stageH })
      : entry.kind === 'shape' ? shapeMaskFrame(entry.item, { width: stageW, height: stageH })
      : entry.kind === 'freehand' && entry.item.transformModel === 'v2' ? freehandFrame(entry.item, { width: stageW, height: stageH })
      : undefined
    out = gpu.draw(
      {
        source: flat,
        opacity: item.opacity ?? 1,
        effects,
        fullStage: true,
        ...(maskFrame ? { maskFrame } : {}),
        ...(item.mask ? { mask: item.mask } : {}),
        ...(item.matte ? { matte: item.matte } : {}),
      },
      frameIndex,
      env.gpuView,
    )
  }

  if (!out) return false
  ctx.save()
  ctx.globalAlpha = 1
  if (item.blend && item.blend !== 'normal') ctx.globalCompositeOperation = CANVAS_COMPOSITE_OP[item.blend]
  ctx.drawImage(out, 0, 0, stageW, stageH)
  ctx.restore()
  return true
}

/**
 * The size a compound's nested scene is laid out in: its own stage, as the
 * preview renders it (`CompoundLayer` uses `item.contentSize`). A missing or
 * degenerate size falls back to the stage being painted, which is what every
 * compound was before the child stage was honoured.
 */
function compoundContent(item: ActiveCompoundClip, env: DrawEnv): { width: number; height: number } {
  const c = item.contentSize
  return c && c.width > 0 && c.height > 0 ? { width: c.width, height: c.height } : { width: env.stageW, height: env.stageH }
}

/**
 * Pixel size of the picture holding `content`: 1 px per content unit, so the
 * nested paint is in the child's own units like the preview's target at scale 1.
 * Only a long edge past `env.pictureCap` is scaled down (aspect kept), the way
 * `compoundTargetSize` caps the preview's target; the cap is the larger of the
 * preview's MAX_COMPOUND_SIDE and the root stage, so a compound on the root
 * stage is never capped and keeps the buffer it always had.
 */
function compoundPictureSize(content: { width: number; height: number }, env: DrawEnv): { width: number; height: number } {
  const longest = Math.max(content.width, content.height)
  const k = longest > env.pictureCap ? env.pictureCap / longest : 1
  return { width: Math.max(1, Math.round(content.width * k)), height: Math.max(1, Math.round(content.height * k)) }
}

/**
 * Flatten a compound's child scene into this depth's picture buffer.
 *
 * The resolver has ALREADY resolved the nested scene at the compound's own
 * source frame (`ActiveCompoundClip.scene`), so nothing is resolved here — the
 * worker only paints. The recursion is therefore bounded by the resolver, which
 * stops nesting at `MAX_COMPOUND_DEPTH`; the guard below is defence in depth for
 * a hand-built scene and keeps `scratchStack` from growing without limit.
 *
 * The buffer is cleared and reset exactly as `paintToScratch` does, and the
 * child walk runs at `depth + 1` so it cannot touch this depth's buffers. The
 * picture is the compound's CONTENT SIZE, painted in the child's own stage
 * units (identity transform unless the cap scaled it): there is no output scale
 * inside a compound, and the caller places the picture with that same content
 * size, as the preview does with `resolveDrawRect`.
 *
 * The child walk gets the nested scene's own frame, fps and stage for any GPU
 * work (`gpuView`), and its mattes live under this compound's key prefix and are
 * released here, so the parent's mattes survive the nested scene.
 */
function paintCompoundPicture(
  depth: number,
  path: readonly string[],
  item: ActiveCompoundClip,
  env: DrawEnv,
): OffscreenCanvas | null {
  if (depth >= MAX_COMPOUND_DEPTH) return null
  const scratch = scratchAt(depth)
  const content = compoundContent(item, env)
  const size = compoundPictureSize(content, env)
  if (!scratch.picture || scratch.picture.width !== size.width || scratch.picture.height !== size.height) {
    scratch.picture = new OffscreenCanvas(size.width, size.height)
  }
  const p = scratch.picture.getContext('2d')
  if (!p) return null
  p.setTransform(1, 0, 0, 1, 0, 0)
  p.globalAlpha = 1
  p.globalCompositeOperation = 'source-over'
  p.clearRect(0, 0, size.width, size.height)
  if (size.width !== content.width || size.height !== content.height) {
    p.setTransform(size.width / content.width, 0, 0, size.height / content.height, 0, 0)
  }
  // A picture the size of the stage being painted keeps that level's output
  // size and renderer canvas, exactly as before the child stage was honoured;
  // any other size is its own output.
  const inherits = size.width === env.stageW && size.height === env.stageH
  const prefix = `${env.gpuView?.keyPrefix ?? ''}${item.id}/`
  const output = inherits ? env.gpuView?.output : size
  const nested: DrawEnv = {
    ...env,
    stageW: content.width,
    stageH: content.height,
    outW: inherits ? env.outW : size.width,
    outH: inherits ? env.outH : size.height,
    frameIndex: item.scene.frame,
    gpuView: {
      stage: content,
      fps: item.scene.fps,
      keyPrefix: prefix,
      ...(output ? { output } : {}),
    },
  }
  // The occurrence path is this compound's own id appended to the parent's, so a
  // child clip shared by two compounds still has two distinct keys.
  paintScene(item.scene, nested, p as unknown as OffscreenCanvasRenderingContext2D, depth + 1, [...path, item.id])
  env.gpu?.releaseKeys(prefix)
  return scratch.picture
}

/**
 * True when the layer paints ONE fill or stroke, so a layer-wide alpha and a
 * per-part alpha give the same pixels (EXP-2). Deliberately conservative: any
 * second part (outline, shadow, box, border, decoration, animation, spans, a
 * shape's stroke or shadow) or an unknown kind says no and the layer is flattened.
 */
function isSinglePart(entry: EffectEntry): boolean {
  if (entry.kind === 'freehand') return true
  if (entry.kind === 'text') {
    const t = entry.item
    return !(t.textOutline && t.textOutline.width > 0) && !t.textShadow && !t.backgroundColor && !(t.borderWidth && t.borderWidth > 0) &&
      !t.textDecoration && !t.shadow && !t.textAnimator && !t.scramble && !t.words?.length && !t.spans?.length
  }
  if (entry.kind === 'shape') {
    const sh = entry.item
    return !sh.shadow && !(sh.shapeStrokeWidth && sh.shapeStrokeWidth > 0)
  }
  return false
}

/**
 * Paint a text/shape/freehand/generator clip alone, at alpha 1, onto `depth`'s
 * fade scratch, sized to the resolution `target` draws at: the target's scale
 * (the output scale at the root) times the stage. Painted under that scale, so
 * a faded layer is as sharp as an opaque one and its shadows (device pixels)
 * scale with it; the caller draws the result at stage size onto the target,
 * where it lands 1:1.
 */
function paintFaded(depth: number, target: OffscreenCanvasRenderingContext2D, entry: EffectEntry, env: DrawEnv): OffscreenCanvas | null {
  if (entry.kind !== 'text' && entry.kind !== 'shape' && entry.kind !== 'freehand' && entry.kind !== 'generator') return null
  const { stageW, stageH } = env
  const { x: kx, y: ky } = contextScale(target)
  const w = Math.max(1, Math.round(stageW * kx))
  const h = Math.max(1, Math.round(stageH * ky))
  const scratch = scratchAt(depth)
  if (!scratch.fade || scratch.fade.width !== w || scratch.fade.height !== h) {
    scratch.fade = new OffscreenCanvas(w, h)
  }
  const p = scratch.fade.getContext('2d')
  if (!p) return null
  p.setTransform(1, 0, 0, 1, 0, 0)
  p.globalAlpha = 1
  p.globalCompositeOperation = 'source-over'
  p.clearRect(0, 0, w, h)
  p.setTransform(w / stageW, 0, 0, h / stageH, 0, 0)
  p.save()
  if (entry.kind === 'text') drawText(p, entry.item, stageW, stageH)
  else if (entry.kind === 'shape') drawShape(p, entry.item, stageW, stageH)
  else if (entry.kind === 'generator') paintGenerator(p, entry.item, { width: stageW, height: stageH })
  else drawFreehand(p, entry.item, stageW, stageH)
  p.restore()
  return scratch.fade
}

/** The scale a context draws under (the output scale at the root; 1 when it cannot say). */
function contextScale(ctx: OffscreenCanvasRenderingContext2D): { x: number; y: number } {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined
  const x = t ? Math.hypot(t.a, t.b) : 1
  const y = t ? Math.hypot(t.c, t.d) : 1
  return x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 1, y: 1 }
}

/** Paint a text/shape/freehand clip alone onto `depth`'s stage-sized scratch. */
function paintToScratch(depth: number, path: readonly string[], entry: EffectEntry, env: DrawEnv): OffscreenCanvas | null {
  if (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'adjustment' || entry.kind === 'sequence') return null
  // A compound's isolated paint IS its picture buffer, so reuse it rather than
  // flattening it twice — `paintCompoundPicture` clears and repaints it.
  if (entry.kind === 'compound') return paintCompoundPicture(depth, path, entry.item, env)
  const { stageW, stageH } = env
  const scratch = scratchAt(depth)
  if (!scratch.paint || scratch.paint.width !== stageW || scratch.paint.height !== stageH) {
    scratch.paint = new OffscreenCanvas(stageW, stageH)
  }
  const p = scratch.paint.getContext('2d')
  if (!p) return null
  p.setTransform(1, 0, 0, 1, 0, 0)
  p.globalAlpha = 1
  p.globalCompositeOperation = 'source-over'
  p.clearRect(0, 0, stageW, stageH)
  p.save()
  if (entry.kind === 'text') drawText(p, entry.item, stageW, stageH)
  else if (entry.kind === 'shape') drawShape(p, entry.item, stageW, stageH)
  else if (entry.kind === 'generator') paintGenerator(p, entry.item, { width: stageW, height: stageH })
  else drawFreehand(p, entry.item, stageW, stageH)
  p.restore()
  return scratch.paint
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
  cornerRadius?: number,
  crop?: CropRect,
  /** Placement size when it is not the source's pixel size (a compound's capped picture). */
  size?: { width: number; height: number },
): void {
  const rect = resolveDrawRect(transform, stageW, stageH, size?.width ?? source.width, size?.height ?? source.height, crop)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2

  ctx.translate(cx, cy)
  ctx.rotate(rect.rotation)
  // MOT-8: rotate, then shear (CSS "rotate() skew()"), the order buildTransformMatrixFromRect uses. No-op when unskewed.
  applyShear(ctx, rectShear(rect))

  // Mirror the GPU shader's uRadius mask: cornerRadius is a fraction (0..0.5)
  // of each axis's own extent, so a per-corner elliptical radius at the max
  // (0.5) rounds all the way to an ellipse inscribed in the rect — same as
  // QUAD_FRAG_SRC's rounded-box SDF.
  if (cornerRadius && cornerRadius > 0) {
    const rx = Math.min(cornerRadius, 0.5) * rect.width
    const ry = Math.min(cornerRadius, 0.5) * rect.height
    ctx.beginPath()
    ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, [{ x: rx, y: ry }])
    ctx.clip()
  }

  // Mirror the GPU shader's uCrop: sample only the cropped source sub-rect
  // (9-arg drawImage) instead of the full source (5-arg) — same normalized
  // 0..1 top-left-origin crop window as resolveDrawRect used to size `rect`.
  if (crop) {
    const c = normalizeCrop(crop)
    ctx.drawImage(
      source,
      c.x * source.width,
      c.y * source.height,
      c.width * source.width,
      c.height * source.height,
      -rect.width / 2,
      -rect.height / 2,
      rect.width,
      rect.height,
    )
  } else {
    ctx.drawImage(source, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
  }
}

/**
 * Text is painted by the SAME module the preview's TextLayer uses
 * (`renderer/gpu/layers/textPaint`), so preview and export cannot drift —
 * including outlines, shadows, text animators and timed captions (EDX-P8).
 * `globalAlpha` is already set by the caller and the painter multiplies into it.
 */
function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  clip: ActiveTextClip,
  stageW: number,
  stageH: number,
): void {
  paintText(ctx, clip, { width: stageW, height: stageH })
}

/**
 * Shapes are rasterized by the SAME module the GPU preview layer uses
 * (`renderer/gpu/layers/shapePaint`), so preview and export cannot drift — this
 * function was a verbatim copy of `ShapeLayer.paintShape` until that module
 * existed. `globalAlpha` is already set by the caller and the painter leaves it
 * alone.
 */
function drawShape(
  ctx: OffscreenCanvasRenderingContext2D,
  item: ActiveShapeClip,
  stageW: number,
  stageH: number,
): void {
  paintShape(ctx, item, { width: stageW, height: stageH })
}

/**
 * The shared painter (PV-P2b), which used to be a copy of this function minus
 * the clear. It does not clear: the caller owns the scratch canvas, and the
 * preview's layer owns its own.
 */
function drawFreehand(
  ctx: OffscreenCanvasRenderingContext2D,
  item: ActiveFreehandClip,
  stageW: number,
  stageH: number,
): void {
  paintFreehand(ctx, item, { width: stageW, height: stageH })
}
