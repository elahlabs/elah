/**
 * Types for the HTML/CSS scene subset (MC-1a). The browser measures a scene
 * into a `MeasuredScene` (absolute boxes, line-broken text, resolved styles);
 * everything from there on is pure and DOM-free, like the rest of `vector/`.
 */

import type { SvgNode } from '../svg/types'

/** What the model writes: one HTML fragment and one `<style>` block's text. */
export interface SceneSource {
  html: string
  css: string
}

export interface SceneViolation {
  /** The element's id, else a tag path such as `section > div[1]`; `style` / `html` for sheet-level problems. */
  element: string
  property?: string
  value?: string
  message: string
  /** The native thing to use instead, where one exists. */
  substitute?: string
}

export interface MeasuredBox {
  x: number
  y: number
  width: number
  height: number
}

/** Only the resolved values the emitter reads. Colours are CSS strings; lengths are stage px. */
export interface MeasuredStyle {
  color?: string
  backgroundColor?: string
  /** The raw gradient string (`linear-gradient(...)`), or absent. */
  backgroundImage?: string
  borderWidth?: number
  borderColor?: string
  borderRadius?: number
  /**
   * The four corner radii in px [top-left, top-right, bottom-right, bottom-left]
   * (MC-1d). Read only when they differ; `borderRadius` stays the uniform value
   * (or, when they differ, the largest, which is what an `overflow: hidden`
   * fallback should use).
   */
  borderRadii?: [number, number, number, number]
  /** The computed `box-shadow` string (one outer shadow), or `none` / absent (MC-1d). */
  boxShadow?: string
  /** The computed `text-decoration-line` of this node: `underline`, `line-through`, `none` (MC-1d). */
  textDecoration?: string
  /** Padding-left in px: the text clip's own uniform padding. */
  padding?: number
  /**
   * The four paddings in px [top, right, bottom, left] (MC-1f). When absent the emitter takes `padding` for the
   * horizontal sides and works the vertical one out from the box height and the text's line height.
   */
  paddings?: [number, number, number, number]
  opacity?: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: string
  letterSpacing?: number
  /** Resolved line height in px. */
  lineHeight?: number
  textAlign?: string
  textShadow?: string
  webkitTextStroke?: string
  backgroundClipText?: boolean
  mixBlendMode?: string
  clipPath?: string
  overflowHidden?: boolean
  zIndex?: number
  /** Individual transform properties, as written (`translate: 10px 20px`, `rotate: 12deg`, `scale: 1.2`). */
  translate?: string
  rotate?: string
  scale?: string
  transformOrigin?: string
}

export interface MeasuredLine {
  text: string
  box: MeasuredBox
}

export interface MeasuredNode {
  id?: string
  tag: string
  /** Stage px, relative to the stage, transforms ignored. */
  box: MeasuredBox
  style: MeasuredStyle
  /** Present when the node directly holds text. */
  text?: { lines: MeasuredLine[] }
  svg?: SvgNode
  img?: {
    src: string
    /** Intrinsic size, when the browser knows it; without it the image is placed contained in a box-sized compound. */
    naturalWidth?: number
    naturalHeight?: number
    /** Resolved `object-fit`. Default fill. */
    objectFit?: string
  }
  children: MeasuredNode[]
  /** Raw `data-motion`, consumed by MC-1b. */
  motion?: string
}

export interface MeasuredScene {
  name: string
  /** Seconds. */
  at: number
  /** Seconds. */
  duration: number
  stage: { width: number; height: number }
  root: MeasuredNode
}

/** Same shape as the Lottie report where the fields overlap. */
export interface SceneReport {
  /** Clips emitted (every non-compound clip, plus nested compounds). */
  native: number
  skipped: Array<{ feature: string; count: number }>
  substitutions: Array<{ feature: string; used: string }>
  parts: Array<{ id: string; name: string }>
  /** Problems the motion grammar reported (MC-1b); the clause is skipped, the scene is not. */
  violations?: SceneViolation[]
}
