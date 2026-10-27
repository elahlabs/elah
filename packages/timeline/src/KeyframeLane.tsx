import { useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  channelKeys,
  keyDragRange,
  keyFrameSwatches,
  keyFrameUnion,
  keySnapFrames,
  moveKeysAtFrames,
  snapFrame,
  type AnyKeyframeChannel,
  type Clip,
} from '@elah/core'
import { usePlaybackStore } from '@elah/react'
import { useTimeline } from './engine-context'
import { useKeySelectionStore } from './keySelection.store'

/**
 * `<KeyframeLane>` — the diamonds along the bottom of a selected clip.
 *
 * Keyframes were fully modelled, resolved and exported before this existed, but
 * completely invisible: the only way to see one was to scrub to its frame and
 * read a number in the properties panel. This is the strip that makes them an
 * object you can find, seek to, retime and delete.
 *
 * It renders INSIDE `ClipBlock` rather than as a lane-level sibling (the way
 * `TransitionChip` does), for three reasons:
 *   - `Keyframe.frame` is clip-relative, so `left = frame * zoom` needs no
 *     `startFrame` arithmetic and stays correct when the clip moves.
 *   - `ClipBlock` mutates its own `style.transform` / `left` / `width` during a
 *     drag or trim without re-rendering. Children ride that for free; a sibling
 *     would detach from the clip for the whole gesture.
 *   - The block's `overflow: hidden` is exactly the wanted behaviour for keys a
 *     left-edge trim pushed outside the clip — they are kept in the document
 *     (that is what makes a trim reversible) but must not draw beyond the clip.
 *
 * A diamond is an object (PV-T7-3): a click selects it and seeks, Shift+click
 * adds to the selection, and a drag moves **every** selected key together.
 */

/** Diamond edge length in px. */
const DIAMOND_PX = 9
/** Strip height; the diamond needs room plus a little hit padding. */
export const KEYFRAME_LANE_HEIGHT = 14
/** Below this gap between two adjacent keys, markers fold into one cluster marker. */
const MIN_GAP_PX = 5
/** Pointer travel before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 3
/** Snap radius in px, matching the clip body's own snapping feel. */
const SNAP_RADIUS_PX = 5

interface Gesture {
  /** The key under the pointer at gesture start — never re-read after. */
  grabbedFrame: number
  /** The clip as it was at gesture start; every move is computed against it. */
  clip: Clip
  /** The frames being moved, resolved once so a toggle mid-drag cannot change it. */
  frames: number[]
  startClientX: number
  /** The last shift that produced a real preview, so a refused one does not stick. */
  lastDelta: number
  moved: boolean
  snapPoints: number[]
}

export interface KeyframeLaneProps {
  clip: Clip
  /** Pixels per frame. */
  zoom: number
  /** A locked track can still be navigated, but not edited. */
  locked?: boolean
  /**
   * Show only these channels' keys. Omitted, the lane shows the union of every
   * channel the clip keys on, which is what a clip-level strip wants; a typed
   * lane (PV-P5c) passes the one channel it owns.
   */
  channels?: ReadonlyArray<AnyKeyframeChannel>
}

export function KeyframeLane({ clip, zoom, locked, channels }: KeyframeLaneProps) {
  const engine = useTimeline()
  const snapEnabled = usePlaybackStore((s) => s.snapEnabled)
  const gestureRef = useRef<Gesture | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const selectedClipId = useKeySelectionStore((s) => s.clipId)
  const selectedFrames = useKeySelectionStore((s) => s.frames)
  const selectKeys = useKeySelectionStore((s) => s.select)
  const toggleKey = useKeySelectionStore((s) => s.toggle)
  const shiftKeys = useKeySelectionStore((s) => s.shift)
  const clearKeys = useKeySelectionStore((s) => s.clear)

  const frames = useMemo(() => {
    if (!channels || channels.length === 0) return keyFrameUnion(clip)
    const all = new Set<number>()
    for (const channel of channels) {
      for (const key of channelKeys(clip, channel)) all.add(key.frame)
    }
    return [...all].sort((a, b) => a - b)
  }, [clip, channels])

  // PV-P5c-2: frame -> the CSS colour of the first colour key on it, for a
  // clip keyed on `color`/`shape.fill`/`shape.stroke`/an `fx.*` colour param.
  const swatches = useMemo(() => keyFrameSwatches(clip), [clip])

  const selected = selectedClipId === clip.id ? selectedFrames : EMPTY
  const isSelected = (frame: number) => selected.has(frame)

  const endGesture = useCallback(
    (commit: boolean) => {
      const g = gestureRef.current
      gestureRef.current = null
      cleanupRef.current?.()
      cleanupRef.current = null
      if (!g) return
      if (!g.moved) {
        // A press with no travel is a click: it selected on the way in, and it
        // seeks here. Escape must not leave the playhead somewhere else.
        usePlaybackStore.getState().setCurrentFrame(g.clip.startFrame + g.grabbedFrame)
        return
      }
      if (commit && g.lastDelta !== 0) {
        engine.commitInteraction('Move keyframes')
        // The keys are now on different frames; follow them so a second drag
        // moves the same set.
        shiftKeys(g.lastDelta)
      } else {
        engine.cancelInteraction()
        if (!commit) clearKeys()
      }
    },
    [engine, shiftKeys, clearKeys],
  )

  const beginDrag = useCallback(
    (e: ReactPointerEvent, frame: number) => {
      // Without this the clip body's own pointerdown starts a clip drag.
      e.stopPropagation()

      const store = useKeySelectionStore.getState()
      const already = store.clipId === clip.id && store.frames.has(frame)
      if (e.shiftKey) {
        // Shift always toggles, whether or not the key was already in, which is
        // what makes Shift+click able to take a key back out.
        toggleKey(clip.id, frame)
      } else if (!already) {
        // A plain click on an unselected key selects it alone, the way every
        // editor behaves: a drag never silently picks up the rest of a
        // selection. A plain click on an already-selected key keeps the
        // selection, so the whole set can be dragged.
        selectKeys(clip.id, [frame])
      }

      if (locked) return
      // What this gesture moves: the selection as it stands *after* the click
      // above, resolved once so nothing mid-drag can change it.
      const after = useKeySelectionStore.getState()
      const moving = after.clipId === clip.id && after.frames.size > 0 ? [...after.frames] : [frame]
      const playheadLocal = usePlaybackStore.getState().currentFrame - clip.startFrame
      gestureRef.current = {
        grabbedFrame: frame,
        clip,
        frames: moving,
        startClientX: e.clientX,
        lastDelta: 0,
        moved: false,
        // Snap targets exclude the moving keys themselves, so a selection cannot
        // snap to where it is already going.
        snapPoints: keySnapFrames(clip, frame, playheadLocal).filter((f) => !moving.includes(f)),
      }

      const onMove = (ev: PointerEvent) => {
        const g = gestureRef.current
        if (!g) return
        const dx = ev.clientX - g.startClientX
        if (!g.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
        g.moved = true

        // The GRABBED key is what the pointer aims, snapped to the nearest
        // target, and the rest of the selection follows by the same delta.
        let grabbed = g.grabbedFrame + Math.round(dx / zoom)
        if (snapEnabled) {
          grabbed = snapFrame(grabbed, g.snapPoints, Math.max(1, Math.round(SNAP_RADIUS_PX / zoom)))
        }
        let delta = grabbed - g.grabbedFrame
        // Clamp after snapping: a snap point can sit outside the legal range
        // (the clip's far end, say) and must not be allowed to cross a key.
        //
        // A lone key keeps `keyDragRange`, so it still stops one frame short of
        // a neighbour rather than jumping it - the behaviour the lane has always
        // had, and the one the existing test pins. A *set* moves as a block and
        // is bounded only by the clip, because selecting several keys and moving
        // them together is an explicit "shift these" gesture.
        const range = g.frames.length === 1 ? keyDragRange(g.clip, g.frames[0]!) : blockRange(g.clip, g.frames)
        delta = Math.max(range.min - g.grabbedFrame, Math.min(range.max - g.grabbedFrame, delta))
        if (delta === g.lastDelta) return
        // Always computed against the GESTURE-START clip, so the keys do not
        // chase themselves as the preview mutates the project under us. An empty
        // patch means a collision, and then the last good preview stands.
        const patch = moveKeysAtFrames(g.clip, g.frames, delta)
        if (Object.keys(patch).length === 0) return
        g.lastDelta = delta
        engine.previewClip(g.clip.id, g.clip.trackId, patch)
      }
      const onUp = () => endGesture(true)
      const onCancel = () => endGesture(false)
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return
        ev.stopPropagation()
        endGesture(false)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey)
      }
    },
    [clip, zoom, snapEnabled, locked, engine, endGesture, selectKeys, toggleKey],
  )

  if (frames.length === 0) return null

  // At a far-out zoom keys land on the same few pixels. Rather than hide the
  // whole lane, thin it: walk left to right and fold every key closer than
  // MIN_GAP_PX to the previous marker into that marker. A folded marker is a
  // cluster: a click seeks to its first key, but it is not draggable (a drag
  // would move keys the user cannot see); zooming in splits it again.
  const clusters = clusterFrames(frames, zoom)

  const lastFrame = Math.max(0, clip.durationFrames - 1)
  // Hold keys (EDX-P6) draw as squares, the AE/Resolve convention for a step.
  const held = new Set<number>()
  for (const track of Object.values(clip.keyframes?.channels ?? {})) {
    for (const k of track?.keys ?? []) if (k.hold) held.add(Math.floor(k.frame))
  }

  return (
    <div
      data-keyframe-lane
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: KEYFRAME_LANE_HEIGHT,
        // Above the label (zIndex 1) and the trim handles (zIndex 2), so a key
        // sitting on frame 0 is grabbable while the clip is selected.
        zIndex: 3,
        pointerEvents: 'none',
        background: 'var(--elah-keyframe-lane-bg, rgba(0,0,0,0.22))',
      }}
    >
      {clusters.map(({ frame, count, last }) => {
        // Keys outside the clip are real — a left trim pushes them there and a
        // reverse trim brings them back — but they have nowhere to draw, so
        // they are pinned to the edge and are not draggable.
        const outside = frame < 0 || frame > lastFrame
        const drawFrame = Math.min(lastFrame, Math.max(0, frame))
        const isSel = !outside && isSelected(frame)
        const cluster = count > 1
        return (
          <div
            key={frame}
            data-keyframe-marker={frame}
            data-keyframe-cluster={cluster ? count : undefined}
            data-keyframe-selected={isSel ? 'true' : undefined}
            onPointerDown={
              outside
                ? undefined
                : cluster
                  ? (e) => {
                      e.stopPropagation()
                      selectKeys(clip.id, [frame])
                      usePlaybackStore.getState().setCurrentFrame(clip.startFrame + frame)
                    }
                  : (e) => beginDrag(e, frame)
            }
            title={
              outside
                ? `Keyframe at ${frame} (outside the trim)`
                : cluster
                  ? `${count} keyframes, frames ${frame} to ${last}: zoom in to edit them one by one`
                  : `${held.has(frame) ? 'Hold keyframe' : 'Keyframe'} at frame ${frame}${isSel ? ' (selected)' : ''}`
            }
            style={{
              position: 'absolute',
              left: drawFrame * zoom,
              bottom: (KEYFRAME_LANE_HEIGHT - DIAMOND_PX) / 2,
              width: DIAMOND_PX,
              height: DIAMOND_PX,
              marginLeft: -DIAMOND_PX / 2,
              transform: held.has(frame) ? undefined : 'rotate(45deg)',
              // PV-P5c-2: a colour-keyed frame swatches to its authored
              // colour; selection stays visible through the BORDER (below)
              // rather than overriding the fill, so a coloured swatch does
              // not just turn into a plain accent square when selected.
              background:
                swatches.get(frame) ??
                (isSel
                  ? 'var(--elah-accent)'
                  : outside
                    ? 'var(--elah-keyframe-outside, #8a8f98)'
                    : 'var(--elah-keyframe-color, #ffffff)'),
              border: `1px solid ${isSel ? 'var(--elah-accent-text)' : 'var(--elah-keyframe-border, rgba(0,0,0,0.55))'}`,
              borderRadius: 1,
              opacity: outside ? 0.45 : cluster ? 0.7 : 1,
              cursor: outside || locked ? 'default' : cluster ? 'pointer' : 'ew-resize',
              pointerEvents: outside ? 'none' : 'auto',
              touchAction: 'none',
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * The frames a set of keys may collectively occupy: the whole clip, since a
 * block shift is bounded only by the clip's ends.
 */
function blockRange(clip: Clip, frames: ReadonlyArray<number>): { min: number; max: number } {
  return { min: Math.min(...frames), max: Math.max(0, clip.durationFrames - 1) }
}

/**
 * Thin sorted key frames so no two markers sit closer than MIN_GAP_PX: each key
 * closer than that to the previous kept marker folds into it. Returns one entry
 * per marker with how many keys it stands for and the last frame it covers.
 */
export function clusterFrames(
  frames: ReadonlyArray<number>,
  zoom: number,
): Array<{ frame: number; count: number; last: number }> {
  const out: Array<{ frame: number; count: number; last: number }> = []
  for (const frame of frames) {
    const prev = out[out.length - 1]
    if (prev && (frame - prev.frame) * zoom < MIN_GAP_PX) {
      prev.count += 1
      prev.last = frame
    } else {
      out.push({ frame, count: 1, last: frame })
    }
  }
  return out
}

/** A stable empty set, so a clip with no key selection does not re-render. */
const EMPTY: ReadonlySet<number> = new Set<number>()
