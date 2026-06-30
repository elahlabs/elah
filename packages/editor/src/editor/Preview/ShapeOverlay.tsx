import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Transform, ActiveShapeClip } from '@elah/core'
import {
  useTimelineEngine,
  useSelectionStore,
  usePlaybackStore,
  computeContainViewport,
} from '@elah/core'
import { useResolvedScene } from '../useResolvedScene'

/**
 * `<ShapeOverlay>` — the interactive transform surface for shape clips
 * (rect / circle / triangle). The counterpart of `<TextOverlay>` and
 * `<MediaTransformOverlay>`, but for synthetic shapes: click to select, drag to
 * reposition, corner-drag to scale (uniform). The WebGL canvas still does the
 * rendering (via the GPU ShapeLayer); this overlay only handles interaction and
 * writes the result back to the engine as a `transform`, so there is one
 * renderer and one source of truth.
 *
 * Geometry mirrors ShapeLayer exactly so the selection box hugs the painted
 * shape: the shape is drawn into a centred square whose side is
 * `scale * min(stageW, stageH)`, centred at the normalized transform (x, y).
 * Defaults (no transform) match ShapeLayer: centre (0.5, 0.5), scale 0.5.
 */

/** Default normalized centre + scale, matching ShapeLayer's render defaults. */
const DEFAULT_SCALE = 0.5
const DEFAULT_CENTER = 0.5
/** Minimum on-screen hit/handle box so tiny shapes stay grabbable. */
const MIN_BOX_PX = 28
/** Uniform scale bounds (fraction of the stage's short side). */
const MIN_SCALE = 0.05
const MAX_SCALE = 4

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

function baseTransform(t: Transform | undefined): Transform {
  return {
    x: t?.x ?? DEFAULT_CENTER,
    y: t?.y ?? DEFAULT_CENTER,
    scale: t?.scale ?? DEFAULT_SCALE,
    rotation: t?.rotation ?? 0,
    anchor: t?.anchor ?? { x: 0.5, y: 0.5 },
  }
}

interface ShapeItem {
  clip: ActiveShapeClip
  /** Screen-space selection box. */
  rect: { left: number; top: number; width: number; height: number }
  /** Screen-space centre of the shape (scale pivot). */
  centerScreenX: number
  centerScreenY: number
}

interface Gesture {
  type: 'move' | 'resize'
  id: string
  trackId: string
  /** Explicit transform at gesture start (clip's own, or the synthesized default). */
  base: Transform
  stageW: number
  stageH: number
  // move
  startClientX: number
  startClientY: number
  // resize
  centerClientX: number
  centerClientY: number
  startDist: number
}

export function ShapeOverlay() {
  const engine = useTimelineEngine()
  const scene = useResolvedScene()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const selectClip = useSelectionStore((s) => s.selectClip)
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const gestureRef = useRef<Gesture | null>(null)

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

  // Resolve each shape clip's on-screen box. The shape lives in a centred square
  // of side `scale * shortSide` in stage space — same as ShapeLayer paints.
  const items = useMemo<ShapeItem[]>(() => {
    if (fit.width <= 0) return []
    const shortSide = Math.min(stage.width, stage.height)
    return scene.shapes.map((clip) => {
      const t = baseTransform(clip.transform)
      const sideStage = t.scale * shortSide
      const cxStage = t.x * stage.width
      const cyStage = t.y * stage.height

      const centerScreenX = fit.x + cxStage * scale
      const centerScreenY = fit.y + cyStage * scale
      const rawSide = sideStage * scale
      const w = Math.max(rawSide, MIN_BOX_PX)
      const h = Math.max(rawSide, MIN_BOX_PX)
      const left = centerScreenX - w / 2
      const top = centerScreenY - h / 2

      return {
        clip,
        rect: { left, top, width: w, height: h },
        centerScreenX,
        centerScreenY,
      }
    })
  }, [scene.shapes, stage.width, stage.height, fit, scale])

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
        const x = clamp01(g.base.x + dx / g.stageW)
        const y = clamp01(g.base.y + dy / g.stageH)
        engine.previewClip(g.id, g.trackId, { transform: { ...g.base, x, y } })
      } else {
        const dist = Math.hypot(e.clientX - g.centerClientX, e.clientY - g.centerClientY)
        const ratio = g.startDist > 0 ? dist / g.startDist : 1
        const next = clamp(g.base.scale * ratio, MIN_SCALE, MAX_SCALE)
        engine.previewClip(g.id, g.trackId, { transform: { ...g.base, scale: next } })
      }
    },
    [engine, scale],
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
      engine.commitInteraction(g.type === 'move' ? 'Move shape' : 'Resize shape')
    },
    [engine],
  )

  const beginMove = useCallback(
    (e: ReactPointerEvent, item: ShapeItem) => {
      e.stopPropagation()
      if (!selectedClipIds.has(item.clip.id)) selectClip(item.clip.id)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      gestureRef.current = {
        type: 'move',
        id: item.clip.id,
        trackId: item.clip.trackId,
        base: baseTransform(item.clip.transform),
        stageW: stage.width,
        stageH: stage.height,
        startClientX: e.clientX,
        startClientY: e.clientY,
        centerClientX: 0,
        centerClientY: 0,
        startDist: 0,
      }
    },
    [selectedClipIds, selectClip, stage.width, stage.height],
  )

  const beginResize = useCallback(
    (e: ReactPointerEvent, item: ShapeItem) => {
      e.stopPropagation()
      if (!selectedClipIds.has(item.clip.id)) selectClip(item.clip.id)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      const rootRect = rootRef.current?.getBoundingClientRect()
      const centerClientX = (rootRect?.left ?? 0) + item.centerScreenX
      const centerClientY = (rootRect?.top ?? 0) + item.centerScreenY
      gestureRef.current = {
        type: 'resize',
        id: item.clip.id,
        trackId: item.clip.trackId,
        base: baseTransform(item.clip.transform),
        stageW: stage.width,
        stageH: stage.height,
        startClientX: e.clientX,
        startClientY: e.clientY,
        centerClientX,
        centerClientY,
        startDist: Math.hypot(e.clientX - centerClientX, e.clientY - centerClientY),
      }
    },
    [selectedClipIds, selectClip, stage.width, stage.height],
  )

  return (
    <div
      ref={rootRef}
      // Click-through by default; only the boxes (and the deselect backdrop while
      // a shape clip is selected) opt back into pointer events. zIndex keeps the
      // overlay above the imperatively-appended WebGL canvas; TextOverlay sits
      // one layer above so text editing wins when they overlap.
      className="absolute inset-0 z-[3] pointer-events-none overflow-hidden"
    >
      {!isPlaying && ownsSelection && (
        <div
          className="absolute inset-0 pointer-events-auto"
          onPointerDown={() => clearSelection()}
        />
      )}

      {!isPlaying &&
        items.map((item) => {
          const { clip, rect } = item
          const selected = selectedClipIds.has(clip.id)
          // Dynamic: position, size, border-color all depend on runtime state.
          const boxStyle: CSSProperties = {
            position: 'absolute',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            boxSizing: 'border-box',
            border: selected
              ? '1px solid var(--elah-selection-color, #4c9aff)'
              : '1px solid transparent',
            borderRadius: 2,
            cursor: 'move',
            pointerEvents: 'auto',
            touchAction: 'none',
          }
          return (
            <div
              key={clip.id}
              style={boxStyle}
              onPointerDown={(e) => beginMove(e, item)}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            >
              {selected &&
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
    </div>
  )
}

const CORNERS = [
  { key: 'nw', pos: { left: -5, top: -5 }, cursor: 'nwse-resize' as const },
  { key: 'ne', pos: { right: -5, top: -5 }, cursor: 'nesw-resize' as const },
  { key: 'sw', pos: { left: -5, bottom: -5 }, cursor: 'nesw-resize' as const },
  { key: 'se', pos: { right: -5, bottom: -5 }, cursor: 'nwse-resize' as const },
] satisfies ReadonlyArray<{ key: string; pos: CSSProperties; cursor: CSSProperties['cursor'] }>
