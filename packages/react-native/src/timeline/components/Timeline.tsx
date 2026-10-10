import { forwardRef, useImperativeHandle, useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedRef, useScrollOffset, type SharedValue } from 'react-native-reanimated'
import type { Track } from '@elah/core'
import { timelineContentWidth } from '@elah/core/engine'
import { useTimelineEngine, usePlaybackStore, useTracksStore } from '@elah/react'
import { computeLaneSlots, lanesHeight } from '../model/layout'
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
   * ruler and playhead (RN-T5) read it in worklets to stay aligned with the
   * lanes; the gestures of RN-T6 to RN-T8 will too. Reading `.value` on the JS
   * thread is fine for one-off use.
   */
  scrollX: SharedValue<number>
  /** Scroll the lanes so lane-content x sits at the left edge. */
  scrollTo(x: number, animated?: boolean): void
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
 * and the playhead needle spanning both. In RN-T5 the ruler and playhead are
 * live: tap or drag on the ruler to seek. The lanes themselves are still
 * read-only until RN-T6.
 *
 * Geometry comes from the platform-free model (`computeLaneSlots`, `clipRect`)
 * and `timelineContentWidth` from core, so positions match the web timeline
 * and the Node tests. The component renders when the project or zoom changes,
 * never while scrolling or playing: the ruler and playhead move on the UI
 * thread, and neither this component nor `ClipBlock` subscribes to
 * `currentFrame`. Vertical scrolling is the parent's job: the lanes are laid
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

      <View style={styles.content}>
        <Ruler
          scrollX={scrollX}
          zoom={zoom}
          totalFrames={totalFrames}
          fps={fps}
          height={rulerHeight}
          targetSpacingPx={rulerTargetSpacingPx}
        />
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height }}
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
        <Playhead scrollX={scrollX} zoom={zoom} />
      </View>
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
