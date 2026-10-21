/**
 * DOM-free representation of an SVG element tree (PV-P6b-2).
 *
 * Nothing in `vector/` uses `DOMParser`, `Path2D` or any browser API: the
 * converter (`svgToProject.ts`) walks this plain tree, and the test-only
 * `__tests__/xml.ts` builds one from a string in Node.
 */

import type { Project } from '../../types'

export interface SvgNode {
  /** Local element name without namespace prefix, as written: 'svg', 'g', 'path', 'linearGradient'… */
  tag: string
  /** Attributes by local name (`xlink:href` is stored as `href`); raw strings. xmlns attributes omitted. */
  attrs: Record<string, string>
  children: SvgNode[]
  /** Text content, only for <style> (CDATA included). */
  text?: string
}

export interface SvgImportOptions {
  fps: number
  durationFrames: number
  /** Long side of the child stage in px. Default 1024. */
  size?: number
  /** Most shape clips emitted; the rest are counted as 'element-limit'. Default maxShapesForStage(stage). */
  maxShapes?: number
}

export interface SvgSkip {
  feature: string
  count: number
}

export interface SvgImportResult {
  project: Project
  /** Sorted by feature name. */
  skipped: SvgSkip[]
  /** Drawable shapes found, including any dropped by the limit. */
  shapeCount: number
}
