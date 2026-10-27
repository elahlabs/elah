/**
 * analyzeInWorker — main-thread side of PV-P10b-2's beat-detection worker.
 *
 * Mirrors `export/exportVideo.ts`'s `new Worker(new URL(...), { type: 'module' })`
 * pattern: the literal form is what Vite, webpack 5 and Turbopack recognise to
 * bundle `analysisWorker.ts` from source, so it must stay a literal here (not
 * behind a variable or a function).
 */

import { analyzePcm, type AudioAnalysis } from './analysis'
import { isCrossOriginModule, siblingWorkerUrl, startCrossOriginModuleWorker } from '../utils/workerUrl'

/** The message posted to `analysisWorker.ts`. `pcm`'s buffer is transferred. */
export interface AnalysisWorkerIn {
  type: 'analyze'
  pcm: Float32Array
  sampleRate: number
  fps: number
}

/** The message posted back by `analysisWorker.ts`. */
export type AnalysisWorkerOut =
  | { type: 'done'; analysis: AudioAnalysis }
  | { type: 'error'; message: string }

export interface AnalyzeInWorkerResult {
  analysis: AudioAnalysis
  /** Whether this ran in a module worker, or fell back to the calling thread. */
  viaWorker: boolean
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function runOnCallingThread(pcm: Float32Array, sampleRate: number, fps: number): AnalyzeInWorkerResult {
  return { analysis: analyzePcm(pcm, sampleRate, fps), viaWorker: false }
}

/**
 * Runs `analyzePcm` in a module worker. `pcm`'s buffer is TRANSFERRED: do not
 * use `pcm` afterwards. Falls back to running on the calling thread
 * (`viaWorker: false`) when `Worker` is undefined (Node, or a bundler/CSP that
 * refuses module workers) or its constructor throws. The fallback path never
 * touches `pcm`'s buffer, so nothing is detached when there is no worker.
 */
export function analyzePcmInWorker(
  pcm: Float32Array,
  sampleRate: number,
  fps: number,
  opts?: { signal?: AbortSignal },
): Promise<AnalyzeInWorkerResult> {
  const signal = opts?.signal
  if (signal?.aborted) return Promise.reject(abortError())

  if (typeof Worker === 'undefined') {
    return Promise.resolve(runOnCallingThread(pcm, sampleRate, fps))
  }

  let worker: Worker
  try {
    // CONV-5: from another origin (a CDN), start it through a `blob:` wrapper.
    worker = isCrossOriginModule(import.meta.url)
      ? startCrossOriginModuleWorker(siblingWorkerUrl(import.meta.url, 'analysisWorker'))
      : new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve(runOnCallingThread(pcm, sampleRate, fps))
  }

  return new Promise<AnalyzeInWorkerResult>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const finishResolve = (result: AnalyzeInWorkerResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const finishReject = (err: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const onAbort = () => finishReject(abortError())
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (e: MessageEvent<AnalysisWorkerOut>) => {
      const msg = e.data
      if (msg.type === 'done') {
        finishResolve({ analysis: msg.analysis, viaWorker: true })
      } else {
        finishReject(new Error(msg.message))
      }
    }
    worker.onerror = (e: ErrorEvent) => {
      finishReject(new Error(e.message || 'analysisWorker failed'))
    }

    const message: AnalysisWorkerIn = { type: 'analyze', pcm, sampleRate, fps }
    worker.postMessage(message, [pcm.buffer])
  })
}
