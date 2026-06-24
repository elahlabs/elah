import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Transform, ActiveImageClip, ActiveVideoClip } from '@elah/core'
import {
  useTimelineEngine,
  useSelectionStore,
  usePlaybackStore,
  useMediaLibraryStore,
  resolveDrawRect,
  transformFromContainRect,
  computeContainViewport,
} from '@elah/core'
import { useResolvedScene } from '../useResolvedScene'

/**
 * `<MediaTransformOverlay>` — the interactive transform surface for video and
 * image clips. The exact counterpart of `<TextOverlay>`, but for raster media:
 * click to select, drag to reposition, corner-drag to scale (uniform). The WebGL
 * canvas still does the rendering; this overlay only handles interaction and
 * writes the result back to the engine as a `transform`, so there is one renderer
 * and one source of truth — and because both the GPU renderer and the export
 * worker already resolve placement through `resolveDrawRect(transform, …)`, the
 * edits made here are honoured identically in preview and export with no extra
 * wiring.
 *
 * Coordinate spaces (identical to TextOverlay):
 *   - Stage space: the project's logical pixels (e.g. 1080×1920).
 *   - Screen space: CSS pixels inside this overlay (== the canvas display box).
 * `computeContainViewport` gives the letterboxed rect of the stage within the
 * overlay; the clip's stage-space draw rect (`resolveDrawRect`) maps through it.
 *
 * Two things differ from text and are worth calling out:
 *   1. The selection box needs the media's *content size* (natural width/height).
 *      Text derives its box from pure clip data; media reads dimensions from the
 *      MediaLibrary asset (populated at import). When unknown (asset still
 *      probing, or no assetId) we fall back to stage size — the box is then the
 *      full contained-on-stage rect until real dimensions arrive.
 *   2. A clip with no explicit transform is drawn *contained*. On the first
 *      gesture we bake the contain-equivalent transform (`transformFromContainRect`)
 *      as the gesture baseline, so grabbing the clip never moves it.
 */

/** Minimum on-screen hit/handle box so tiny clips stay grabbable. */
const MIN_BOX_PX = 28
/** Visual breathing room around the draw rect, in screen px. */
const BOX_PAD = 0
/** Smallest rendered content dimension, in stage px (scale lower bound). */
const MIN_RENDER_PX = 16
/** Largest rendered content dimension as a multiple of the larger stage dim. */
const MAX_RENDER_STAGE_MULTIPLE = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

type MediaClip = ActiveVideoClip | ActiveImageClip

interface MediaItem {
  clip: MediaClip
  /** Content (native) size used for the draw rect; falls back to stage size. */
  contentW: number
  contentH: number
  /** Screen-space selection box. */
  rect: { left: number; top: number; width: number; height: number }
  /** Screen-space centre of the draw rect (scale pivot). */
  centerScreenX: number
  centerScreenY: number
}

interface Gesture {
  type: 'move' | 'resize'
  id: string
  trackId: string
  /** Explicit transform at gesture start — the clip's own, or the synthesized
   *  contain-equivalent when it had none. x/y are the centre (anchor 0.5). */
  base: Transform
  contentW: number
  contentH: number
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

export function MediaTransformOverlay() {
  const engine = useTimelineEngine()
  const scene = useResolvedScene()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const selectClip = useSelectionStore((s) => s.selectClip)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const assets = useMediaLibraryStore((s) => s.assets)

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

  // Resolve each video/image clip's content size + on-screen box.
  const items = useMemo<MediaItem[]>(() => {
    if (fit.width <= 0) return []
    const clips: MediaClip[] = [...scene.videos, ...scene.images]
    return clips.map((clip) => {
      // Content size lives on the MediaLibrary asset (set at import). The active
      // clip carries no assetId, so map back through the project clip.
      const assetId = engine.findClip(clip.id)?.clip.assetId
      const asset = assetId ? assets[assetId] : undefined
      const contentW = asset?.width ?? stage.width
      const contentH = asset?.height ?? stage.height

      const r = resolveDrawRect(clip.transform, stage.width, stage.height, contentW, contentH)
      const centerScreenX = fit.x + (r.x + r.width / 2) * scale
      const centerScreenY = fit.y + (r.y + r.height / 2) * scale

      const rawW = r.width * scale
      const rawH = r.height * scale
      const w = Math.max(rawW, MIN_BOX_PX)
      const h = Math.max(rawH, MIN_BOX_PX)
      const left = rawW < MIN_BOX_PX ? centerScreenX - w / 2 : fit.x + r.x * scale
      const top = rawH < MIN_BOX_PX ? centerScreenY - h / 2 : fit.y + r.y * scale

      return {
        clip,
        contentW,
        contentH,
        rect: { left, top, width: w, height: h },
        centerScreenX,
        centerScreenY,
      }
    })
  }, [scene.videos, scene.images, assets, engine, stage.width, stage.height, fit, scale])

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
        const minScale = MIN_RENDER_PX / Math.max(1, Math.min(g.contentW, g.contentH))
        const maxScale =
          (MAX_RENDER_STAGE_MULTIPLE * Math.max(g.stageW, g.stageH)) /
          Math.max(1, Math.max(g.contentW, g.contentH))
        const next = clamp(g.base.scale * ratio, minScale, maxScale)
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
      engine.commitInteraction(g.type === 'move' ? 'Move clip' : 'Resize clip')
    },
    [engine],
  )

  /** The explicit transform to apply gesture deltas to: the clip's own, or the
   *  contain-equivalent baked from content size so grabbing it never jumps. */
  const baseTransformFor = useCallback(
    (item: MediaItem): Transform =>
      item.clip.transform ??
      transformFromContainRect(item.contentW, item.contentH, stage.width, stage.height),
    [stage.width, stage.height],
  )

  const beginMove = useCallback(
    (e: ReactPointerEvent, item: MediaItem) => {
      e.stopPropagation()
      if (!selectedClipIds.has(item.clip.id)) selectClip(item.clip.id)
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      gestureRef.current = {
        type: 'move',
        id: item.clip.id,
        trackId: item.clip.trackId,
        base: baseTransformFor(item),
        contentW: item.contentW,
        contentH: item.contentH,
        stageW: stage.width,
        stageH: stage.height,
        startClientX: e.clientX,
        startClientY: e.clientY,
        centerClientX: 0,
        centerClientY: 0,
        startDist: 0,
      }
    },
    [selectedClipIds, selectClip, baseTransformFor, stage.width, stage.height],
  )

  const beginResize = useCallback(
    (e: ReactPointerEvent, item: MediaItem) => {
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
        base: baseTransformFor(item),
        contentW: item.contentW,
        contentH: item.contentH,
        stageW: stage.width,
        stageH: stage.height,
        startClientX: e.clientX,
        startClientY: e.clientY,
        centerClientX,
        centerClientY,
        startDist: Math.hypot(e.clientX - centerClientX, e.clientY - centerClientY),
      }
    },
    [selectedClipIds, selectClip, baseTransformFor, stage.width, stage.height],
  )

  return (
    <div
      ref={rootRef}
      // Click-through by default; only the boxes (and the deselect backdrop while
      // a media clip is selected) opt back into pointer events. zIndex keeps the
      // overlay above the imperatively-appended WebGL canvas regardless of DOM
      // insertion order; TextOverlay sits one layer above this.
      className="absolute inset-0 z-[2] pointer-events-none overflow-hidden"
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
          // Dynamic: position, size, border-color all depend on runtime state
          const boxStyle: CSSProperties = {
            position: 'absolute',
            left: rect.left - BOX_PAD,
            top: rect.top - BOX_PAD,
            width: rect.width + BOX_PAD * 2,
            height: rect.height + BOX_PAD * 2,
            boxSizing: 'border-box',
            border: selected ? '1px solid var(--elah-selection-color, #4c9aff)' : '1px solid transparent',
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
