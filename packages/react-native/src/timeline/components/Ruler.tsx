import { memo, useCallback, useMemo, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useTimelineEngine } from '@elah/react'
import {
  computeRulerTicks,
  playbackStore,
  seekFrameAtX,
  timelineContentWidth,
} from '@elah/core/engine'
import { applyEngineCommand, defaultCommandTargets } from '../model/commands'
import { timelineColors } from './colors'

export interface RulerProps {
  /** Horizontal scroll offset of the lanes, px (`TimelineRef.scrollX`). Read on the UI thread. */
  scrollX: SharedValue<number>
  /** Pixels per frame. */
  zoom: number
  totalFrames: number
  fps: number
  /** Strip height, px. */
  height: number
  /** Target distance between labels, px. */
  targetSpacingPx: number
  /**
   * Live pinch preview scale, applied to the inner row with `transformOrigin: 'left'`.
   * 1 when idle. Written on the UI thread by `Timeline` during a pinch; never re-renders.
   */
  pinchScale: SharedValue<number>
  /**
   * Live pinch preview translation, px, applied before `pinchScale`. 0 when idle.
   * Together with `pinchScale` it makes the strip follow a pinch without React re-renders.
   */
  pinchTx: SharedValue<number>
}

/**
 * The fixed timecode strip above the lanes. It never scrolls itself: its inner
 * row is translated by `-scrollX` on the UI thread, so the ticks stay aligned
 * with the lanes without any React re-render while scrolling.
 *
 * Tap or drag on the strip seeks the playhead. A drag that starts while playing
 * pauses for the scrub and resumes on release. Seeks go through
 * `applyEngineCommand`, the package's only mutation funnel.
 *
 * During a pinch the strip shows a live preview: the inner row is scaled and
 * translated by `pinchScale` / `pinchTx` (see `Timeline`), so labels stretch
 * briefly until the committed zoom re-lays them out.
 *
 * Reads no `currentFrame`: the playhead owns that subscription.
 */
export const Ruler = memo(function Ruler({
  scrollX,
  zoom,
  totalFrames,
  fps,
  height,
  targetSpacingPx,
  pinchScale,
  pinchTx,
}: RulerProps) {
  const ticks = useMemo(
    () => computeRulerTicks(fps, totalFrames, zoom, targetSpacingPx),
    [fps, totalFrames, zoom, targetSpacingPx],
  )
  const contentWidth = timelineContentWidth(totalFrames, zoom)

  const engine = useTimelineEngine()
  const targets = useMemo(() => defaultCommandTargets(engine), [engine])

  // Refs, not state: a scrub must not re-render the ruler.
  const scrubbing = useRef(false)
  const wasPlaying = useRef(false)

  const seek = useCallback(
    (x: number) => {
      applyEngineCommand(targets, {
        type: 'seek',
        frame: seekFrameAtX(x, scrollX.value, playbackStore.getState().zoom),
      })
    },
    [targets, scrollX],
  )

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e, success) => {
        if (success) seek(e.x)
      })

    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .onStart((e) => {
        scrubbing.current = true
        wasPlaying.current = playbackStore.getState().isPlaying
        if (wasPlaying.current) applyEngineCommand(targets, { type: 'pause' })
        seek(e.x)
      })
      .onUpdate((e) => seek(e.x))
      .onFinalize(() => {
        if (scrubbing.current && wasPlaying.current) applyEngineCommand(targets, { type: 'play' })
        scrubbing.current = false
        wasPlaying.current = false
      })

    return Gesture.Race(pan, tap)
  }, [seek, targets])

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pinchTx.value - scrollX.value }, { scaleX: pinchScale.value }],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.root, { height, backgroundColor: timelineColors.rulerBackground }]}>
        <Animated.View style={[styles.inner, { width: contentWidth, height }, innerStyle]}>
          {ticks.map(({ frame, label }) => (
            <View key={frame} pointerEvents="none" style={[styles.tick, { left: frame * zoom, height }]}>
              <Text style={[styles.label, { color: timelineColors.tickLabel }]}>{label}</Text>
              <View style={[styles.tickLine, { height: height * 0.35, backgroundColor: timelineColors.tick }]} />
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  )
})

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  inner: {
    position: 'relative',
    transformOrigin: 'left',
  },
  tick: {
    position: 'absolute',
    top: 0,
    width: 1,
  },
  label: {
    position: 'absolute',
    top: 2,
    left: 4,
    width: 80,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
  },
  tickLine: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 1,
  },
})
