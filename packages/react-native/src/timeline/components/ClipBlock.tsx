import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { Clip } from '@elah/core'
import { framesToTimecode, tracksStore } from '@elah/core/engine'
import { useSelectionStore, useTimelineEngine } from '@elah/react'
import { applyEngineCommand, defaultCommandTargets } from '../model/commands'
import { beginMove, endMove, updateMove, type MovePreview, type MoveSession } from '../model/moveGesture'
import { clipRect } from '../model/layout'
import {
  beginTrim,
  endTrim,
  trimPreviewRect,
  updateTrim,
  type TrimEdge,
  type TrimPreview,
  type TrimSession,
} from '../model/trimGesture'
import { findClipInSnapshot, snapshotFromStores } from '../model/snapshot'
import type { LaneSlot } from '../model/types'
import { timelineColors } from './colors'

/** How long a finger must rest on a clip before it picks the clip up. Shorter moves scroll the lanes. */
const LONG_PRESS_MS = 300
/** Snap tolerance for a finger, px. The DOM timeline uses 5; a fingertip is wider. */
const TOUCH_SNAP_TOLERANCE_PX = 12
/** Distance of the timecode bubble from the block's top (or bottom) edge, px. */
const BUBBLE_OFFSET = 20
/** Touch width of an edge handle, px. Centred on the block's edge, so half of it sits outside the block. */
const HANDLE_HIT_WIDTH_PX = 24
/** Width of the visible bar inside a handle, px. */
const HANDLE_BAR_WIDTH_PX = 6
/** Horizontal travel before a handle drag starts, px. Keeps a tap on a handle a tap. */
const HANDLE_ACTIVE_OFFSET_PX = 4

/** The timecode bubble is a read-only TextInput so its text can be driven by a shared value. */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

export interface ClipBlockProps {
  clip: Clip
  lane: LaneSlot
  /** Pixels per frame. */
  zoom: number
}

/**
 * One clip on its lane, in lane-content space.
 *
 * RN-T6: long-press a clip, then drag to move it, to another lane when the
 * clip's type is allowed there. A plain swipe that starts moving before the
 * long press completes fails the gesture, so the lanes still scroll. The
 * move's meaning (snapping, lane choice, overlap settling) lives in the model
 * (`beginMove` / `updateMove` / `endMove`); this component only recognises the
 * gesture and shows it.
 *
 * RN-T9: tap a clip to select it (`selectClip`). Picking a clip up with the
 * long press also selects it, so a locked clip is selectable even though it
 * cannot be dragged. The tap and the pan are combined with `Gesture.Exclusive`:
 * the pan wins, and a quick tap fails the long-press pan, which lets the tap fire.
 *
 * RN-T7: a selected clip shows two edge handles (not on a locked lane). Drag
 * one to trim that edge. The model (`beginTrim` / `updateTrim`) clamps to the
 * source, the speed and the neighbours during the drag, so the block never
 * shows a position the engine would refuse, and release never jumps. One
 * `trimClip` command is made on release (`endTrim`, in `onEnd`). The bubble
 * shows the new duration while trimming.
 *
 * Callbacks run on the JS thread (`runOnJS(true)`) because the model is plain
 * JS. During a drag only shared values change: the block's transform, its
 * width, its lift, and the timecode bubble's text. React does not re-render per
 * move. The release makes exactly one engine command (`applyEngineCommand`, in
 * `onEnd`), and the block then re-renders at its new place and the offset is reset.
 * Selection changes go through `applyEngineCommand` too.
 *
 * Memoised, and nothing it reads changes while the lanes scroll (the offset is
 * a shared value, never React state), so scrolling re-renders no block.
 */
export const ClipBlock = memo(function ClipBlock({ clip, lane, zoom }: ClipBlockProps) {
  const engine = useTimelineEngine()
  const targets = useMemo(() => defaultCommandTargets(engine), [engine])
  const fps = useMemo(() => engine.getProject().fps, [engine])
  const selected = useSelectionStore((s) => s.selectedClipIds.has(clip.id))
  const rect = clipRect(clip, zoom, lane)
  const colors = timelineColors.clip[clip.type]
  const end = clip.startFrame + clip.durationFrames

  // Per-block drag state, on the UI thread. Idle: all zero.
  const dx = useSharedValue(0)
  const dy = useSharedValue(0)
  // Trim preview: the left edge's shift, and the new width (0 = use the resting width).
  const trimDx = useSharedValue(0)
  const trimWidth = useSharedValue(0)
  const dragging = useSharedValue(0)
  const bubbleText = useSharedValue('')

  // Gesture bookkeeping, JS side. Refs, not state: nothing here re-renders.
  const session = useRef<MoveSession | null>(null)
  const preview = useRef<MovePreview | null>(null)
  const startY = useRef(0)
  // Trim bookkeeping, kept apart from the move's.
  const trimSession = useRef<TrimSession | null>(null)
  const trimPreview = useRef<TrimPreview | null>(null)
  // Set when a move or a trim was committed; the block resets once it re-renders at the new place.
  const pendingReset = useRef(false)

  const reset = useCallback(() => {
    dx.value = 0
    dy.value = 0
    trimDx.value = 0
    trimWidth.value = 0
    dragging.value = 0
  }, [dx, dy, trimDx, trimWidth, dragging])

  // The re-render after a committed move or trim has put the block at its new place,
  // so the offset can go. Resetting earlier would flash the block back.
  useLayoutEffect(() => {
    if (pendingReset.current) {
      pendingReset.current = false
      reset()
    }
  }, [clip.startFrame, clip.durationFrames, lane.top, lane.trackId, reset])

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart((e) => {
        // Picking a clip up selects it, even when it is locked and cannot move.
        applyEngineCommand(targets, { type: 'selectClip', clipId: clip.id })
        const s = beginMove(clip.id, snapshotFromStores(), { snapTolerancePx: TOUCH_SNAP_TOLERANCE_PX })
        session.current = s
        if (!s) return
        // `e.y` is relative to the block, which is untransformed at the start.
        startY.current = clipRect(clip, zoom, lane).y + e.y
        dragging.value = 1
        const p = updateMove(s, { translationX: 0, pointerY: startY.current })
        preview.current = p
        bubbleText.value = framesToTimecode(p.startFrame, fps)
      })
      .onUpdate((e) => {
        const s = session.current
        if (!s) return
        const p = updateMove(s, {
          translationX: e.translationX,
          pointerY: startY.current + e.translationY,
        })
        const prev = preview.current
        preview.current = p
        dx.value = p.dx
        dy.value = p.dy
        if (!prev || prev.startFrame !== p.startFrame) {
          bubbleText.value = framesToTimecode(p.startFrame, fps)
        }
      })
      .onEnd((_e, success) => {
        const s = session.current
        const p = preview.current
        if (!success || !s || !p) {
          reset()
          return
        }
        const cmd = endMove(s, p, snapshotFromStores())
        if (cmd) applyEngineCommand(targets, cmd)

        const after = findClipInSnapshot(tracksStore.getState(), s.clip.id)
        const moved =
          after !== null && (after.trackId !== s.originTrackId || after.clip.startFrame !== s.clip.startFrame)
        if (moved) {
          pendingReset.current = true
        } else {
          // Nothing changed, or the engine rejected the move: nothing will re-render.
          reset()
        }
      })
      .onFinalize(() => {
        // A cancelled gesture never reaches onEnd. A committed move keeps its offset until the re-render.
        // While a handle trim is in flight, the block's pan can still finalize as a failed gesture; it must not reset the trim.
        if (!pendingReset.current && !trimSession.current) reset()
        session.current = null
        preview.current = null
      })

    // A quick tap fails the long-press pan, so the tap fires. A long press or a move wins the pan.
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) applyEngineCommand(targets, { type: 'selectClip', clipId: clip.id })
      })

    return Gesture.Exclusive(pan, tap)
  }, [clip, lane, zoom, targets, fps, dx, dy, dragging, bubbleText, reset])

  // One pan per edge handle. Built together with the same factory, so the two stay in step.
  const trimGestures = useMemo(() => {
    const makeTrimGesture = (edge: TrimEdge) =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-HANDLE_ACTIVE_OFFSET_PX, HANDLE_ACTIVE_OFFSET_PX])
        .onStart(() => {
          const s = beginTrim(clip.id, edge, snapshotFromStores(), { handleWidthPx: HANDLE_HIT_WIDTH_PX })
          trimSession.current = s
          trimPreview.current = null
          if (!s) return
          dragging.value = 1
          bubbleText.value = framesToTimecode(s.clip.durationFrames, fps)
        })
        .onUpdate((e) => {
          const s = trimSession.current
          if (!s) return
          const prev = trimPreview.current
          const p = updateTrim(s, e.translationX)
          trimPreview.current = p
          const { dx: shift, width } = trimPreviewRect(s, p)
          trimDx.value = shift
          trimWidth.value = width
          if (!prev || prev.durationFrames !== p.durationFrames) {
            bubbleText.value = framesToTimecode(p.durationFrames, fps)
          }
        })
        .onEnd((_e, success) => {
          const s = trimSession.current
          const p = trimPreview.current
          if (success && s && p) {
            const cmd = endTrim(s, p)
            if (cmd) applyEngineCommand(targets, cmd)
          }

          const after = s ? findClipInSnapshot(tracksStore.getState(), s.clip.id) : null
          const trimmed =
            s !== null &&
            after !== null &&
            (after.clip.startFrame !== s.clip.startFrame || after.clip.durationFrames !== s.clip.durationFrames)
          if (trimmed) {
            pendingReset.current = true
          } else {
            // Cancelled, rejected, or nothing changed: nothing will re-render.
            reset()
          }
        })
        .onFinalize(() => {
          if (!pendingReset.current) reset()
          trimSession.current = null
          trimPreview.current = null
        })

    return { left: makeTrimGesture('left'), right: makeTrimGesture('right') }
  }, [clip.id, fps, targets, dragging, bubbleText, trimDx, trimWidth, reset])

  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value + trimDx.value }, { translateY: dy.value }],
    width: trimWidth.value > 0 ? trimWidth.value : rect.width,
    zIndex: dragging.value ? 10 : 0,
    elevation: dragging.value ? 10 : 0,
    opacity: dragging.value ? 0.9 : 1,
  }))

  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: dragging.value,
  }))

  const bubbleProps = useAnimatedProps(() => ({ text: bubbleText.value } as any))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityLabel={`${clip.name}, frames ${clip.startFrame} to ${end}${lane.locked ? ', locked' : ''}`}
        style={[
          styles.block,
          { left: rect.x, top: rect.y, width: rect.width, height: rect.height, backgroundColor: colors.body, borderLeftColor: colors.accent },
          selected && styles.selected,
          blockStyle,
        ]}
      >
        <View style={styles.content}>
          <Text numberOfLines={1} style={styles.label}>
            {clip.name} · {clip.startFrame}–{end}
          </Text>
          {lane.locked && <Text style={styles.lock}>🔒</Text>}
        </View>
        {selected && !lane.locked && (
          <>
            <GestureDetector gesture={trimGestures.left}>
              <View accessibilityLabel="Trim start" style={[styles.handle, styles.handleLeft]}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={trimGestures.right}>
              <View accessibilityLabel="Trim end" style={[styles.handle, styles.handleRight]}>
                <View style={styles.handleBar} />
              </View>
            </GestureDetector>
          </>
        )}
        <AnimatedTextInput
          editable={false}
          pointerEvents="none"
          defaultValue={framesToTimecode(clip.startFrame, fps)}
          animatedProps={bubbleProps}
          // Above the block, except on the first lane, where the lanes viewport would clip it.
          style={[styles.bubble, lane.top >= BUBBLE_OFFSET ? { top: -BUBBLE_OFFSET } : { bottom: -BUBBLE_OFFSET }, bubbleStyle]}
        />
      </Animated.View>
    </GestureDetector>
  )
})

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
    borderRadius: 4,
    borderLeftWidth: 3,
    paddingHorizontal: 4,
  },
  selected: {
    borderWidth: 2,
    borderLeftWidth: 3,
    borderColor: timelineColors.selection,
  },
  /** Clips the label and the lock badge to the block; the bubble sits outside it. */
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 3,
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
  /** Edge trim handle: a finger-sized hit area centred on the block's edge, with the visible bar inside. */
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_HIT_WIDTH_PX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLeft: {
    left: -HANDLE_HIT_WIDTH_PX / 2,
  },
  handleRight: {
    right: -HANDLE_HIT_WIDTH_PX / 2,
  },
  handleBar: {
    width: HANDLE_BAR_WIDTH_PX,
    height: '60%',
    borderRadius: HANDLE_BAR_WIDTH_PX / 2,
    backgroundColor: timelineColors.trimHandle,
  },
  /** Timecode bubble above the block while it is being dragged. */
  bubble: {
    position: 'absolute',
    left: 0,
    height: 18,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderRadius: 3,
    backgroundColor: timelineColors.labelBackground,
    color: timelineColors.text,
    fontSize: 10,
    fontWeight: '500',
  },
})
