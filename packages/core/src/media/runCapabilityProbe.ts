/**
 * Runs the capability probe in this window AND in a fresh module worker
 * (PV-P8a), so a dev harness can compare the two scopes in one call.
 *
 * The worker is spawned with a LITERAL `new URL('./capabilityProbe.worker.ts',
 * import.meta.url)` right here — not built in a helper — because bundlers
 * find module workers by static analysis of that exact call shape (the same
 * pattern `exportVideo.ts` uses for `ExportWorker.ts`).
 */

import { probeScope, type ScopeCapabilities } from './capabilities'

export interface CapabilityReport {
  userAgent: string
  window: ScopeCapabilities
  worker: ScopeCapabilities | { error: string }
}

/**
 * Probe this window and a module worker. Worker errors and a timeout both
 * resolve as `{ error }` on the `worker` field — this function itself never
 * rejects, so a dev harness can always show *something*.
 */
export async function runCapabilityProbe(timeoutMs = 20_000): Promise<CapabilityReport> {
  const windowCapabilities = await probeScope()

  const worker = await new Promise<ScopeCapabilities | { error: string }>((resolve) => {
    let settled = false
    const finish = (result: ScopeCapabilities | { error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      w.terminate()
      resolve(result)
    }

    const timer = setTimeout(() => finish({ error: `capability probe worker timed out after ${timeoutMs}ms` }), timeoutMs)

    let w: Worker
    try {
      w = new Worker(new URL('./capabilityProbe.worker.ts', import.meta.url), { type: 'module' })
    } catch (err) {
      clearTimeout(timer)
      resolve({ error: String(err) })
      return
    }

    w.onmessage = (e: MessageEvent<ScopeCapabilities | { error: string }>) => finish(e.data)
    w.onerror = (e: ErrorEvent) => finish({ error: e.message || 'capability probe worker error' })
    w.postMessage(null)
  })

  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    window: windowCapabilities,
    worker,
  }
}
