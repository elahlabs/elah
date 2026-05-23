/**
 * Internal GPU renderer types.
 *
 * Not exported from the package root — these are implementation details
 * shared between GpuRenderer, RenderGraph, and future layer modules.
 */

/** Physical canvas backing-store dimensions in pixels (after DPR scaling). */
export interface Viewport {
  width: number
  height: number
}

/** Options passed to the GpuRenderer constructor. */
export interface RendererOptions {
  /** Hard cap on live GL textures; reserved for future VideoLayer use. */
  maxTextures?: number
  /** Clear colour as [r, g, b, a] in 0..1 range. Defaults to opaque black. */
  clearColor?: [number, number, number, number]
}

/**
 * Result of diffing a layer's active items against the current Scene slice.
 * Used internally by RenderGraph on every execute() call.
 */
export interface SceneDiff<TItem> {
  /** Items present in the current Scene but not yet acquired. */
  entering: TItem[]
  /** Item ids present in the active set but absent from the current Scene. */
  leaving: string[]
}
