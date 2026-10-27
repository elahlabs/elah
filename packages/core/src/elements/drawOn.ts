/**
 * Draw-on presets for shapes (EDX-P9): the outline draws itself in, out, or
 * both, written as ordinary keys on the `draw` channel so it shows in the
 * curve editor and the timeline lane like any other animation.
 */

import type { Clip } from '../types'
import { clearKeyframeChannel, setKeyframe, type BaselineContext } from './keyframes'

export type DrawOnMode = 'draw-on' | 'draw-off' | 'draw-on-off'

export const DRAW_ON_MODES: ReadonlyArray<{ id: DrawOnMode; label: string }> = [
  { id: 'draw-on', label: 'Draw on' },
  { id: 'draw-off', label: 'Draw off' },
  { id: 'draw-on-off', label: 'Draw on, then off' },
]

const CTX: BaselineContext = { stage: { width: 1, height: 1 } }
const SMOOTH: [number, number, number, number] = [0.45, 0, 0.25, 1]

/**
 * The patch that animates a shape's outline. `frames` is how long each draw
 * takes (default: 40% of the clip, at most 45 frames). Replaces any previous
 * draw keys. Non-shape clips get `{}`.
 */
export function applyDrawOn(clip: Clip, mode: DrawOnMode, frames?: number): Partial<Clip> {
  if (clip.type !== 'shape') return {}
  const last = Math.max(1, clip.durationFrames - 1)
  const len = Math.max(1, Math.min(last, Math.round(frames ?? Math.min(45, last * 0.4))))
  const keys: Array<{ frame: number; value: number }> =
    mode === 'draw-on'
      ? [
          { frame: 0, value: 0 },
          { frame: len, value: 1 },
        ]
      : mode === 'draw-off'
        ? [
            { frame: Math.max(0, last - len), value: 1 },
            { frame: last, value: 0 },
          ]
        : [
            { frame: 0, value: 0 },
            { frame: Math.min(len, Math.floor(last / 2)), value: 1 },
            { frame: Math.max(Math.min(len, Math.floor(last / 2)) + 1, last - len), value: 1 },
            { frame: last, value: 0 },
          ]
  let working: Clip = { ...clip, ...clearKeyframeChannel(clip, 'draw') }
  for (const k of keys) {
    working = { ...working, ...setKeyframe(working, 'draw', k.frame, CTX, k.value, { easingBezier: SMOOTH }) }
  }
  return { keyframes: working.keyframes, shapeDraw: { start: 0, end: 1 } }
}

/** Remove a shape's draw-on entirely. */
export function clearDrawOn(clip: Clip): Partial<Clip> {
  const patch = clearKeyframeChannel(clip, 'draw')
  return { ...patch, shapeDraw: undefined }
}
