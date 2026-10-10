import { forwardRef, useImperativeHandle, useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedRef, useScrollOffset, type SharedValue } from 'react-native-reanimated'
import type { Track } from '@elah/core'
import { timelineContentWidth } from '@elah/core/engine'
import { usePlaybackStore, useTracksStore } from '@elah/react'
import { computeLaneSlots, lanesHeight } from '../model/layout'
import { ClipBlock } from './ClipBlock'
import { timelineColors } from './colors'

const DEFAULT_TRACK_LABEL_WIDTH = 96

export interface TimelineRef {
  /**
   * Horizontal scroll offset of the lanes, px, updated on the UI thread. The
   * ruler, playhead and gestures (RN-T5 to RN-T8) read it in worklets; reading
   * `.value` on the JS thread is fine for one-off use.
   */
  scrollX: SharedValue<number>
  /** Scroll the lanes so lane-content x sits at the left edge. */
  scrollTo(x: number, animated?: boolean): void
}

export interface TimelineProps {
  style?: StyleProp<ViewStyle>
  /** Width of the fixed track-label column, px. Default 96. */
  trackLabelWidth?: number
  /** Icon shown before the track name. The library ships no icon set; pass your own. */
  renderTrackIcon?: (track: Track) => ReactNode
  /** Layout of the scrollable lanes viewport (excludes the label column), on every layout change. */
  onLayoutLanes?: (layout: LayoutRectangle) => void
}

/**
 * The mobile timeline: a fixed track-label column and horizontally scrolling
 * lanes with one block per clip. Read-only in RN-T4.
 *
 * Geometry comes from the platform-free model (`computeLaneSlots`, `clipRect`)
 * and `timelineContentWidth` from core, so positions match the web timeline
 * and the Node tests. The component renders when the project or zoom changes,
 * never while scrolling. Vertical scrolling is the parent's job: the lanes are
 * laid out at their full height.
 */
export const Timeline = forwardRef<TimelineRef, TimelineProps>(function Timeline(
  { style, trackLabelWidth = DEFAULT_TRACK_LABEL_WIDTH, renderTrackIcon, onLayoutLanes },
  ref,
) {
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

  useImperativeHandle(
    ref,
    () => ({
      scrollX,
      scrollTo: (x, animated = true) => scrollRef.current?.scrollTo({ x, animated }),
    }),
    [scrollX, scrollRef],
  )

  return (
    <View style={[styles.root, style]}>
      <View style={[styles.labels, { width: trackLabelWidth }]}>
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

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroller}
        onLayout={onLayoutLanes && ((e) => onLayoutLanes(e.nativeEvent.layout))}
      >
        <View style={{ width: contentWidth, height }}>
          {lanes.map((lane) => (
            <View key={lane.trackId} style={[styles.lane, { top: lane.top, height: lane.height }]} />
          ))}
          {lanes.flatMap((lane) =>
            (clips[lane.trackId] ?? []).map((clip) => <ClipBlock key={clip.id} clip={clip} lane={lane} zoom={zoom} />),
          )}
        </View>
      </Animated.ScrollView>
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
  scroller: {
    flex: 1,
  },
  lane: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: timelineColors.border,
  },
})
