/**
 * One helper for both threads that resolve with layout (PV-P3b): the preview
 * and the export worker each hand it a way to make a measuring context, and
 * get back the `ResolveOptions` `resolveTimeline` should be called with.
 *
 * `makeContext` is called at most once, and only when `project` actually uses
 * `layout` — a project that never constrains anything never pays for a
 * canvas. DOM-free itself (the worker imports it too): it never touches
 * `document` or `OffscreenCanvas` directly, only the context its caller hands
 * it.
 */

import type { Project } from '../types'
import type { ResolveOptions } from './resolveTimeline'
import { projectUsesLayout } from './layout'
import { createCanvasMeasurer, type MeasureContext } from '../renderer/gpu/layers/textMeasure'

/**
 * Resolve options for a painter (PV-P3b): a measurer over the context
 * `makeContext` returns, only when the project uses layout. `makeContext` is
 * not called otherwise. The preview passes a 1×1 canvas, the export worker a
 * 1×1 OffscreenCanvas, so both measure with the same engine.
 */
export function layoutResolveOptions(
  project: Project,
  makeContext: () => MeasureContext | null | undefined,
): ResolveOptions {
  if (!projectUsesLayout(project)) return {}
  const ctx = makeContext()
  return ctx ? { measure: createCanvasMeasurer(ctx) } : {}
}
