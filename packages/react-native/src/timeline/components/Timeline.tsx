import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  useAnimatedRef,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { Track } from '@elah/core'
import {
  clampZoom,
  playbackStore,
  timelineContentWidth,
  tracksStore,
} from '@elah/core/engine'
import { useTimelineEngine, usePlaybackStore, useTracksStore } from '@elah/react'
import { computeLaneSlots, lanesHeight } from '../model/layout'
import {
  applyEngineCommand,
  defaultCommandTargets,
} from '../model/commands'
import {
  beginPinch,
  fitToWindowZoom,
  pinchPreviewTransform,
  updatePinch,
  zoomAtPlayhead as planZoomAtPlayhead,
  type PinchSession,
  type ZoomPreview,
} from '../model/zoomGesture'
import { ClipBlock } from './ClipBlock'
import { Playhead } from './Playhead'
import { Ruler } from './Ruler'
import { timelineColors } from './colors'

const DEFAULT_TRACK_LABEL_WIDTH = 96
const DEFAULT_RULER_HEIGHT = 28
/** Web uses 80px; wider labels are easier to read on phones. */
const DEFAULT_RULER_TARGET_SPACING_PX = 120

export interface TimelineRef {
  /**
   * Horizontal scroll offset of the lanes, px, updated on the UI thread. The
   * ruler, the playhead and the pinch preview read it in worklets to stay
   * aligned with the lanes. Reading `.value` on the JS thread is fine for
   * one-off use.
   */
  scrollX: SharedValue<number>
  /** Scroll the lanes so lane-content x sits at the left edge. */
  scrollTo(x: number, animated?: boolean): void
  /**
   * Set the zoom (px per frame, clamped to the store's range), keeping the
   * playhead still on screen when it is visible and the viewport centre
   * otherwise. Used by the toolbar zoom buttons. Commits once, like a pinch.
   */
  zoomAtPlayhead(nextZoom: number): void
  /**
   * Set the zoom so the whole timeline fits the visible lanes width, scrolled
   * to the start. Falls back to a 10-second baseline when the timeline is empty.
   */
  fitToWindow(): void
}

export interface TimelineProps {
  style?: StyleProp<ViewStyle>
  /** Width of the fixed track-label column, px. Default 96. */
  trackLabelWidth?: number
  /** Height of the fixed ruler strip above the lanes, px. Default 28. */
  rulerHeight?: number
  /** Target distance between ruler labels, px. Default 120 (web uses 80; phones need more room to read labels). */
  rulerTargetSpacingPx?: number
  /** Icon shown before the track name. The library ships no icon set; pass your own. */
  renderTrackIcon?: (track: Track) => ReactNode
  /** Layout of the scrollable lanes viewport (excludes the label column), on every layout change. */
  onLayoutLanes?: (layout: LayoutRectangle) => void
}

/**
 * The mobile timeline: a fixed track-label column, and a right column holding
 * a fixed timecode ruler, horizontally scrolling lanes with one block per clip,
 * and the playhead needle spanning both. Tap or drag on the ruler to seek
 * (RN-T5). Pinch anywhere in the right column to zoom (RN-T8): the pinch
 * shows a live preview on the UI thread and commits one zoom change on
 * release. The lanes themselves are still read-only until RN-T6.
 *
 * Geometry comes from the platform-free model (`computeLaneSlots`, `clipRect`)
 * and `timelineContentWidth` from core, so positions match the web timeline
 * and the Node tests. The component renders when the project or zoom changes,
 * never while scrolling, playing or pinching: the ruler, playhead and lanes
 * move on the UI thread, and neither this component nor `ClipBlock` subscribes
 * to `currentFrame`. Vertical scrolling is the parent's job: the lanes are laid
 * out at their full height.
 */
export const Timeline = forwardRef<TimelineRef, TimelineProps>(function Timeline(
  {
    style,
    trackLabelWidth = DEFAULT_TRACK_LABEL_WIDTH,
    rulerHeight = DEFAULT_RULER_HEIGHT,
    rulerTargetSpacingPx = DEFAULT_RULER_TARGET_SPACING_PX,
    renderTrackIcon,
    onLayoutLanes,
  },
  ref,
) {
  const engine = useTimelineEngine()
  const targets = useMemo(() => defaultCommandTargets(engine), [engine])
  const fps = useMemo(() => engine.getProject().fps, [engine])
  const tracks = useTracksStore((s) => s.tracks)
  const clips = useTracksStore((s) => s.clips)
  const totalFrames = useTracksStore((s) => s.totalFrames)
  const zoom = usePlaybackStore((s) => s.zoom)

  const lanes = useMemo(() => computeLaneSlots(tracks), [tracks])
  const tracksById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const height = lanesHeight(lanes)
  const contentWidth = timelineContentWidth(totalFrames, zoom)

  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollX = useScrollOffset(scrollRef)

  // Lanes viewport width, px. A ref, not state: only the zoom helpers read it.
  const laneWidth = useRef(0)

  // Live pinch preview, read on the UI thread. 1 / 0 when idle.
  const pinchScale = useSharedValue(1)
  const pinchTx = useSharedValue(0)

  // Scroll offset to apply once the committed zoom has re-laid out the lanes.
  const pendingScrollX = useRef<number | null>(null)

  /**
   * The single place a zoom is committed (pinch end, toolbar buttons, fit).
   * Sets the store once. The scroll waits for the layout effect below: scrolling
   * before the re-layout would clamp against the old content width.
   */
  const commitZoom = useCallback(
    (nextZoom: number, nextScrollX: number) => {
      const current = playbackStore.getState().zoom
      if (clampZoom(nextZoom) === current) {
        // The store will not change, so there is no re-layout to wait for.
        scrollRef.current?.scrollTo({ x: nextScrollX, animated: false })
        pinchScale.value = 1
        pinchTx.value = 0
        return
      }
      pendingScrollX.current = nextScrollX
      applyEngineCommand(targets, { type: 'setZoom', zoom: nextZoom })
    },
    [targets, scrollRef, pinchScale, pinchTx],
  )

  // After the re-layout at the new width: apply the pending scroll and drop the preview.
  useLayoutEffect(() => {
    if (pendingScrollX.current === null) return
    scrollRef.current?.scrollTo({ x: pendingScrollX.current, animated: false })
    pendingScrollX.current = null
    pinchScale.value = 1
    pinchTx.value = 0
  }, [zoom, scrollRef, pinchScale, pinchTx])

  // Pinch: the callbacks run on the JS thread (`runOnJS`), which keeps them
  // plain, testable model calls. Only the shared values change per update, so
  // nothing re-renders mid-pinch. One `setZoom` happens on release.
  const session = useRef<PinchSession | null>(null)
  const preview = useRef<ZoomPreview | null>(null)
  const committed = useRef(false)

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart((e) => {
          committed.current = false
          preview.current = null
          session.current = beginPinch(playbackStore.getState().zoom, scrollX.value, e.focalX)
        })
        .onUpdate((e) => {
          const s = session.current
          if (!s) return
          const p = updatePinch(s, e.scale, e.focalX)
          preview.current = p
          const { scale, tx } = pinchPreviewTransform(s, p)
          pinchScale.value = scale
          pinchTx.value = tx
        })
        .onEnd((_e, success) => {
          const p = preview.current
          if (success && p) {
            committed.current = true
            commitZoom(p.zoom, p.scrollX)
          } else {
            pinchScale.value = 1
            pinchTx.value = 0
          }
        })
        .onFinalize(() => {
          if (!committed.current) {
            pinchScale.value = 1
            pinchTx.value = 0
          }
          session.current = null
          preview.current = null
        }),
    [commitZoom, scrollX, pinchScale, pinchTx],
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollX,
      scrollTo: (x, animated = true) => scrollRef.current?.scrollTo({ x, animated }),
      zoomAtPlayhead: (nextZoom) => {
        const state = playbackStore.getState()
        const next = planZoomAtPlayhead(
          state.zoom,
          scrollX.value,
          state.currentFrame,
          laneWidth.current,
          nextZoom,
        )
        commitZoom(next.zoom, next.scrollX)
      },
      fitToWindow: () => {
        const z = fitToWindowZoom(laneWidth.current, tracksStore.getState().totalFrames, fps)
        commitZoom(z, 0)
      },
    }),
    [scrollX, scrollRef, commitZoom, fps],
  )

  const lanesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pinchTx.value }, { scaleX: pinchScale.value }],
  }))

  return (
    <View style={[styles.root, style]}>
      <View style={[styles.labels, { width: trackLabelWidth, paddingTop: rulerHeight }]}>
        {lanes.map((lane) => {
          const track = tracksById.get(lane.trackId)
          if (!track) return null
          return (
            <View key={lane.trackId} style={[styles.label, { height: lane.height }]}>
              {renderTrackIcon?.(track)}
              <Text numberOfLines={1} style={styles.labelText}>
                {track.name}
              </Text>
              {track.locked && <Text style={styles.labelLock}>🔒</Text>}
            </View>
          )
        })}
      </View>

      <GestureDetector gesture={pinch}>
        <View style={styles.content}>
          <Ruler
            scrollX={scrollX}
            zoom={zoom}
            totalFrames={totalFrames}
            fps={fps}
            height={rulerHeight}
            targetSpacingPx={rulerTargetSpacingPx}
            pinchScale={pinchScale}
            pinchTx={pinchTx}
          />
          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ height }}
            onLayout={(e) => {
              laneWidth.current = e.nativeEvent.layout.width
              onLayoutLanes?.(e.nativeEvent.layout)
            }}
          >
            <Animated.View style={[{ width: contentWidth, height, transformOrigin: 'left' }, lanesStyle]}>
              {lanes.map((lane) => (
                <View key={lane.trackId} style={[styles.lane, { top: lane.top, height: lane.height }]} />
              ))}
              {lanes.flatMap((lane) =>
                (clips[lane.trackId] ?? []).map((clip) => <ClipBlock key={clip.id} clip={clip} lane={lane} zoom={zoom} />),
              )}
            </Animated.View>
          </Animated.ScrollView>
          <Playhead scrollX={scrollX} zoom={zoom} pinchScale={pinchScale} pinchTx={pinchTx} />
        </View>
      </GestureDetector>
    </View>
  )
})

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    backgroundColor: timelineColors.laneBackground,
  },
  labels: {
    backgroundColor: timelineColors.labelBackground,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: timelineColors.border,
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: timelineColors.border,
  },
  labelText: {
    flexShrink: 1,
    color: timelineColors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  labelLock: {
    marginLeft: 'auto',
    fontSize: 10,
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  lane: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: timelineColors.border,
  },
})
