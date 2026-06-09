import type { Project } from '../types'
import { getTotalFrames } from '../utils/frames'
import { trace, traceEnabled, getEnabledChannels, type TraceChannel } from '../debug/trace'
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
async function renderAudioMix(project: Project): Promise<RenderedAudio | null> {
  const fps = project.fps
  const totalFrames = getTotalFrames(project.clips)
  if (totalFrames === 0) return null

  const allClips = Object.values(project.clips).flat()
  const audioClips = allClips.filter(c => {
    if (c.type !== 'audio' || !c.src || c.disabled) return false
    const track = project.tracks.find(t => t.id === c.trackId)
    return track && !track.muted && !track.disabled
  })
  if (audioClips.length === 0) {
    mlog('EXPORT_AUDIO', 'no active audio clips — exporting video-only')
    return null
  }

  const OAC: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!OAC) {
    console.warn('[export:main] OfflineAudioContext unavailable — audio will be skipped')
    return null
  }

  const sampleRate = 44100
  const totalSec = totalFrames / fps
  mlog('EXPORT_AUDIO', `mixing ${audioClips.length} audio clip(s) — ${totalSec.toFixed(2)}s @ ${sampleRate}Hz`)
  const ctx = new OAC(2, Math.ceil(sampleRate * totalSec), sampleRate)

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
    } catch (err) {
      console.warn(`[export:main] audio clip "${clip.src?.slice(-40)}" skipped — decode error: ${String(err)}`)
    }
  }

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
 * The worker must be bundled as a module worker by the consuming app's bundler
 * (Vite handles the `new URL(...)` pattern automatically).
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
  const t0 = performance.now()
  const totalClips = Object.values(project.clips).flat().length
  mlog('EXPORT', `exportVideo() called — stage=${project.stage.width}x${project.stage.height} fps=${project.fps} clips=${totalClips}`)

  const audio = await renderAudioMix(project)

  const { signal } = options
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Export aborted', 'AbortError'))

  return new Promise((resolve, reject) => {
    mlog('EXPORT', 'spawning ExportWorker (module worker)')
    const worker = new Worker(
      new URL('./ExportWorker.js', import.meta.url),
      { type: 'module' },
    )

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
        options: { ...options, onProgress: undefined, signal: undefined },
        audio,
        // Forward the main thread's enabled channels so the Worker's tracer
        // mirrors them — it can't read `__trace`/localStorage on its own.
        trace: getEnabledChannels(),
      },
      audio ? audio.channels : [],
    )
  })
}
