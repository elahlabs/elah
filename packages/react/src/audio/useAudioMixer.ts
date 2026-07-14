import { useCallback } from 'react'
import type { AudioPlaybackController } from '@elah/core'

export interface AudioMixerApi {
  /** Ramp the master output gain to `value` (linear, 0..2). Click-free. */
  setMasterGain(value: number): void
  /** Ramp a per-track gain to `value` (linear, 0..2). No-op when track has no active clips. */
  setTrackGain(trackId: string, value: number): void
}

/**
 * Exposes click-free gain controls from an AudioPlaybackController.
 * Pass `null` while the controller is not yet initialized — all methods become
 * no-ops until a controller is available.
 */
export function useAudioMixer(
  controller: AudioPlaybackController | null,
): AudioMixerApi {
  const setMasterGain = useCallback(
    (value: number) => {
      controller?.setMasterGain(value)
    },
    [controller],
  )

  const setTrackGain = useCallback(
    (trackId: string, value: number) => {
      controller?.setTrackGain(trackId, value)
    },
    [controller],
  )

  return { setMasterGain, setTrackGain }
}
