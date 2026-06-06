import type { Transform, TransitionKind, TransitionDirection } from '../types'

/**
 * Scene — the output type of resolveTimeline().
 *
 * Describes exactly what is visible and audible at a single frame.
 * The renderer consumes ONLY this object — it never reads Project directly.
 *
 * Array ordering: index 0 = bottom (back) layer, last index = top (front) layer.
 * Renderers draw in forward iteration order so the last element wins visually.
 *
 * This structure is intentionally minimal today but shaped to support:
 * - transitions (reserved array, types TBD)
 * - effects / filters (add `effects` array to ActiveClipBase when needed)
 * - WebGL/WebGPU (typed array of draw commands, same Scene as input)
 * - WASM export pipelines (pure data, no DOM references)
 */

export interface ActiveClipBase {
  id: string
  trackId: string
  name: string
  /**
   * The source-asset frame that corresponds to the current playback position.
   * = (currentFrame - clip.startFrame) + clip.sourceStartFrame
   * Renderers use this to seek the underlying media element.
   */
  sourceFrame: number
  /** 0–1 opacity for compositing */
  opacity: number
  /**
   * Visual stacking priority: higher = closer to the viewer (front / on top).
   * Computed from track.order so CSS / canvas conventions hold: render in
   * ascending order and the last (highest zIndex) element wins.
   */
  zIndex: number
  /** Spatial transform from the source clip; undefined means the renderer applies its own default */
  transform?: Transform
}

export interface ActiveVideoClip extends ActiveClipBase {
  type: 'video'
  src: string
  /** Effective volume after track mute is applied. 0–1. */
  volume: number
}

export interface ActiveAudioClip extends ActiveClipBase {
  type: 'audio'
  src: string
  /** Effective volume after track mute is applied. 0–1. */
  volume: number
}

export interface ActiveTextClip extends ActiveClipBase {
  type: 'text'
  content: string
  /** Glyph size in stage-space pixels. Undefined → TextLayer default. */
  fontSize?: number
  /** CSS color string. Undefined → TextLayer default. */
  color?: string
  /** CSS font-family. Undefined → TextLayer default. */
  fontFamily?: string
  fontWeight?: 'normal' | 'bold'
  textAlign?: 'left' | 'center' | 'right'
}

export interface ActiveImageClip extends ActiveClipBase {
  type: 'image'
  src: string
}

/**
 * A transition that is active at the current frame, ready for renderers.
 *
 * `t` is the eased progress through the transition window (0 = start, 1 = end).
 * For fade: the resolver already adjusts clip opacities — renderers need no extra
 * work. For slide/wipe: TransitionOverlay reads `kind + t + direction` to apply CSS.
 *
 * Adding a new kind = handle it in resolveTimeline (opacity math) and
 * TransitionOverlay (CSS). Everything else is plug-and-play.
 */
export interface ActiveTransition {
  id: string
  kind: TransitionKind
  /** Eased progress 0→1 through the transition window. */
  t: number
  direction?: TransitionDirection
}

/**
 * A fully-resolved snapshot of the project at a single frame.
 *
 * All arrays are sorted bottom-to-top (index 0 = furthest back).
 * Renderers iterate forward; the last element in each array renders on top.
 *
 * zIndex semantics: higher value = closer to the viewer (front), matching
 * CSS / canvas conventions. The resolver computes zIndex so that the
 * topmost track in the editor UI gets the highest zIndex value.
 *
 * `fps` and `stage` are part of the render contract — the renderer must
 * never ask the engine or project directly for these values.
 */
export interface Scene {
  /** The frame this Scene was resolved at. */
  frame: number
  /** Frames per second from the project. Renderers use this for timing. */
  fps: number
  /** Logical output canvas dimensions in pixels. */
  stage: { width: number; height: number }
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  /** Transitions active at this frame. For fade, clip opacities are already adjusted. */
  transitions: ActiveTransition[]
}
