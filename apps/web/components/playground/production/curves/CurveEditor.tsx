'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  BEZIER_PRESETS,
  channelExpression,
  channelKeys,
  channelValueKind,
  formatColor,
  matchBezierPreset,
  moveKeyframe,
  removeKeyframe,
  sampleChannel,
  setKeyframe,
  setKeysBezierAtFrame,
  setKeysHoldAtFrame,
  type AnyKeyframeChannel,
  type ChannelValueKind,
  type Clip,
  type Keyframe,
} from '@elah/core'
import { useKeySelectionStore, usePlaybackStore, useTracksStore } from '@elah/editor'
import { Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  bezierFromHandle,
  channelLabel,
  colorStripCells,
  curvePath,
  frameToX,
  segmentHandles,
  snapValue,
  valueRange,
  valueToY,
  xToFrame,
  yToValue,
  type CurveView,
  drawerChannels,
  expressionSamples,
  samplesPath,
  samplesRange,
  unionRange,
} from '@/lib/editor/curves'
import { useCurveDrawer } from '@/lib/editor/curveDrawer'
// PV-P5c-2: moving a colour/path key drags time only — the writer that keeps
// `.vec`/`.path` byte-identical (a thin wrapper over core's `moveKeyframe`).
import { moveTypedKey } from '@/lib/editor/typedKeyframes'
import { useSelectedClips } from './useSelectedClip'

/**
 * The curve editor drawer (EDX-P6): a value graph for each keyed channel of
 * the selected clip, full width under the timeline and on the SAME time axis
 * (zoom and scroll are the timeline's), so a key sits exactly under its
 * diamond. Drag a key to move it in time and value; drag a handle to shape
 * the curve into that key (it becomes a custom bezier); double-click to add a
 * key; Delete removes the selected one. Every drag is one undo step.
 */

const HEIGHT = 190
const PAD = 14
const KEY_R = 5

type Gesture =
  | { kind: 'key'; clip: Clip; channel: AnyKeyframeChannel; keyId: string; range: { min: number; max: number }; moved: boolean }
  | {
      kind: 'handle'
      clip: Clip
      channel: AnyKeyframeChannel
      a: Keyframe
      b: Keyframe
      which: 1 | 2
      range: { min: number; max: number }
      moved: boolean
    }
  // PV-P5c-2: a typed (colour/path) key has no value axis — dragging it moves
  // time only, so it carries no `range` at all (nothing to freeze).
  | { kind: 'typedKey'; clip: Clip; channel: AnyKeyframeChannel; keyId: string; moved: boolean }

/** Default track-label sidebar width of `<Timeline>` (its `SIDEBAR_WIDTH`). */
const TIMELINE_SIDEBAR = 184

/**
 * `TimelineRef` exposes no scroll API in the open-source package, so the drawer
 * finds the timeline's single scroll container in the DOM: the second child of
 * `[data-elah-timeline-root]` (ruler row first, track area second).
 */
function timelineScroller(scope?: HTMLElement | null): HTMLElement | null {
  const root = (scope ?? document).querySelector('[data-elah-timeline-root]')
  const el = root?.children[1]
  return el instanceof HTMLElement ? el : null
}

export interface CurveEditorProps {
  /** Show this clip instead of the first selected one (a host with its own clip picker). */
  clipId?: string
  /** Element containing the timeline to follow, for pages with more than one timeline. */
  root?: HTMLElement | null
  /** Always open, with no close button (the host owns visibility). */
  pinned?: boolean
}

export function CurveEditor({ clipId, root, pinned = false }: CurveEditorProps = {}) {
  const storeOpen = useCurveDrawer((s) => s.open)
  const open = pinned || storeOpen
  const setOpen = useCurveDrawer((s) => s.setOpen)
  const { engine, clips } = useSelectedClips()
  const clipsByTrack = useTracksStore((s) => s.clips)
  const pinnedClip = clipId ? Object.values(clipsByTrack).flat().find((c) => c.id === clipId) : undefined
  const clip = clipId ? pinnedClip : clips[0]
  const zoom = usePlaybackStore((s) => s.zoom)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)

  const [scrollLeft, setScrollLeft] = useState(0)
  const sidebar = TIMELINE_SIDEBAR
  const [width, setWidth] = useState(800)
  const [active, setActive] = useState<AnyKeyframeChannel | null>(null)
  // Shared with the Animate list and the timeline lane: the selected key is a
  // frame set on one clip, mapped to this channel's key id below.
  const selClipId = useKeySelectionStore((s) => s.clipId)
  const selFrames = useKeySelectionStore((s) => s.frames)
  const selectKeys = useKeySelectionStore((s) => s.select)
  const clearKeys = useKeySelectionStore((s) => s.clear)
  const [frozenRange, setFrozenRange] = useState<{ min: number; max: number } | null>(null)
  const plotRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<Gesture | null>(null)

  // Follow the timeline's horizontal scroll and sidebar width.
  useEffect(() => {
    if (!open) return
    const scroller = timelineScroller(root)
    if (!scroller) return
    const sync = () => setScrollLeft(scroller.scrollLeft)
    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    return () => scroller.removeEventListener('scroll', sync)
  }, [open, root])

  useEffect(() => {
    const el = plotRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [open])


  // `drawerChannels`, not `allKeyedChannels`: an expression channel may hold no
  // keys at all, so the keyed-only list would hide a channel the author is
  // actively driving — the drawer would look broken for the case it explains.
  const channels = useMemo(() => (clip ? drawerChannels(clip) : []), [clip])
  const channel = active && channels.includes(active) ? active : (channels[0] ?? null)
  const keys = useMemo(() => (clip && channel ? channelKeys(clip, channel) : []), [clip, channel])
  const selectedKey =
    clip && selClipId === clip.id ? (keys.find((k) => selFrames.has(k.frame))?.id ?? null) : null
  const setSelectedKey = (id: string | null) => {
    if (!clip) return
    const hit = id ? keys.find((k) => k.id === id) : undefined
    if (hit) selectKeys(clip.id, [hit.frame])
    else if (selClipId === clip.id) clearKeys()
  }
  // PV-P5c-2: a `color`/`shape.path` channel draws a strip/time row instead of
  // the numeric plot — no y-axis exists for a colour or a path string.
  const kind: ChannelValueKind = clip && channel ? channelValueKind(clip, channel) : 'scalar'
  const exprSource = clip && channel ? channelExpression(clip, channel) : undefined
  // Sampled over the clip's own frames, and capped inside `expressionSamples`:
  // this runs on every pointer move while dragging the drawer.
  const exprSamples = useMemo(
    () =>
      clip && channel && exprSource
        ? expressionSamples(engine.getProject(), clip, channel, clip.startFrame, clip.startFrame + clip.durationFrames - 1)
        : [],
    [clip, channel, exprSource, engine],
  )
  // Identical to `valueRange(keys)` when the channel has no expression, so a
  // keyed channel is framed exactly as before. A typed channel has no value
  // axis at all (every key stores `value: 0`), so its "range" is unused —
  // {0, 1} is a harmless placeholder, never drawn.
  const range =
    kind !== 'scalar'
      ? { min: 0, max: 1 }
      : (frozenRange ??
        (exprSamples.length
          ? unionRange(keys.length ? valueRange(keys) : null, samplesRange(exprSamples))
          : valueRange(keys)))
  const view: CurveView = { zoom, scrollLeft, height: HEIGHT, pad: PAD, min: range.min, max: range.max }

  // Delete removes the selected key.
  useEffect(() => {
    if (!open || !clip || !channel || !selectedKey) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      // A selected curve key owns Delete (captured before the timeline's
      // clip delete); clicking empty plot space deselects and gives it back.
      e.preventDefault()
      e.stopPropagation()
      engine.updateClip(clip.id, clip.trackId, removeKeyframe(clip, channel, selectedKey))
      clearKeys()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, clip, channel, selectedKey, engine, clearKeys])

  if (!open) return null

  const pointIn = (e: { clientX: number; clientY: number }) => {
    const r = plotRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const begin = (e: ReactPointerEvent, g: Gesture) => {
    e.preventDefault()
    e.stopPropagation()
    gestureRef.current = g
    if ('range' in g) setFrozenRange(g.range)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  /** Keep the shared selection on the dragged key at the frame it now sits on. */
  const followKey = (base: Clip, patch: Partial<Clip>, ch: AnyKeyframeChannel, keyId: string) => {
    const moved = channelKeys({ ...base, ...patch } as Clip, ch).find((k) => k.id === keyId)
    if (moved) selectKeys(base.id, [moved.frame])
  }

  const onMove = (e: ReactPointerEvent) => {
    const g = gestureRef.current
    if (!g) return
    const p = pointIn(e)
    if (g.kind === 'typedKey') {
      // Time only — no value to compute or snap; `.vec`/`.path` ride along
      // through `moveTypedKey`.
      g.moved = true
      const frame = Math.round(xToFrame(p.x, view) - g.clip.startFrame)
      const patch = moveTypedKey(g.clip, g.channel, g.keyId, frame)
      engine.previewClip(g.clip.id, g.clip.trackId, patch)
      followKey(g.clip, patch, g.channel, g.keyId)
      return
    }
    const v: CurveView = { ...view, min: g.range.min, max: g.range.max }
    const frame = xToFrame(p.x, v) - g.clip.startFrame
    const value = yToValue(p.y, v)
    g.moved = true
    if (g.kind === 'key') {
      const orig = channelKeys(g.clip, g.channel).find((k) => k.id === g.keyId)
      const f = e.shiftKey && orig ? orig.frame : Math.round(frame)
      const patch = moveKeyframe(g.clip, g.channel, g.keyId, f, snapValue(value, g.range))
      engine.previewClip(g.clip.id, g.clip.trackId, patch)
      followKey(g.clip, patch, g.channel, g.keyId)
    } else {
      const bez = bezierFromHandle(g.a, g.b, g.which, frame, value)
      if (bez) engine.previewClip(g.clip.id, g.clip.trackId, setKeysBezierAtFrame(g.clip, g.b.frame, bez, g.channel))
    }
  }

  const onUp = () => {
    const g = gestureRef.current
    gestureRef.current = null
    setFrozenRange(null)
    if (!g) return
    if (g.moved) engine.commitInteraction(g.kind === 'handle' ? 'Edit curve' : 'Move keyframe')
  }

  const addKeyAt = (e: React.MouseEvent) => {
    if (!clip || !channel || kind !== 'scalar') return
    const p = pointIn(e)
    const local = Math.round(xToFrame(p.x, view) - clip.startFrame)
    if (local < 0 || local > clip.durationFrames - 1) return
    const sampled = sampleChannel(keys, local)
    const value = snapValue(sampled ?? yToValue(p.y, view), range)
    engine.updateClip(clip.id, clip.trackId, setKeyframe(clip, channel, local, { stage: engine.getProject().stage }, value))
  }

  const selIndex = keys.findIndex((k) => k.id === selectedKey)
  const selKey = selIndex >= 0 ? keys[selIndex] : undefined
  const intoSelected = selIndex > 0 ? keys[selIndex] : undefined

  const clipFrom = clip ? clip.startFrame : 0
  const clipTo = clip ? clip.startFrame + clip.durationFrames - 1 : 0
  const firstVisible = xToFrame(0, view)
  const lastVisible = xToFrame(width, view)
  const pathFrom = Math.max(firstVisible, clipFrom)
  const pathTo = Math.min(lastVisible, clipTo)

  return (
    <div
      data-curve-editor
      data-elah-keyscope="curve"
      tabIndex={-1}
      className="flex shrink-0 flex-col border-t border-ed-border bg-ed-bg outline-none"
      style={{ height: HEIGHT + 30 }}
    >
      <div className="flex h-[30px] items-center gap-2 border-b border-ed-border px-2 text-[11px] text-ed-text-muted">
        <span className="font-semibold text-ed-text">Curves</span>
        {selKey && intoSelected && (
          <>
            <span className="text-ed-text-muted/60">|</span>
            <span>Into key at {selKey.frame}f:</span>
            {BEZIER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => clip && channel && engine.updateClip(clip.id, clip.trackId, setKeysBezierAtFrame(clip, selKey.frame, p.bezier, channel))}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors hover:bg-ed-elevated hover:text-ed-text',
                  matchBezierPreset(selKey.easingBezier)?.id === p.id && 'bg-ed-elevated text-ed-accent',
                )}
              >
                {p.label}
              </button>
            ))}
          </>
        )}
        {selKey && (
          <button
            type="button"
            onClick={() => clip && channel && engine.updateClip(clip.id, clip.trackId, setKeysHoldAtFrame(clip, selKey.frame, !selKey.hold, channel))}
            aria-pressed={!!selKey.hold}
            title="Hold this value until the next keyframe"
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-ed-elevated hover:text-ed-text',
              selKey.hold && 'bg-ed-elevated text-ed-accent',
            )}
          >
            <Square size={9} fill={selKey.hold ? 'currentColor' : 'none'} /> Hold
          </button>
        )}
        <span className="ml-auto hidden md:inline">Drag keys and handles · double-click adds a key · Shift locks time · Delete removes</span>
        {!pinned && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close curve editor"
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-ed-elevated hover:text-ed-text"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 overflow-y-auto border-r border-ed-border py-1" style={{ width: sidebar }}>
          {!clip && <p className="px-2 py-1 text-[11px] text-ed-text-muted">Select a clip to see its curves.</p>}
          {clip && channels.length === 0 && (
            <p className="px-2 py-1 text-[11px] leading-snug text-ed-text-muted">
              This clip has no keyframes. Apply a preset or key a property in the Inspector.
            </p>
          )}
          {clip &&
            channels.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setActive(c)
                  setSelectedKey(null)
                }}
                className={cn(
                  'block w-full truncate px-2 py-1 text-left text-[11px] transition-colors hover:bg-ed-elevated',
                  c === channel ? 'bg-ed-elevated text-ed-accent' : 'text-ed-text-muted',
                )}
                title={channelLabel(clip, c)}
              >
                {channelLabel(clip, c)}
                {/* `ƒx` marks a channel driven by an expression rather than by
                    keys. `ƒ` is U+0192. The key count beside it stays, because
                    a channel can have both. */}
                {channelExpression(clip, c) ? ' ƒx' : ''}
                <span className="ml-1 tabular-nums opacity-60">{channelKeys(clip, c).length}</span>
              </button>
            ))}
        </div>

        <svg
          ref={plotRef}
          className="min-w-0 flex-1 touch-none select-none text-ed-accent"
          height={HEIGHT}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            if (gestureRef.current?.moved) engine.cancelInteraction()
            gestureRef.current = null
            setFrozenRange(null)
          }}
          onDoubleClick={addKeyAt}
          onPointerDown={() => setSelectedKey(null)}
        >
          {clip && (
            <rect
              x={frameToX(clipFrom, view)}
              y={0}
              width={Math.max(0, (clipTo - clipFrom) * zoom)}
              height={HEIGHT}
              className="fill-ed-elevated"
              opacity={0.5}
            />
          )}
          {kind === 'scalar' && (
            <>
              {/* Zero line when zero is in range. */}
              {range.min < 0 && range.max > 0 && (
                <line x1={0} x2={width} y1={valueToY(0, view)} y2={valueToY(0, view)} className="stroke-ed-border" strokeDasharray="3 3" />
              )}
              {/* Range labels. */}
              <text x={4} y={PAD - 3} className="fill-ed-text-muted" fontSize={9}>
                {range.max.toFixed(2)}
              </text>
              <text x={4} y={HEIGHT - 3} className="fill-ed-text-muted" fontSize={9}>
                {range.min.toFixed(2)}
              </text>

              {clip && keys.length > 0 && (
                <path d={curvePath(keys, clip.startFrame, pathFrom, pathTo, view)} fill="none" stroke="currentColor" strokeWidth={1.75} />
              )}

              {/* The expression's own output, dashed, over the keys. `pointerEvents`
                  is off so it cannot steal a key drag — it is a read-only overlay. */}
              {exprSamples.length > 1 && (
                <path
                  d={samplesPath(exprSamples, view)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.85}
                  pointerEvents="none"
                  data-expression-curve
                />
              )}

              {/* Bezier handles for the segment into the selected key — value
                  dragging, so no equivalent exists for a typed channel. */}
              {/* A staircase segment draws as steps and has no bezier handles: dragging one would replace it. */}
              {clip && channel && intoSelected && !intoSelected.steps && selIndex > 0 && (() => {
                const a = keys[selIndex - 1]!
                const b = intoSelected
                const h = segmentHandles(a, b)
                if (!h) return null
                const pa = { x: frameToX(clip.startFrame + a.frame, view), y: valueToY(a.value, view) }
                const pb = { x: frameToX(clip.startFrame + b.frame, view), y: valueToY(b.value, view) }
                const p1 = { x: frameToX(clip.startFrame + h.h1.frame, view), y: valueToY(h.h1.value, view) }
                const p2 = { x: frameToX(clip.startFrame + h.h2.frame, view), y: valueToY(h.h2.value, view) }
                return (
                  <g>
                    <line x1={pa.x} y1={pa.y} x2={p1.x} y2={p1.y} className="stroke-ed-text-muted" />
                    <line x1={pb.x} y1={pb.y} x2={p2.x} y2={p2.y} className="stroke-ed-text-muted" />
                    {([1, 2] as const).map((which) => {
                      const p = which === 1 ? p1 : p2
                      return (
                        <circle
                          key={which}
                          cx={p.x}
                          cy={p.y}
                          r={4}
                          className="cursor-grab fill-ed-bg stroke-ed-text"
                          strokeWidth={1.5}
                          data-curve-handle={which}
                          onPointerDown={(e) => begin(e, { kind: 'handle', clip, channel, a, b, which, range, moved: false })}
                        />
                      )
                    })}
                  </g>
                )
              })()}

              {clip &&
                channel &&
                keys.map((k) => {
                  const x = frameToX(clip.startFrame + k.frame, view)
                  const y = valueToY(k.value, view)
                  const outside = k.frame < 0 || k.frame > clip.durationFrames - 1
                  const selected = k.id === selectedKey
                  return k.hold ? (
                    <rect
                      key={k.id}
                      x={x - KEY_R}
                      y={y - KEY_R}
                      width={KEY_R * 2}
                      height={KEY_R * 2}
                      data-curve-key={k.frame}
                      className={cn('cursor-move', selected ? 'fill-ed-accent stroke-ed-text' : 'fill-ed-text stroke-ed-bg')}
                      strokeWidth={1.5}
                      opacity={outside ? 0.4 : 1}
                      onPointerDown={(e) => {
                        setSelectedKey(k.id)
                        if (!outside) begin(e, { kind: 'key', clip, channel, keyId: k.id, range, moved: false })
                      }}
                    >
                      <title>{`${k.frame}f · ${k.value.toFixed(3)} · hold`}</title>
                    </rect>
                  ) : (
                    <circle
                      key={k.id}
                      cx={x}
                      cy={y}
                      r={KEY_R}
                      data-curve-key={k.frame}
                      className={cn('cursor-move', selected ? 'fill-ed-accent stroke-ed-text' : 'fill-ed-text stroke-ed-bg')}
                      strokeWidth={1.5}
                      opacity={outside ? 0.4 : 1}
                      onPointerDown={(e) => {
                        setSelectedKey(k.id)
                        if (!outside) begin(e, { kind: 'key', clip, channel, keyId: k.id, range, moved: false })
                      }}
                    >
                      <title>{`${k.frame}f · ${k.value.toFixed(3)}`}</title>
                    </circle>
                  )
                })}
            </>
          )}

          {/* PV-P5c-2: a colour channel's strip — sampled swatches, no value axis. */}
          {kind === 'color' && clip && channel && (
            <g data-color-strip>
              {colorStripCells(keys, clip.startFrame, pathFrom, pathTo, view, 4).map((cell, i) => (
                <rect key={i} x={cell.x} y={HEIGHT / 2 - 12} width={cell.width + 0.5} height={24} fill={cell.color} />
              ))}
              <rect
                x={frameToX(pathFrom, view)}
                y={HEIGHT / 2 - 12}
                width={Math.max(0, frameToX(pathTo, view) - frameToX(pathFrom, view))}
                height={24}
                fill="none"
                className="stroke-ed-border"
              />
            </g>
          )}

          {/* PV-P5c-2: colour/path keys — time-only diamonds, no y position. A
              colour diamond swatches to its OWN authored `vec` (the exact
              authored value at that key), not the strip's interpolation. */}
          {kind !== 'scalar' &&
            clip &&
            channel &&
            keys.map((k) => {
              const x = frameToX(clip.startFrame + k.frame, view)
              const y = HEIGHT / 2
              const outside = k.frame < 0 || k.frame > clip.durationFrames - 1
              const selected = k.id === selectedKey
              const swatch = kind === 'color' && k.vec ? formatColor(k.vec) : undefined
              return (
                <rect
                  key={k.id}
                  x={x - KEY_R}
                  y={y - KEY_R}
                  width={KEY_R * 2}
                  height={KEY_R * 2}
                  transform={`rotate(45 ${x} ${y})`}
                  data-curve-key={k.frame}
                  className={cn('cursor-ew-resize', selected ? 'stroke-ed-text' : 'stroke-ed-bg', !swatch && (selected ? 'fill-ed-accent' : 'fill-ed-text'))}
                  fill={swatch}
                  strokeWidth={1.5}
                  opacity={outside ? 0.4 : 1}
                  onPointerDown={(e) => {
                    setSelectedKey(k.id)
                    if (!outside) begin(e, { kind: 'typedKey', clip, channel, keyId: k.id, moved: false })
                  }}
                >
                  <title>{kind === 'path' ? `${k.frame}f · path` : `${k.frame}f · ${swatch ?? 'colour'}`}</title>
                </rect>
              )
            })}

          {/* Playhead. */}
          <line
            x1={frameToX(currentFrame, view)}
            x2={frameToX(currentFrame, view)}
            y1={0}
            y2={HEIGHT}
            className="stroke-ed-accent"
            strokeWidth={1}
            pointerEvents="none"
          />
        </svg>
      </div>
    </div>
  )
}
