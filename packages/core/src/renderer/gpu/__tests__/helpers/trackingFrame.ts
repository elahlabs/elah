import { vi } from 'vitest'

let frameCounter = 0

export interface TrackingFrame extends VideoFrame {
  readonly id: number
  readonly closeCount: () => number
}

/**
 * VideoFrame mock that tracks close() calls and throws on double-close.
 *
 * `clone()` mirrors the real WebCodecs semantics: each call returns an
 * independent reference with its own close counter, so the original and its
 * clones can each be closed exactly once without tripping the double-close
 * guard. VideoLayer.draw() relies on clone() to keep the FrameCache's owned
 * reference alive while VideoTexture.upload() consumes (closes) a clone.
 */
export function createTrackingFrame(
  overrides: Partial<{ displayWidth: number; displayHeight: number }> = {},
): TrackingFrame {
  return makeTrackingFrame(overrides.displayWidth ?? 640, overrides.displayHeight ?? 360)
}

function makeTrackingFrame(width: number, height: number): TrackingFrame {
  frameCounter++
  let closed = 0
  const id = frameCounter

  const frame = {
    id,
    displayWidth: width,
    displayHeight: height,
    closeCount: () => closed,
    close: vi.fn(() => {
      closed++
      if (closed > 1) {
        throw new Error(`TrackingFrame ${id}: double-close detected`)
      }
    }),
    clone: vi.fn(() => makeTrackingFrame(width, height)),
  }

  return frame as unknown as TrackingFrame
}

export function resetTrackingFrameCounter(): void {
  frameCounter = 0
}
