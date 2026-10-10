import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { Clip } from '@elah/core'
import { useSelectionStore } from '@elah/react'
import { clipRect } from '../model/layout'
import type { LaneSlot } from '../model/types'
import { timelineColors } from './colors'

export interface ClipBlockProps {
  clip: Clip
  lane: LaneSlot
  /** Pixels per frame. */
  zoom: number
}

/**
 * One clip on its lane, in lane-content space. Static in RN-T4: move and trim
 * gestures attach here in RN-T6 / RN-T7, selection taps in RN-T9.
 *
 * Memoised, and nothing it reads changes while the lanes scroll (the offset is
 * a shared value, never React state), so scrolling re-renders no block.
 */
export const ClipBlock = memo(function ClipBlock({ clip, lane, zoom }: ClipBlockProps) {
  const selected = useSelectionStore((s) => s.selectedClipIds.has(clip.id))
  const rect = clipRect(clip, zoom, lane)
  const colors = timelineColors.clip[clip.type]
  const end = clip.startFrame + clip.durationFrames

  return (
    <View
      accessibilityLabel={`${clip.name}, frames ${clip.startFrame} to ${end}${lane.locked ? ', locked' : ''}`}
      style={[
        styles.block,
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height, backgroundColor: colors.body, borderLeftColor: colors.accent },
        selected && styles.selected,
      ]}
    >
      <Text numberOfLines={1} style={styles.label}>
        {clip.name} · {clip.startFrame}–{end}
      </Text>
      {lane.locked && <Text style={styles.lock}>🔒</Text>}
    </View>
  )
})

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 4,
    borderLeftWidth: 3,
    paddingHorizontal: 4,
  },
  selected: {
    borderWidth: 2,
    borderLeftWidth: 3,
    borderColor: timelineColors.selection,
  },
  label: {
    flexShrink: 1,
    color: timelineColors.textOnClip,
    fontSize: 11,
    fontWeight: '500',
  },
  lock: {
    marginLeft: 'auto',
    fontSize: 10,
  },
})
