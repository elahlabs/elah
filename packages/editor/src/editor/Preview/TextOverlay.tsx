import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Transform, ActiveTextClip, TextLayout } from '@elah/core'
import {
  computeTextLayout,
  computeContainViewport,
  useTimelineEngine,
  useSelectionStore,
  usePlaybackStore,
  SIDE_MARGIN,
} from '@elah/core'
import { useResolvedScene } from '../useResolvedScene'

/**
 * `<TextOverlay>` — the interactive editing surface for text clips.
 *
 * It sits as a transparent HTML layer directly over the WebGL canvas and gives
 * text the behaviours a video editor is expected to have: click to select, drag
 * to reposition, corner-drag to resize, double-click to edit inline. The canvas
 * still does the actual *rendering* (via the GPU TextLayer); this overlay only
 * handles interaction and writes results back to the engine, so there is exactly
 * one renderer and one source of truth.
 *
 * Coordinate spaces:
 *   - Stage space: the project's logical pixels (e.g. 1080×1920).
 *   - Screen space: CSS pixels inside this overlay (== the canvas display box).
 * `computeContainViewport` gives the letterboxed rect of the stage within the
 * overlay; everything maps through that single rect so handles stay glued to the
 * glyphs the GPU paints (both use `computeTextLayout`).
 */

const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 4000
/** Minimum on-screen hit/handle box so empty or tiny text stays grabbable. */
const MIN_BOX_PX = 28
/** Visual breathing room around the measured glyph box, in screen px. */
const BOX_PAD = 4

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

function makeTransform(x: number, y: number, base: Transform | undefined): Transform {
  return {
    x,
    y,
    scale: base?.scale ?? 1,
    rotation: base?.rotation ?? 0,
    anchor: base?.anchor ?? { x: 0.5, y: 0.5 },
  }
}

interface Gesture {
  type: 'move' | 'resize'
  id: string
  trackId: string
  // move
  startClientX: number
  startClientY: number
  startCenter: { x: number; y: number }
  startTransform: Transform | undefined
  // resize
  centerClientX: number
  centerClientY: number
  startDist: number
  startFontSize: number
}

export function TextOverlay() {
  const engine = useTimelineEngine()
  const scene = useResolvedScene()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const selectClip = useSelectionStore((s) => s.selectClip)
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // One offscreen 2D context, reused for every measurement. Created lazily so
  // this module stays import-safe in non-DOM environments (tests/SSR).
  const measureRef = useRef<CanvasRenderingContext2D | null>(null)
  const getMeasurer = useCallback((): CanvasRenderingContext2D | null => {
    if (measureRef.current) return measureRef.current
    if (typeof document === 'undefined') return null
    const ctx = document.createElement('canvas').getContext('2d')
    measureRef.current = ctx
    return ctx
  }, [])

  const gestureRef = useRef<Gesture | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Track the overlay's display size (== canvas display size) in CSS pixels.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const apply = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    apply()
    const obs = new ResizeObserver(apply)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const stage = scene.stage
  const fit = useMemo(
    () => computeContainViewport(size.width, size.height, stage.width, stage.height),
    [size.width, size.height, stage.width, stage.height],
  )
  const scale = stage.width > 0 ? fit.width / stage.width : 1

  // Pre-compute each text clip's layout + on-screen rect.
  const items = useMemo(() => {
    const measurer = getMeasurer()
    if (!measurer || fit.width <= 0) return []
    return scene.texts.map((clip) => {
      const layout = computeTextLayout(measurer, clip, stage)
      const centerScreenX = fit.x + layout.center.x * stage.width * scale
      const rawLeft = fit.x + layout.box.x * scale
      const rawW = layout.box.width * scale
      const w = Math.max(rawW, MIN_BOX_PX)
      const left = rawW < MIN_BOX_PX ? centerScreenX - w / 2 : rawLeft
      const h = Math.max(layout.box.height * scale, MIN_BOX_PX)
      const top = fit.y + layout.box.y * scale
      return { clip, layout, centerScreenX, rect: { left, top, width: w, height: h } }
    })
  }, [scene.texts, stage, fit, scale, getMeasurer])

  // True when a *text* clip is the current selection. The deselect backdrop is
  // gated on this (not on selectedClipIds.size) so it doesn't stack with the
  // MediaTransformOverlay's backdrop when a video/image clip is selected.
  const ownsSelection = useMemo(
    () => items.some((it) => selectedClipIds.has(it.clip.id)),
    [items, selectedClipIds],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      if (g.type === 'move') {
        const dx = (e.clientX - g.startClientX) / scale
        const dy = (e.clientY - g.startClientY) / scale
        const nx = clamp01(g.startCenter.x + dx / stage.width)
        const ny = clamp01(g.startCenter.y + dy / stage.height)
        engine.previewClip(g.id, g.trackId, {
          transform: makeTransform(nx, ny, g.startTransform),
        })
      } else {
        const dist = Math.hypot(e.clientX - g.centerClientX, e.clientY - g.centerClientY)
        const ratio = g.startDist > 0 ? dist / g.startDist : 1
        const fontSize = clamp(Math.round(g.startFontSize * ratio), MIN_FONT_SIZE, MAX_FONT_SIZE)
        engine.previewClip(g.id, g.trackId, { fontSize })
      }
    },
    [engine, scale, stage.width, stage.height],
  )

  const endGesture = useCallback(
    (e: ReactPointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      gestureRef.current = null
      const target = e.currentTarget as Element
      if (target.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture(e.pointerId)
      }
      engine.commitInteraction(g.type === 'move' ? 'Move text' : 'Resize text')
    },
    [engine],
  )

  const beginMove = useCallback(
    (e: ReactPointerEvent, clip: ActiveTextClip, layout: TextLayout) => {
      if (editingId === clip.id) return
      e.stopPropagation()
      if (!selectedClipIds.has(clip.id)) selectClip(clip.id)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      gestureRef.current = {
        type: 'move',
        id: clip.id,
        trackId: clip.trackId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCenter: { ...layout.center },
        startTransform: clip.transform,
        centerClientX: 0,
        centerClientY: 0,
        startDist: 0,
        startFontSize: layout.style.fontSize,
      }
    },
    [editingId, selectedClipIds, selectClip],
  )

  const beginResize = useCallback(
    (e: ReactPointerEvent, item: (typeof items)[number]) => {
      e.stopPropagation()
      const { clip, layout, centerScreenX } = item
      if (!selectedClipIds.has(clip.id)) selectClip(clip.id)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      const rootRect = rootRef.current?.getBoundingClientRect()
      const centerScreenY = fit.y + layout.center.y * stage.height * scale
      const centerClientX = (rootRect?.left ?? 0) + centerScreenX
      const centerClientY = (rootRect?.top ?? 0) + centerScreenY
      gestureRef.current = {
        type: 'resize',
        id: clip.id,
        trackId: clip.trackId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCenter: { ...layout.center },
        startTransform: clip.transform,
        centerClientX,
        centerClientY,
        startDist: Math.hypot(e.clientX - centerClientX, e.clientY - centerClientY),
        startFontSize: layout.style.fontSize,
      }
    },
    [selectedClipIds, selectClip, fit.y, stage.height, scale],
  )

  const startEditing = useCallback(
    (clip: ActiveTextClip) => {
      selectClip(clip.id)
      setEditText(clip.content)
      setEditingId(clip.id)
    },
    [selectClip],
  )

  const commitEditing = useCallback(() => {
    // Content was streamed live via previewClip(); fold the session into one
    // undo entry. If nothing changed, commitInteraction() is a no-op.
    engine.commitInteraction('Edit text')
    setEditingId(null)
  }, [engine])

  const cancelEditing = useCallback(() => {
    // Roll the live-streamed content back to the gesture's start snapshot,
    // leaving no history entry.
    engine.cancelInteraction()
    setEditingId(null)
  }, [engine])

  // Leaving play mode / unmount: make sure no half-open gesture lingers.
  useEffect(() => {
    if (isPlaying && editingId) commitEditing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  const editingItem = editingId ? items.find((it) => it.clip.id === editingId) : undefined

  return (
    <div
      ref={rootRef}
      // Click-through by default; only the boxes (and the deselect backdrop when
      // something is active) opt back into pointer events.
      // zIndex keeps the overlay above the imperatively-appended WebGL canvas
      // regardless of DOM insertion order.
      className="absolute inset-0 z-[4] pointer-events-none overflow-hidden"
    >
      {!isPlaying && (ownsSelection || editingId) && (
        <div
          className="absolute inset-0 pointer-events-auto"
          onPointerDown={() => {
            if (editingId) commitEditing()
            clearSelection()
          }}
        />
      )}

      {!isPlaying &&
        items.map((item) => {
          const { clip, layout, rect } = item
          const selected = selectedClipIds.has(clip.id)
          const isEditing = editingId === clip.id
          // Dynamic: position, size, border-color, cursor all depend on runtime state
          const boxStyle: CSSProperties = {
            position: 'absolute',
            left: rect.left - BOX_PAD,
            top: rect.top - BOX_PAD,
            width: rect.width + BOX_PAD * 2,
            height: rect.height + BOX_PAD * 2,
            boxSizing: 'border-box',
            border: selected
              ? '1px solid var(--elah-selection-color, #4c9aff)'
              : '1px solid transparent',
            borderRadius: 2,
            cursor: isEditing ? 'text' : 'move',
            pointerEvents: isEditing ? 'none' : 'auto',
            touchAction: 'none',
          }
          return (
            <div
              key={clip.id}
              style={boxStyle}
              onPointerDown={(e) => beginMove(e, clip, layout)}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onDoubleClick={(e) => {
                e.stopPropagation()
                startEditing(clip)
              }}
            >
              {selected &&
                !isEditing &&
                CORNERS.map((corner) => (
                  <div
                    key={corner.key}
                    onPointerDown={(e) => beginResize(e, item)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                    style={{
                      position: 'absolute',
                      ...corner.pos,
                      width: 10,
                      height: 10,
                      background: 'var(--elah-selection-handle, #fff)',
                      border: '1px solid var(--elah-selection-color, #4c9aff)',
                      borderRadius: 2,
                      cursor: corner.cursor,
                      pointerEvents: 'auto',
                      touchAction: 'none',
                    }}
                  />
                ))}
            </div>
          )
        })}

      {!isPlaying && editingItem && (
        <textarea
          autoFocus
          value={editText}
          onChange={(e) => {
            const next = e.target.value
            setEditText(next)
            const found = engine.findClip(editingItem.clip.id)
            if (found) engine.previewClip(editingItem.clip.id, found.trackId, { content: next })
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commitEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitEditing()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelEditing()
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            // All dynamic: position/size derived from stage rect + scale,
            // font derived from clip's style, caretColor from clip's text color.
            position: 'absolute',
            left: editingItem.centerScreenX - (stage.width * (1 - 2 * SIDE_MARGIN) * scale) / 2,
            top: fit.y + editingItem.layout.box.y * scale,
            width: stage.width * (1 - 2 * SIDE_MARGIN) * scale,
            height: editingItem.layout.box.height * scale,
            // The GPU paints the glyphs live (content streamed via previewClip);
            // keep the textarea text invisible so they don't double up — only the
            // caret/selection chrome shows.
            color: 'transparent',
            caretColor: editingItem.layout.style.color,
            background: 'transparent',
            font: `${editingItem.layout.style.fontWeight} ${editingItem.layout.style.fontSize * scale}px ${editingItem.layout.style.fontFamily}`,
            lineHeight: `${editingItem.layout.lineAdvance * scale}px`,
            textAlign: editingItem.layout.style.textAlign,
            border: '1px solid var(--elah-selection-color, #4c9aff)',
            outline: 'none',
            resize: 'none',
            padding: 0,
            margin: 0,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'auto',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}

const CORNERS = [
  { key: 'nw', pos: { left: -5, top: -5 }, cursor: 'nwse-resize' as const },
  { key: 'ne', pos: { right: -5, top: -5 }, cursor: 'nesw-resize' as const },
  { key: 'sw', pos: { left: -5, bottom: -5 }, cursor: 'nesw-resize' as const },
  { key: 'se', pos: { right: -5, bottom: -5 }, cursor: 'nwse-resize' as const },
] satisfies ReadonlyArray<{ key: string; pos: CSSProperties; cursor: CSSProperties['cursor'] }>
