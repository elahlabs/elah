import type { Transform } from '../types'

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
}

export interface ActiveImageClip extends ActiveClipBase {
  type: 'image'
  src: string
}

/**
 * Reserved for future transition descriptors (crossfade, cut, wipe).
 * Shape will be defined when transitions are implemented; for now this
 * is an empty marker interface so the array is typed for growth.
 */
export interface SceneTransition {
  id: string
  // future fields: kind, fromClipId, toClipId, startFrame, durationFrames, ...
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
 */
export interface Scene {
  /** The frame this Scene was resolved at. */
  frame: number
  videos: ActiveVideoClip[]
  audios: ActiveAudioClip[]
  texts: ActiveTextClip[]
  images: ActiveImageClip[]
  /** Transition descriptors active at this frame. Empty until transitions are implemented. */
  transitions: SceneTransition[]
}
