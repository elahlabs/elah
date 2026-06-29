import { useCallback } from 'react'
import type { AudioPlaybackController } from './AudioPlaybackController'
import type { TimelineEngine } from '../../editor/TimelineEngine'

export interface MasterVolumeApi {
  /** Current master volume (linear, 0..2). Reads from the project model. */
  masterVolume: number
  /**
   * Set master volume: ramps the audio graph for click-free output and persists
   * the value to the project model (saved with the project).
   */
  setMasterVolume(value: number): void
}

/**
 * Exposes the project master volume with both immediate audio graph control
 * (via the controller) and persistent project model updates (via the engine).
 */
export function useMasterVolume(
  controller: AudioPlaybackController | null,
  engine: TimelineEngine,
): MasterVolumeApi {
  const masterVolume = engine.getProject().masterVolume ?? 1

  const setMasterVolume = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(2, value))
      // Immediate, click-free audio output.
      controller?.setMasterGain(clamped)
      // Persist to the project so it survives re-mounts and is exported.
      engine.setMasterVolume(clamped)
    },
    [controller, engine],
  )

  return { masterVolume, setMasterVolume }
}
