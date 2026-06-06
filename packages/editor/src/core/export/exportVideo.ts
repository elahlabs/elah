import type { Project } from '../types'
import type { ExportOptions, ExportProgress, WorkerOutMessage } from './types'

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
export function exportVideo(project: Project, options: ExportOptions = {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./ExportWorker.ts', import.meta.url),
      { type: 'module' },
    )

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        options.onProgress?.({ frame: msg.frame, totalFrames: msg.totalFrames })
      } else if (msg.type === 'done') {
        worker.terminate()
        resolve(new Blob([msg.buffer], { type: 'video/mp4' }))
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }

    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(`ExportWorker crashed: ${e.message}`))
    }

    worker.postMessage({ type: 'start', project, options: { ...options, onProgress: undefined } })
  })
}
