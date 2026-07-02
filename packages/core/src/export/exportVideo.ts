import type { Project } from '../types'
import { getTotalFrames } from '../utils/frames'
import { trace, traceEnabled, getEnabledChannels, type TraceChannel } from '../debug/trace'
import { defaultAudioResolver, type AudioResolver } from '../media/audio/audioResolver'
import type { ExportOptions, ExportProgress, RenderedAudio, WorkerOutMessage } from './types'

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
async function renderAudioMix(
  project: Project,
  audioResolver: AudioResolver,
  onAudioIssue?: (message: string, src: string | undefined) => void,
): Promise<RenderedAudio | null> {
  const fps = project.fps
  const totalFrames = getTotalFrames(project.clips)
  if (totalFrames === 0) return null

  const allClips = Object.values(project.clips).flat()
  const audioClips = allClips.filter((c) => {
    if (c.type !== 'audio' || !c.src || c.disabled) return false
    const track = project.tracks.find((t) => t.id === c.trackId)
    return track && !track.muted && !track.disabled
  })
  if (audioClips.length === 0) {
    mlog('EXPORT_AUDIO', 'no active audio clips — exporting video-only')
    return null
  }

  const OAC: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
  if (!OAC) {
    console.warn('[export:main] OfflineAudioContext unavailable — audio will be skipped')
    onAudioIssue?.('OfflineAudioContext unavailable — audio will be skipped', undefined)
    return null
  }

  const sampleRate = 44100
  const totalSec = totalFrames / fps
  mlog(
    'EXPORT_AUDIO',
    `mixing ${audioClips.length} audio clip(s) — ${totalSec.toFixed(2)}s @ ${sampleRate}Hz`,
  )
  const ctx = new OAC(2, Math.ceil(sampleRate * totalSec), sampleRate)

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

  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i]
    try {
      mlog(
        'EXPORT_AUDIO',
        `[${i + 1}/${audioClips.length}] fetching+decoding "${clip.src?.slice(-40)}"`,
      )
      const fetchStart = performance.now()
      const decoded = await decodeOnce(clip.src!)
      const node = ctx.createBufferSource()
      node.buffer = decoded
      const gain = ctx.createGain()
      gain.gain.value = clip.volume ?? 1
      node.connect(gain).connect(ctx.destination)
      node.start(clip.startFrame / fps, clip.sourceStartFrame / fps, clip.durationFrames / fps)
      mlog(
        'EXPORT_AUDIO',
        `[${i + 1}/${audioClips.length}] scheduled — ` +
          `startSec=${(clip.startFrame / fps).toFixed(3)} ` +
          `offsetSec=${(clip.sourceStartFrame / fps).toFixed(3)} ` +
          `durSec=${(clip.durationFrames / fps).toFixed(3)} ` +
          `vol=${clip.volume ?? 1} ` +
          `decodedSec=${decoded.duration.toFixed(3)} ` +
          `ms=${(performance.now() - fetchStart).toFixed(1)}`,
      )
    } catch (err) {
      const message = `audio clip "${clip.src?.slice(-40)}" skipped — decode error: ${String(err)}`
      mlog('EXPORT_AUDIO', `[${i + 1}/${audioClips.length}] skipped — decode error: ${String(err)}`)
      console.warn(`[export:main] ${message}`)
      onAudioIssue?.(message, clip.src)
    }
  }

  mlog('EXPORT_AUDIO', 'startRendering() — mixing offline graph')
  const mixed = await ctx.startRendering()
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
 * Export the project to an MP4 Blob.
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
    throw new Error(
      'An export is already in progress. Wait for it to finish before starting another.',
    )
  }
  exportInFlight = true
  try {
    return await runExportVideo(project, options)
  } finally {
    exportInFlight = false
  }
}

async function runExportVideo(project: Project, options: ExportOptions): Promise<Blob> {
  const t0 = performance.now()
  const totalClips = Object.values(project.clips).flat().length
  mlog(
    'EXPORT',
    `exportVideo() called — stage=${project.stage.width}x${project.stage.height} fps=${project.fps} clips=${totalClips}`,
  )

  const audio = await renderAudioMix(
    project,
    options.audioResolver ?? defaultAudioResolver,
    options.onAudioIssue,
  )

  const { signal } = options
  if (signal?.aborted)
    return Promise.reject(signal.reason ?? new DOMException('Export aborted', 'AbortError'))

  return new Promise((resolve, reject) => {
    mlog('EXPORT', 'spawning ExportWorker (module worker)')
    const worker = new Worker(new URL('./ExportWorker.ts', import.meta.url), { type: 'module' })

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
        const blob = new Blob([msg.buffer], { type: 'video/mp4' })
        mlog('EXPORT', `done — blob=${(blob.size / 1_000_000).toFixed(2)}MB totalTime=${elapsed}s`)
        resolve(blob)
      } else if (msg.type === 'error') {
        signal?.removeEventListener('abort', abort)
        worker.terminate()
        console.error(`[export:main] worker reported error: ${msg.message}`)
        reject(new Error(msg.message))
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
        options: {
          ...options,
          onProgress: undefined,
          signal: undefined,
          audioResolver: undefined,
          onAudioIssue: undefined,
        },
        audio,
        // Forward the main thread's enabled channels so the Worker's tracer
        // mirrors them — it can't read `__trace`/localStorage on its own.
        trace: getEnabledChannels(),
      },
      audio ? audio.channels : [],
    )
  })
}
