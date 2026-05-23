/**
 * Debug-only render item types for GPU renderer validation.
 *
 * These types exist solely to exercise the render graph and shader pipeline
 * before real media decoding is wired in. Not exported from the package root.
 */

/** A deterministic colored quad used by TestLayer for visual validation. */
export interface DebugRenderItem {
  id: string
  zIndex: number
  /** RGBA colour in 0..1 range. */
  color: [number, number, number, number]
  /** Top-left X in stage pixels. */
  x: number
  /** Top-left Y in stage pixels. */
  y: number
  /** Width in stage pixels. */
  width: number
  /** Height in stage pixels. */
  height: number
  /** Rotation in radians; positive = clockwise. Defaults to 0. */
  rotation?: number
  /** Compositing opacity 0..1. Defaults to 1. */
  opacity?: number
}

/** Named visual validation scenarios. */
export type DebugScenario = 'A' | 'B' | 'C' | 'D' | 'E'

/** Default logical stage dimensions used by debug scenarios. */
export const DEBUG_STAGE = { width: 1280, height: 720 } as const
