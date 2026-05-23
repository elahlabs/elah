import { vi } from 'vitest'

let frameCounter = 0

export interface TrackingFrame extends VideoFrame {
  readonly id: number
  readonly closeCount: () => number
}

/** VideoFrame mock that tracks close() calls and throws on double-close. */
export function createTrackingFrame(
  overrides: Partial<{ displayWidth: number; displayHeight: number }> = {},
): TrackingFrame {
  frameCounter++
  let closed = 0
  const id = frameCounter

  const frame = {
    id,
    displayWidth: overrides.displayWidth ?? 640,
    displayHeight: overrides.displayHeight ?? 360,
    closeCount: () => closed,
    close: vi.fn(() => {
      closed++
      if (closed > 1) {
        throw new Error(`TrackingFrame ${id}: double-close detected`)
      }
    }),
  }

  return frame as unknown as TrackingFrame
}

export function resetTrackingFrameCounter(): void {
  frameCounter = 0
}
