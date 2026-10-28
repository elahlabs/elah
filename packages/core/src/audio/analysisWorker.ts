/// <reference lib="webworker" />

/**
 * analysisWorker — the module-worker entry for PV-P10b-2's beat detection.
 *
 * Mirrors `export/ExportWorker.ts`'s worker-side shape: installed only inside
 * a real dedicated worker (never imported by `index.ts`, which would assign
 * `self.onmessage` on the page if this were ever pulled into a non-worker
 * bundle). Pure: imports only `./analysis`, no DOM.
 */

import { analyzePcm } from './analysis'
import type { AnalysisWorkerIn, AnalysisWorkerOut } from './analyzeInWorker'

self.onmessage = (e: MessageEvent<AnalysisWorkerIn>) => {
  const { pcm, sampleRate, fps } = e.data
  try {
    const analysis = analyzePcm(pcm, sampleRate, fps)
    const out: AnalysisWorkerOut = { type: 'done', analysis }
    const b = analysis.bands
    ;(self as unknown as Worker).postMessage(out, [analysis.loudness.buffer, b.low.buffer, b.mid.buffer, b.high.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ type: 'error', message: String(err) } satisfies AnalysisWorkerOut)
  }
}
