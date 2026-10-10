import { memo, useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { playbackStore } from '@elah/core/engine'
import { timelineColors } from './colors'

export interface PlayheadProps {
  /** Horizontal scroll offset of the lanes, px (`TimelineRef.scrollX`). Read on the UI thread. */
  scrollX: SharedValue<number>
  /** Pixels per frame. */
  zoom: number
}

/**
 * The playhead needle. Its frame lives in a Reanimated shared value that is
 * fed from `playbackStore.subscribe`, not from React state: during playback the
 * frame changes every tick, and routing that through `useState` would
 * re-render the timeline on every frame. Writing the shared value moves the
 * needle on the UI thread without touching React at all.
 */
export const Playhead = memo(function Playhead({ scrollX, zoom }: PlayheadProps) {
  const frame = useSharedValue(playbackStore.getState().currentFrame)

  useEffect(() => {
    // The store may have moved between render and subscribe; sync once first.
    frame.value = playbackStore.getState().currentFrame
    return playbackStore.subscribe((s, prev) => {
      if (s.currentFrame !== prev.currentFrame) frame.value = s.currentFrame
    })
  }, [frame])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: frame.value * zoom - scrollX.value }],
  }))

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.needle, { backgroundColor: timelineColors.playhead }, animatedStyle]}
    />
  )
})

const styles = StyleSheet.create({
  needle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 2,
  },
})
