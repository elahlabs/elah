import { memo, useCallback, useMemo, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { selectionStore } from '@elah/core/engine'
import { useSelectionStore, useTimelineEngine, useTracksStore } from '@elah/react'
import { applyEngineCommand, defaultCommandTargets } from '../model/commands'
import { deleteSelectionCommand } from '../model/selection'
import { snapshotFromStores } from '../model/snapshot'
import type { TimelineRef } from './Timeline'
import { timelineColors } from './colors'

export interface TimelineToolbarProps {
  /** The <Timeline> ref; when given, a Fit button calls `fitToWindow()`. */
  timelineRef?: RefObject<TimelineRef | null>
  style?: StyleProp<ViewStyle>
}

interface ToolbarButtonProps {
  label: string
  onPress: () => void
  disabled?: boolean
}

const ToolbarButton = memo(function ToolbarButton({ label, onPress, disabled = false }: ToolbarButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
    </Pressable>
  )
})

/**
 * A row of small edit buttons for the mobile timeline: Delete, Undo, Redo and,
 * when `timelineRef` is given, Fit. Every press goes through
 * `applyEngineCommand`. Delete is one `removeClips` command, so a multi-clip
 * delete is one undo step, and it clears the selection afterwards.
 */
export const TimelineToolbar = memo(function TimelineToolbar({ timelineRef, style }: TimelineToolbarProps) {
  const engine = useTimelineEngine()
  const targets = useMemo(() => defaultCommandTargets(engine), [engine])
  const noneSelected = useSelectionStore((s) => s.selectedClipIds.size === 0)
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)

  const onDelete = useCallback(() => {
    const cmd = deleteSelectionCommand(snapshotFromStores(), selectionStore.getState().selectedClipIds)
    if (!cmd) return
    applyEngineCommand(targets, cmd)
    applyEngineCommand(targets, { type: 'clearSelection' })
  }, [targets])
  const onUndo = useCallback(() => applyEngineCommand(targets, { type: 'undo' }), [targets])
  const onRedo = useCallback(() => applyEngineCommand(targets, { type: 'redo' }), [targets])
  const onFit = useCallback(() => timelineRef?.current?.fitToWindow(), [timelineRef])

  return (
    <View style={[styles.root, style]}>
      <ToolbarButton label="Delete" onPress={onDelete} disabled={noneSelected} />
      <ToolbarButton label="Undo" onPress={onUndo} disabled={!canUndo} />
      <ToolbarButton label="Redo" onPress={onRedo} disabled={!canRedo} />
      {timelineRef && <ToolbarButton label="Fit" onPress={onFit} />}
    </View>
  )
})

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: timelineColors.toolbarBackground,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: timelineColors.buttonBackground,
  },
  buttonText: {
    color: timelineColors.buttonText,
    fontSize: 12,
    fontWeight: '500',
  },
  buttonTextDisabled: {
    color: timelineColors.buttonTextDisabled,
  },
})
