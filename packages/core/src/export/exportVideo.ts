import { ExportCapabilityError } from './exportErrors'
import type { Clip, Project, Track } from '../types'
import { getTotalFrames } from '../utils/frames'
import { trace, traceEnabled, getEnabledChannels, type TraceChannel } from '../debug/trace'
import { defaultAudioResolver, type AudioResolver } from '../media/audio/audioResolver'
import { sourceBlobCache } from '../media/video/demuxer/sourceBlobCache'
import {
  STREAM_AUDIO_ABOVE_BYTES,
  openAudioStream,
  type AudioStream,
} from '../media/audio/streamDecode'
import { sourceAwareAudioResolver } from './sources'
import { activeEnhance } from '../audio/clipAudio'
import { ensureDenoiseWorklet } from '../media/audio/denoiseWorklet'
import { buildEnhanceChain, latencyLead } from '../media/audio/enhanceChain'
import { flattenAudioClips, isMixableAudioClip, type FlatAudioClip } from '../elements/compound'
import { resolveFontBaseUrl } from '../fonts/loader'
import { DEFAULT_FONT_BASE_URL } from '../fonts/registry'
import { preDecodeSvgImages } from './preDecode'
import { isCrossOriginModule, siblingWorkerUrl, startCrossOriginModuleWorker } from '../utils/workerUrl'
import type { ExportOptions, ExportProgress, RenderedAudio, WorkerOutMessage } from './types'
import { resolveExportFormat, ensureTransparencyGate, ensureVideoCodecSupport } from './capabilities'
import { computeExportDimensions } from './outputDimensions'
import { GIF_MAX_FRAMES, planGifFrames } from './gifEncode'
import { resolveExportRange, type ExportFrameRange } from './range'
import { createPngFrameReceiver, createZipFrameSink, stripFrameSinkForWorker } from './pngSink'
import {
  applyGainEvents,
  gainAutomation,
  isClipAudioAudible,
  renderInSlices,
  scheduleAudioClip,
  type AudioMixRange,
} from './audioMix'

/**
 * Main-thread trace helper. Mirrors the Worker's `xlog`, routing through the
 * same channel-based tracer so `__trace.on('EXPORT')` (etc.) controls both
 * sides. Enable from the console before triggering an export.
 */
function mlog(channel: TraceChannel, msg: string) {
  if (!traceEnabled(channel)) return
  trace(channel, `[main] ${msg}`)
}

/**
 * LM-P5: where `renderAudioMix` may read a large source's audio by range.
 *
 * A source for which `blobFor` returns a Blob larger than `thresholdBytes` is
 * not decoded whole: each clip decodes only the source seconds it plays
 * (`scheduleAudioClip`'s `offset` .. `offset + duration`). Any other source
 * keeps the whole-file `audioResolver` path unchanged.
 */
export interface RangedAudioOptions {
  blobFor: (src: string) => Blob | undefined
  /** Injectable for tests. Defaults to mediabunny. */
  open?: (blob: Blob) => Promise<AudioStream>
  /** Default `STREAM_AUDIO_ABOVE_BYTES`. */
  thresholdBytes?: number
}

/**
 * Re-entrancy guard. An export worker opens one GPU-backed VideoDecoder /
 * CanvasSink per unique video source; running several exports at once stacks
 * those decoders and exhausts the GPU (VideoDecoder allocation failures, lost
 * WebGL context). Only one export is allowed in flight at a time — concurrent
 * callers are rejected rather than spawning another worker.
 */
let exportInFlight = false

/**
 * Render the project's full audio mix on the main thread.
 *
 * This must happen here (not in the ExportWorker) because the Web Audio API —
 * `OfflineAudioContext`, `decodeAudioData` — is not exposed in Web Workers.
 * The resulting PCM is transferred into the worker, which encodes it via
 * mediabunny's `AudioSampleSource`.
 *
 * Returns `null` when there is nothing to mix (no active audio clips) or when
 * the Web Audio API is unavailable, in which case export proceeds video-only.
 */
/**
 * Render the project's full audio mix on the main thread.
 *
 * This must happen here (not in the ExportWorker) because the Web Audio API -
 * `OfflineAudioContext`, `decodeAudioData` - is not exposed in Web Workers.
 * The finished PCM is handed to the worker, which encodes it into the MP4 via
 * mediabunny's `AudioSampleSource`.
 *
 * Collection is `flattenAudioClips` (PV-P1a-1), so audio inside a compound is
 * mixed at its ABSOLUTE position with its ancestors' gains folded in, and what
 * you hear in preview is what you export. For a project with no compounds the
 * walk returns exactly what the old top-level filter returned, so legacy
 * documents and their output are unchanged.
 *
 * Returns `null` when there is nothing to mix (no active audio clips) or when
 * the Web Audio API is unavailable, in which case export proceeds video-only.
 */
export async function renderAudioMix(
  project: Project,
  audioResolver: AudioResolver,
  onAudioIssue?: (message: string, src: string | undefined) => void,
  /**
   * PV-P9a-1: the export window (absolute project frames, exclusive end).
   * Defaults to the whole project — `resolveExportRange(project, 'all')`'s
   * own answer — so every existing caller (this file's own `runExportVideo`
   * before this ticket, and every direct test call) mixes exactly the audio
   * it always did, scheduled at the same absolute times.
   */
  range?: ExportFrameRange,
  ranged?: RangedAudioOptions,
): Promise<RenderedAudio | null> {
  const fps = project.fps
  const totalFrames = getTotalFrames(project.clips)
  if (totalFrames === 0) return null
  const r: ExportFrameRange = range ?? { startFrame: 0, endFrame: totalFrames, totalFrames }
  if (r.totalFrames === 0) return null

  // One issue per retimed ancestor whose audio v1 cannot follow, reported whether
  // or not anything else survives to be mixed.
  const skippedRetimed: string[] = []
  const entries = flattenAudioClips(project, id => skippedRetimed.push(id))
  const reportSkipped = () => {
    for (const id of skippedRetimed) {
      const message = `audio inside retimed compound "${id}" is not exported (v1 does not follow a retimed compound)`
      mlog('EXPORT_AUDIO', message)
      console.warn(`[export:main] ${message}`)
      onAudioIssue?.(message, undefined)
    }
  }
  if (entries.length === 0) {
    reportSkipped()
    mlog('EXPORT_AUDIO', 'no active audio clips — exporting video-only')
    return null
  }

  // PV-P9a-1's range narrowing, PV-P10a's gain/schedule math: `scheduleAudioClip`
  // and `gainAutomation` (export/audioMix.ts) intersect each clip's absolute
  // active window with the export range BEFORE anything is fetched or
  // scheduled. A clip entirely outside the range is dropped here — it must
  // never be decoded, gain-scheduled, or heard in the mix. A clip that
  // straddles a range edge keeps only its overlapping slice, and `when` is
  // zero-based against the range, not the project, so the range-aware mix
  // lines up with the range-aware video loop's own zero-based encode
  // timestamps (ExportWorker.ts): range.startFrame ⇒ t=0 in the exported file
  // for both tracks. With `range` covering the whole project (the default)
  // this reduces to exactly the pre-P9a-1 formula for every legacy caller.
  const mixRange: AudioMixRange = { startFrame: r.startFrame, endFrame: r.endFrame }

  interface MixEntry {
    entry: FlatAudioClip
    owningProject: Project
    schedule: { when: number; offset: number; duration: number; playbackRate: number }
  }
  const mixEntries: MixEntry[] = []
  for (const entry of entries) {
    const clip = entry.clip
    // A merged video clip (embeddedAudio) is mixed like an audio clip; a
    // legacy video + separate audio pair has no flag, so it is mixed once.
    if (!isMixableAudioClip(clip) || clip.disabled) continue

    // PV-P10a: solo/mute is checked at EVERY level the clip is nested under —
    // `flattenAudioClips` (PV-P1a) already refused a muted/disabled track at
    // every level, but never checked solo, so that is done here, following
    // `entry.parentChain` from the root and resolving each compound only
    // within ITS OWN containing project (never the root's tracks for a
    // nested track, and never re-cropping or re-multiplying a gain P1a-1
    // already folded).
    const ancestry = resolveAncestry(project, entry.parentChain)
    if (!ancestry) continue
    const audible = entry.parentChain.length === 0
      ? isClipAudioAudible(entry.track, project.tracks)
      : ancestry.audible && isClipAudioAudible(entry.track, ancestry.owningProject.tracks)
    if (!audible) continue

    const schedule = scheduleAudioClip(clip, fps, mixRange, entry.offsetFrames)
    if (!schedule) continue // entirely outside the export range
    mixEntries.push({ entry, owningProject: ancestry.owningProject, schedule })
  }
  if (mixEntries.length === 0) {
    reportSkipped()
    mlog('EXPORT_AUDIO', 'no audio clip overlaps the export range — exporting video-only')
    return null
  }

  const OAC: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OAC) {
    console.warn('[export:main] OfflineAudioContext unavailable — audio will be skipped')
    onAudioIssue?.('OfflineAudioContext unavailable — audio will be skipped', undefined)
    return null
  }
  reportSkipped()

  const sampleRate = 44100
  const totalSec = r.totalFrames / fps
  mlog('EXPORT_AUDIO', `mixing ${mixEntries.length} audio clip(s) — ${totalSec.toFixed(2)}s @ ${sampleRate}Hz`)
  const ctx = new OAC(2, Math.ceil(sampleRate * totalSec), sampleRate)

  // PV-P10a: one master gain node for `project.masterVolume`. Every clip's own
  // gain connects to THIS, not straight to `ctx.destination`, so master volume
  // applies once, on top of every clip's own automation, rather than being
  // folded (and re-derived per clip) into each clip's gain.
  const master = ctx.createGain()
  master.gain.value = project.masterVolume ?? 1
  master.connect(ctx.destination)

  // Fetch+decode once per unique src (mirrors the video export worker's
  // per-src CanvasSink dedupe) — multiple clips referencing the same CDN
  // audio URL share a single download and decode.
  const decodedBySrc = new Map<string, Promise<AudioBuffer>>()
  const decodeOnce = (src: string): Promise<AudioBuffer> => {
    let promise = decodedBySrc.get(src)
    if (!promise) {
      promise = audioResolver(src).then((buf) => ctx.decodeAudioData(buf))
      decodedBySrc.set(src, promise)
    }
    return promise
  }

  // LM-P5: large local sources are read by range, one stream per src.
  const rangedThreshold = ranged?.thresholdBytes ?? STREAM_AUDIO_ABOVE_BYTES
  const streamsBySrc = new Map<string, Promise<AudioStream>>()
  const rangedBlob = (src: string): Blob | undefined => {
    const blob = ranged?.blobFor(src)
    return blob && blob.size > rangedThreshold ? blob : undefined
  }
  const readClipRange = async (
    src: string,
    blob: Blob,
    schedule: { offset: number; duration: number },
  ): Promise<AudioBuffer | null> => {
    let opening = streamsBySrc.get(src)
    if (!opening) {
      opening = (ranged?.open ?? ((b: Blob) => openAudioStream(b)))(blob)
      streamsBySrc.set(src, opening)
    }
    const stream = await opening
    const end = Math.min(stream.durationSec, schedule.offset + schedule.duration)
    if (end <= schedule.offset) return null
    const range = await stream.readRange(schedule.offset, end, { maxChannels: 2 })
    const frames = range.channels[0]?.length ?? 0
    if (frames === 0) return null
    const buffer = ctx.createBuffer(range.channels.length, frames, range.sampleRate)
    for (let c = 0; c < range.channels.length; c++) buffer.copyToChannel(range.channels[c]!, c)
    return buffer
  }

  for (let i = 0; i < mixEntries.length; i++) {
    const { entry, owningProject, schedule } = mixEntries[i]!
    const clip = entry.clip
    try {
      mlog('EXPORT_AUDIO', `[${i + 1}/${mixEntries.length}] fetching+decoding "${clip.src?.slice(-40)}"`)
      const fetchStart = performance.now()
      const streamBlob = rangedBlob(clip.src!)
      let decoded: AudioBuffer
      let startOffset = schedule.offset
      if (streamBlob) {
        const slice = await readClipRange(clip.src!, streamBlob, schedule)
        if (!slice) {
          mlog('EXPORT_AUDIO', `[${i + 1}/${mixEntries.length}] skipped - range lies past the end of the source`)
          continue
        }
        decoded = slice
        startOffset = 0 // the decoded slice begins at the clip's source offset
      } else {
        decoded = await decodeOnce(clip.src!)
      }
      const node = ctx.createBufferSource()
      node.buffer = decoded
      node.playbackRate.value = schedule.playbackRate
      // Enhance (audio/clipAudio.ts): the same chain the preview player builds,
      // read from the authored clip (a nested entry is a cropped copy).
      const enhance = activeEnhance(entry.automation?.originalClip ?? clip)
      const denoiseReady = enhance && enhance.noise > 0 ? await ensureDenoiseWorklet(ctx) : false
      if (enhance && enhance.noise > 0 && !denoiseReady) {
        onAudioIssue?.('noise reduction is unavailable in this browser; the rest of Enhance was applied', clip.src)
      }
      const chain = buildEnhanceChain(ctx, enhance, denoiseReady)
      const gain = ctx.createGain()
      const events = gainAutomation(
        clip,
        entry.track,
        fps,
        mixRange,
        entry.offsetFrames,
        entry.automation,
        owningProject,
        (issue) => onAudioIssue?.(issue.message, clip.src),
      )
      applyGainEvents(gain.gain, events)
      if (chain) {
        node.connect(chain.input)
        chain.output.connect(gain).connect(master)
      } else {
        node.connect(gain).connect(master)
      }
      // The denoiser delays its output; starting that much earlier (when the
      // range and source allow) puts the processed sound back on the picture.
      const lead = latencyLead(chain?.latencySec ?? 0, schedule.when, startOffset, schedule.playbackRate)
      node.start(
        schedule.when - lead,
        startOffset - lead * schedule.playbackRate,
        schedule.duration + lead * schedule.playbackRate,
      )
      const lastGain = events.length > 0 ? events[events.length - 1]!.value : (clip.volume ?? 1)
      mlog('EXPORT_AUDIO', `[${i + 1}/${mixEntries.length}] scheduled — ` +
        `startSec=${schedule.when.toFixed(3)} ` +
        `offsetSec=${schedule.offset.toFixed(3)} ` +
        `durSec=${schedule.duration.toFixed(3)} ` +
        `rate=${schedule.playbackRate} ` +
        `vol=${lastGain.toFixed(4)} (${events.length} event(s)) ` +
        `depth=${entry.parentChain.length} ` +
        `decodedSec=${decoded.duration.toFixed(3)} ` +
        `ms=${(performance.now() - fetchStart).toFixed(1)}`)
    } catch (err) {
      // One failing source must not suppress the others: the decode promise is
      // cached per src, and this catch is per ENTRY, so a shared bad src is
      // reported once per clip that wanted it and every other src still plays.
      const message = `audio clip "${clip.src?.slice(-40)}" skipped — decode error: ${String(err)}`
      mlog('EXPORT_AUDIO', `[${i + 1}/${mixEntries.length}] skipped — decode error: ${String(err)}`)
      console.warn(`[export:main] ${message}`)
      onAudioIssue?.(message, clip.src)
    }
  }
  for (const opening of streamsBySrc.values()) void opening.then((st) => st.close(), () => undefined)

  mlog('EXPORT_AUDIO', 'startRendering() — mixing offline graph')
  // REN-6: sliced so a long mix yields to the main thread.
  const mixed = await renderInSlices(ctx)
  const numberOfChannels = mixed.numberOfChannels
  const length = mixed.length
  const channels: ArrayBuffer[] = []
  for (let c = 0; c < numberOfChannels; c++) {
    // Copy into a standalone Float32Array so its buffer can be transferred.
    channels.push(new Float32Array(mixed.getChannelData(c)).buffer)
  }
  mlog('EXPORT_AUDIO', `audio mix ready — channels=${numberOfChannels} frames=${length}`)
  return { sampleRate, numberOfChannels, length, channels }
}

/**
 * Walk `parentChain` (outermost first) from the ROOT project, resolving each
 * compound id only within its own containing project — never the root's
 * tracks for a nested track. Returns the project that directly owns the leaf
 * clip (`owningProject`, for `gainAutomation`'s `prop()`/`audio()` context)
 * and whether every ancestor compound's own track is audible under ITS
 * level's solo/mute rules. `[]` (a top-level entry) resolves to `project`
 * itself with `audible: true` — the caller still runs `isAudioTrackAudible`
 * on the leaf track's own level.
 *
 * Defensive only: `parentChain` comes from `flattenAudioClips`, which only
 * ever walks real compound ids, so the "not found" branch should be
 * unreachable in practice.
 */
function resolveAncestry(
  project: Project,
  parentChain: ReadonlyArray<string>,
): { owningProject: Project; audible: boolean } | null {
  let current = project
  let audible = true
  for (const compoundId of parentChain) {
    let found: { clip: Clip; track: Track } | undefined
    for (const track of current.tracks) {
      const clip = (current.clips[track.id] ?? []).find((c) => c.id === compoundId)
      if (clip) {
        found = { clip, track }
        break
      }
    }
    if (!found || found.clip.type !== 'compound' || !found.clip.compound) return null
    if (!isTrackAudibleAtOwnLevel(found.track, current.tracks)) audible = false
    current = found.clip.compound.project
  }
  return { owningProject: current, audible }
}

/**
 * `isAudioTrackAudible`'s rule, generalised to whatever kind `track` is (a
 * compound clip's own track is usually `video`/`elements`, not `audio`) —
 * `resolveTimeline`'s own solo pre-pass excludes a track by matching KIND,
 * not specifically `audio`.
 */
function isTrackAudibleAtOwnLevel(track: Track, tracks: ReadonlyArray<Track>): boolean {
  if (track.disabled || track.muted) return false
  const solo = tracks.some((t) => t.kind === track.kind && t.solo)
  return !solo || track.solo === true
}

/**
 * Export the project to a video Blob — MP4 by default (`options.container`),
 * or WebM, optionally transparent (PV-P9a-1; see `export/capabilities.ts`),
 * over `options.range`'s window of the timeline (`export/range.ts`).
 *
 * Spins up ExportWorker (module worker) and resolves once the worker posts
 * the finished ArrayBuffer. Progress is forwarded via `options.onProgress`.
 *
 * The worker must be bundled as a module worker by the consuming app's bundler.
 * The `new URL('./ExportWorker.ts', import.meta.url)` pattern is recognised by
 * Vite, webpack 5, and Turbopack, which each bundle the worker from source.
 *
 * @example
 * ```ts
 * const blob = await exportVideo(project, {
 *   videoBitrate: 8_000_000,
 *   onProgress: ({ frame, totalFrames }) =>
 *     console.log(`${Math.round(frame / totalFrames * 100)}%`),
 * })
 * const url = URL.createObjectURL(blob)
 * ```
 */
export async function exportVideo(project: Project, options: ExportOptions = {}): Promise<Blob> {
  if (exportInFlight) {
    mlog('EXPORT', 'rejected — an export is already in flight (GPU guard)')
    throw new Error('An export is already in progress. Wait for it to finish before starting another.')
  }
  exportInFlight = true
  try {
    if ((options.container ?? 'mp4') === 'png-sequence') {
      return await runPngSequenceExport(project, options)
    }
    return await runExportVideo(project, options)
  } finally {
    exportInFlight = false
  }
}

async function runExportVideo(project: Project, options: ExportOptions): Promise<Blob> {
  const t0 = performance.now()
  const totalClips = Object.values(project.clips).flat().length
  mlog('EXPORT', `exportVideo() called — stage=${project.stage.width}x${project.stage.height} fps=${project.fps} clips=${totalClips}`)

  // PV-P9a-1: container/codec and the export range are resolved — and, for
  // the range, VALIDATED — before anything expensive runs. An unsupported
  // codec combination or an empty/inverted `inOut` range rejects here, before
  // the audio mix is rendered or a single asset is fetched, rather than after
  // burning a whole export. The WebM transparency gate is the one check here
  // that's actually async (PV-P8a's real encode→decode probe): it runs after
  // the cheap synchronous checks but still before the audio mix, for the same
  // fail-fast reason.
  const format = resolveExportFormat({
    container: options.container,
    videoCodec: options.videoCodec,
    audioCodec: options.audioCodec,
    audioBitrate: options.audioBitrate,
    transparent: options.transparent,
  })
  const range = resolveExportRange(project, options.range)
  const isGif = format.container === 'gif'
  if (isGif) {
    const kept = planGifFrames(range.totalFrames, project.fps, options.gifFps).delays.length
    if (kept > GIF_MAX_FRAMES) {
      throw new ExportCapabilityError(
        `This GIF would have ${kept} frames (limit ${GIF_MAX_FRAMES}). Export a shorter range or a lower gifFps, or use MP4/WebM for long clips.`,
      )
    }
  } else {
    // REN-5: HEVC/AV1 only where this browser's encoder says yes (no-op for AVC/VP9/VP8).
    const dims = computeExportDimensions(project.stage.width, project.stage.height, options.outputHeight)
    await ensureVideoCodecSupport(format, dims.width, dims.height)
  }
  await ensureTransparencyGate(format, options.transparent)

  // A GIF has no soundtrack: skip the audio mix entirely.
  const audio = isGif ? null : await renderAudioMix(
    project,
    sourceAwareAudioResolver(options.sources, options.audioResolver ?? defaultAudioResolver),
    options.onAudioIssue,
    range,
    {
      // A caller-supplied File (LM-P1 `sources`) or a pinned local file is read by range.
      blobFor: (src) =>
        (options.sources && Object.prototype.hasOwnProperty.call(options.sources, src)
          ? options.sources[src]
          : undefined) ?? sourceBlobCache.pinnedBlob(src),
    },
  )

  // Rasterise SVG image sources on the main thread — workers cannot decode
  // SVG. Runs before the abort check below so a slow SVG decode is still
  // honoured by an abort that arrives during it, rather than spawning a
  // worker anyway.
  const preDecoded = await preDecodeSvgImages(project, options.preDecoded)

  const { signal } = options
  if (signal?.aborted) {
    // These bitmaps are never posted now; close them rather than leaking
    // GPU-backed decode buffers.
    for (const bitmap of Object.values(preDecoded)) bitmap.close()
    return Promise.reject(signal.reason ?? new DOMException('Export aborted', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    mlog(
      'EXPORT',
      `spawning ExportWorker (module worker) — container=${format.container} transparent=${!!options.transparent} range=[${range.startFrame}, ${range.endFrame})`,
    )
    // CONV-5: loaded from another origin (a CDN), start the worker through a
    // `blob:` wrapper; otherwise the literal below, which bundlers detect.
    const worker = isCrossOriginModule(import.meta.url)
      ? startCrossOriginModuleWorker(siblingWorkerUrl(import.meta.url, 'ExportWorker'))
      : new Worker(new URL('./ExportWorker.ts', import.meta.url), { type: 'module' })

    const abort = () => {
      worker.terminate()
      mlog('EXPORT', 'aborted by signal')
      reject(signal?.reason ?? new DOMException('Export aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })

    let lastLoggedPct = -1

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        options.onProgress?.({ frame: msg.frame, totalFrames: msg.totalFrames })
        const pct = Math.round((msg.frame / msg.totalFrames) * 100)
        if (pct !== lastLoggedPct && pct % 10 === 0) {
          lastLoggedPct = pct
          mlog('EXPORT_FRAMES', `progress ${pct}% (frame ${msg.frame}/${msg.totalFrames})`)
        }
      } else if (msg.type === 'done') {
        signal?.removeEventListener('abort', abort)
        worker.terminate()
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
        // PV-P9a-1: the worker is the side that actually built the mediabunny
        // Output, so its own `mimeType` is what the Blob is tagged with — not
        // a hardcoded 'video/mp4' — a WebM export otherwise came back
        // mislabeled as MP4.
        const blob = new Blob([msg.buffer], { type: msg.mimeType })
        mlog('EXPORT', `done — container=${msg.container} blob=${(blob.size / 1_000_000).toFixed(2)}MB totalTime=${elapsed}s`)
        resolve(blob)
      } else if (msg.type === 'warning') {
        // PV-P4a-2 / PV-P8c: never fatal. The worker recovered (a font face
        // fell back to its generic family, or a sequence source exported as
        // a still or was skipped) and the video is complete, so this is
        // reported and the export continues to `done`. `onFontIssue` stays
        // font-specific for existing callers; `onWarning` receives every
        // warning, font or otherwise.
        console.warn(`[export:main] ${msg.message}`)
        options.onFontIssue?.(msg.message)
        options.onWarning?.(msg.message)
      } else if (msg.type === 'error') {
        signal?.removeEventListener('abort', abort)
        worker.terminate()
        console.error(`[export:main] worker reported error: ${msg.message}`)
        reject(msg.code === 'capability' ? new ExportCapabilityError(msg.message) : new Error(msg.message))
      }
    }

    worker.onerror = (e) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      console.error(`[export:main] worker crashed: ${e.message}`)
      reject(new Error(`ExportWorker crashed: ${e.message}`))
    }

    mlog('EXPORT', 'posting start message to worker')
    worker.postMessage(
      {
        type: 'start',
        project,
        // `onFontIssue` MUST be stripped with the rest: postMessage throws
        // DataCloneError on a function, and the worker would never start.
        // `frameSink` (PV-P9a-2) is stripped the same way even on this
        // MP4/WebM path — a caller could pass one alongside a non-PNG
        // container by mistake, and a leaked function would fail every
        // export, not just a PNG one.
        options: {
          ...stripFrameSinkForWorker(options),
          // Resolved HERE, on the main thread, because a module worker resolves a
          // relative URL against its own script URL (`/_next/static/...`), not
          // the page. The default therefore has to be made absolute before it is
          // posted, or a stock export loads fonts from the wrong place.
          fonts: {
            baseUrl: resolveFontBaseUrl(
              options.fonts?.baseUrl ?? DEFAULT_FONT_BASE_URL,
              typeof location !== 'undefined' ? location.href : undefined,
            ),
          },
          onProgress: undefined,
          signal: undefined,
          audioResolver: undefined,
          onAudioIssue: undefined,
          onFontIssue: undefined,
          onWarning: undefined,
          preDecoded,
        },
        audio,
        // Forward the main thread's enabled channels so the Worker's tracer
        // mirrors them — it can't read `__trace`/localStorage on its own.
        trace: getEnabledChannels(),
      },
      [...(audio ? audio.channels : []), ...Object.values(preDecoded)],
    )
  })
}

/**
 * Export the project as a PNG sequence (PV-P9a-2): one lossless PNG per
 * frame, streamed to `options.frameSink` (a directory sink, e.g. PV-P9a-3's
 * File System Access UI) or, absent one, buffered into a bounded in-memory
 * ZIP (`pngSink.ts`'s `createZipFrameSink`) and resolved as one Blob.
 *
 * No `resolveExportFormat`/`capabilities.ts` gate here on purpose: that
 * module's `resolveExportFormat` still rejects `container: 'png-sequence'`
 * outright (it was written for PV-P9a-1, before this ticket existed, and is
 * outside this ticket's file allowlist) — PNG has no video/audio codec to
 * resolve, so this function validates the one thing that matters
 * (`videoCodec`/`audioCodec` must be unset) itself and never calls it.
 *
 * No audio: a PNG sequence has no soundtrack (the Design's own words), so
 * `renderAudioMix` never runs for this path and `audio: null` is posted.
 *
 * Backpressure ("at most one unacknowledged frame", PV-CONTRACTS' bound):
 * the worker posts one `png-frame` and waits for `pngSink.ts`'s
 * `FrameAckGate` before making the next; this side never posts the `png-ack`
 * back until `createPngFrameReceiver`'s `sink.write()` has actually
 * resolved, so a slow sink (a real disk write) throttles the worker rather
 * than letting frames pile up in memory here.
 */
async function runPngSequenceExport(project: Project, options: ExportOptions): Promise<Blob> {
  const t0 = performance.now()
  mlog('EXPORT', `exportVideo() called — png-sequence, stage=${project.stage.width}x${project.stage.height} fps=${project.fps}`)

  if (options.videoCodec || options.audioCodec) {
    throw new ExportCapabilityError(
      'A PNG sequence has no video/audio codec to select — leave videoCodec/audioCodec unset.',
    )
  }
  // Validates (and, for 'inOut', clamps) the range before anything is
  // fetched or a worker is spawned — same fail-fast contract as the
  // MP4/WebM path.
  const range = resolveExportRange(project, options.range)

  const preDecoded = await preDecodeSvgImages(project, options.preDecoded)

  const { signal } = options
  if (signal?.aborted) {
    for (const bitmap of Object.values(preDecoded)) bitmap.close()
    return Promise.reject(signal.reason ?? new DOMException('Export aborted', 'AbortError'))
  }

  const sink = options.frameSink ?? createZipFrameSink()
  const usingDefaultZip = !options.frameSink
  const receiver = createPngFrameReceiver(sink)

  return new Promise((resolve, reject) => {
    mlog('EXPORT', `spawning ExportWorker (module worker) — png-sequence range=[${range.startFrame}, ${range.endFrame}) sink=${usingDefaultZip ? 'zip (default)' : 'caller'}`)
    // CONV-5: same cross-origin branch as the MP4/WebM path above.
    const worker = isCrossOriginModule(import.meta.url)
      ? startCrossOriginModuleWorker(siblingWorkerUrl(import.meta.url, 'ExportWorker'))
      : new Worker(new URL('./ExportWorker.ts', import.meta.url), { type: 'module' })

    // Settle exactly once — a 'done' after an abort/error (or the reverse)
    // must never resolve AND reject, and sink.close()/sink.abort() must each
    // fire at most once, per the ticket's own contract.
    let settled = false

    const finishReject = (reason: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      Promise.resolve(sink.abort(reason)).catch((err) => {
        console.error(`[export:main] frameSink.abort() itself failed: ${String(err)}`)
      })
      mlog('EXPORT', `png-sequence export failed/aborted: ${String(reason)}`)
      reject(reason)
    }

    const abort = () => {
      finishReject(signal?.reason ?? new DOMException('Export aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      if (settled) return
      const msg = e.data
      if (msg.type === 'progress') {
        options.onProgress?.({ frame: msg.frame, totalFrames: msg.totalFrames })
      } else if (msg.type === 'png-frame') {
        // The worker is already blocked awaiting this frame's ack (its own
        // FrameAckGate) — the ack is posted back only once the bytes have
        // actually been written, never merely received, so a slow sink
        // throttles the worker instead of letting frames pile up here.
        receiver
          .receive({ index: msg.index, name: msg.name, data: new Uint8Array(msg.buffer) })
          .then(() => {
            if (settled) return
            worker.postMessage({ type: 'png-ack', index: msg.index })
          })
          .catch((err) => finishReject(err))
      } else if (msg.type === 'done') {
        settled = true
        signal?.removeEventListener('abort', abort)
        worker.terminate()
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
        Promise.resolve(sink.close())
          .then(() => {
            const blob = usingDefaultZip
              ? new Blob([(sink as ReturnType<typeof createZipFrameSink>).toZip().buffer as ArrayBuffer], { type: 'application/zip' })
              : new Blob([], { type: 'application/octet-stream' })
            mlog('EXPORT', `png-sequence done — blob=${(blob.size / 1_000_000).toFixed(2)}MB totalTime=${elapsed}s`)
            resolve(blob)
          })
          .catch((err) => {
            mlog('EXPORT', `png-sequence sink.close() failed: ${String(err)}`)
            reject(err)
          })
      } else if (msg.type === 'warning') {
        console.warn(`[export:main] ${msg.message}`)
        options.onFontIssue?.(msg.message)
        options.onWarning?.(msg.message)
      } else if (msg.type === 'error') {
        finishReject(msg.code === 'capability' ? new ExportCapabilityError(msg.message) : new Error(msg.message))
      }
    }

    worker.onerror = (e) => {
      finishReject(new Error(`ExportWorker crashed: ${e.message}`))
    }

    worker.postMessage(
      {
        type: 'start',
        project,
        options: {
          ...stripFrameSinkForWorker(options),
          fonts: {
            baseUrl: resolveFontBaseUrl(
              options.fonts?.baseUrl ?? DEFAULT_FONT_BASE_URL,
              typeof location !== 'undefined' ? location.href : undefined,
            ),
          },
          onProgress: undefined,
          signal: undefined,
          audioResolver: undefined,
          onAudioIssue: undefined,
          onFontIssue: undefined,
          onWarning: undefined,
          preDecoded,
        },
        audio: null,
        trace: getEnabledChannels(),
      },
      Object.values(preDecoded),
    )
  })
}
