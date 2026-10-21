import { getTotalFrames } from '../utils/frames'
import type { Project } from '../types'

/** Which part of the timeline an export covers (PV-P9a-1). */
export type ExportRangeMode = 'all' | 'inOut'

/**
 * A resolved, zero-based export window over the project's ABSOLUTE frames.
 * `endFrame` is exclusive; `totalFrames = endFrame - startFrame` is the
 * number of frames the export actually encodes — the whole timeline's length
 * only when the range is `'all'` (or there is nothing to narrow it to).
 *
 * The exporter walks `[startFrame, endFrame)` for `resolveTimeline` and every
 * decoder (their windows are expressed in these same absolute frames), but
 * encodes output timestamps from zero: encoded frame `i` corresponds to
 * absolute frame `startFrame + i`. PV-P10a reuses this helper for its own
 * range needs rather than reconstructing in/out semantics (PV-CONTRACTS).
 */
export interface ExportFrameRange {
  startFrame: number
  endFrame: number
  totalFrames: number
}

/**
 * Resolves the export window.
 *
 * - `'all'` (the default) or a project with no `inOut` marked: the whole
 *   timeline, `[0, totalFrames)` — byte-identical to every export before this
 *   ticket.
 * - `'inOut'` with `project.inOut` set: that range, clamped to
 *   `[0, totalFrames]`. An empty or inverted range (after clamping) throws a
 *   descriptive error — checked by the caller BEFORE any asset fetch or audio
 *   decode, so a bad range fails fast rather than burning a whole export.
 */
export function resolveExportRange(project: Project, range: ExportRangeMode = 'all'): ExportFrameRange {
  const total = getTotalFrames(project.clips)
  if (range !== 'inOut' || !project.inOut) {
    return { startFrame: 0, endFrame: total, totalFrames: total }
  }
  const raw = project.inOut
  const startFrame = Math.max(0, Math.min(raw.in, total))
  const endFrame = Math.max(0, Math.min(raw.out, total))
  if (!(endFrame > startFrame)) {
    throw new Error(
      `Export range is empty or invalid: in=${raw.in} out=${raw.out}, clamped to [${startFrame}, ${endFrame}) of ${total} total frame(s).`,
    )
  }
  return { startFrame, endFrame, totalFrames: endFrame - startFrame }
}
