import { useEffect, useRef, useState } from 'react'
import type { AudioPlaybackController } from './AudioPlaybackController'

export interface TrackLevel {
  left: number
  right: number
}

/**
 * Polls the AudioPlaybackController's AnalyserNodes on every animation frame
 * and returns an up-to-date map of RMS levels keyed by trackId.
 *
 * Returns an empty map when the controller is null or no tracks are active.
 * Polling stops automatically when the component unmounts.
 */
export function useTrackLevels(
  controller: AudioPlaybackController | null,
): Map<string, TrackLevel> {
  const [levels, setLevels] = useState<Map<string, TrackLevel>>(new Map())
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!controller) {
      setLevels(new Map())
      return
    }

    const tick = () => {
      setLevels(controller.getTrackLevels())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [controller])

  return levels
}
