/**
 * Browser support gate for the export path (REN-4).
 *
 * Export needs `VideoEncoder`/`VideoDecoder` (WebCodecs), a `Worker`,
 * `OffscreenCanvas`, and WebGL2 on an `OffscreenCanvas`. `detectExportSupport`
 * is pure: the environment is injected so Node tests cover each missing
 * feature, and the UI asks it BEFORE offering Export instead of failing
 * mid-export. Only Chrome and Edge have been run against this path; Safari
 * and Firefox are untested and the message says so.
 */

export interface ExportSupportEnv {
  VideoEncoder?: unknown
  VideoDecoder?: unknown
  OffscreenCanvas?: unknown
  Worker?: unknown
}

export type ExportSupportFeature = 'VideoEncoder' | 'VideoDecoder' | 'OffscreenCanvas' | 'Worker' | 'WebGL2'

export interface ExportSupport {
  ok: boolean
  missing: ExportSupportFeature[]
  /** Empty when `ok`; otherwise a user-facing explanation. */
  message: string
}

export const EXPORT_UNSUPPORTED_MESSAGE =
  'This browser cannot export video yet. Export is supported in recent Chrome and Edge; Safari and Firefox are untested.'

type OffscreenCtor = new (width: number, height: number) => { getContext(id: string): unknown }

function hasWebGL2OnOffscreen(ctor: unknown): boolean {
  if (typeof ctor !== 'function') return false
  try {
    const canvas = new (ctor as OffscreenCtor)(1, 1)
    return !!canvas.getContext('webgl2')
  } catch {
    return false
  }
}

/** Defaults to `globalThis`; pass a stub env in tests. */
export function detectExportSupport(env: ExportSupportEnv = globalThis as unknown as ExportSupportEnv): ExportSupport {
  const missing: ExportSupportFeature[] = []
  if (typeof env.VideoEncoder === 'undefined') missing.push('VideoEncoder')
  if (typeof env.VideoDecoder === 'undefined') missing.push('VideoDecoder')
  if (typeof env.OffscreenCanvas === 'undefined') missing.push('OffscreenCanvas')
  if (typeof env.Worker === 'undefined') missing.push('Worker')
  // WebGL2 can only be probed when OffscreenCanvas exists; without it that is
  // already reported, so do not double-count.
  if (typeof env.OffscreenCanvas !== 'undefined' && !hasWebGL2OnOffscreen(env.OffscreenCanvas)) missing.push('WebGL2')
  if (missing.length === 0) return { ok: true, missing, message: '' }
  return { ok: false, missing, message: `${EXPORT_UNSUPPORTED_MESSAGE} Missing: ${missing.join(', ')}.` }
}
