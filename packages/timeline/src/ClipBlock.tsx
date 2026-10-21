import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Type, Square, Circle, Triangle, Pencil, SlidersHorizontal, Sparkles, Layers, Film } from 'lucide-react'
import type { Clip, TrackKind } from '@elah/core'
import { useTimeline } from './engine-context'
import { isClipAllowedOnTrack } from './trackCompat'
import { useSelectionStore } from '@elah/react'
import { usePlaybackStore } from '@elah/react'
import {
  buildSnapPoints,
  DEFAULT_OVERLAP_TOLERANCE,
  resolveOverlapEdgeSnap,
  snapFrame,
} from '@elah/core'
import { useTracksStore } from '@elah/react'
import { useMediaLibraryStore, useClipLoadStore } from '@elah/react'
import { cn } from './cn'
import { normBg } from './clipSlot'

/** Static bar heights for decorative audio waveform (visual only). */
const WAVE_BARS = [
  0.35, 0.55, 0.75, 0.45, 0.9, 0.6, 0.8, 0.5, 0.7, 0.4, 0.85, 0.55, 0.65, 0.45, 0.75,
  0.5, 0.95, 0.6, 0.8, 0.45, 0.7, 0.55, 0.85, 0.4, 0.65, 0.75, 0.5, 0.9, 0.6, 0.45,
]

const TRIM_HANDLE_WIDTH = 8
const TOUCH_DRAG_THRESHOLD_PX = 6

// Flat solid clip bodies — the design uses no gradient. Audio takes its darkest
// token so the tinted waveform reads on top; the rest use their mid tone. Static
// literals so Tailwind generates the utilities.
const DEFAULT_CLIP_BG: Record<string, string> = {
  video: 'bg-clip-video-mid',
  audio: 'bg-clip-audio-bottom',
  text: 'bg-clip-text-bottom',
  image: 'bg-clip-image-mid',
  shape: 'bg-clip-shape-bottom',
  freehand: 'bg-clip-freehand-bottom',
  // The converged core's clip types reuse existing tokens (no new ones):
  // adjustment and compound take the freehand tone, generator the shape tone,
  // a sequence looks like an image. They have no editor here yet.
  adjustment: 'bg-clip-freehand-bottom',
  generator: 'bg-clip-shape-bottom',
  compound: 'bg-clip-freehand-bottom',
  sequence: 'bg-clip-image-mid',
}

// Default accent (left stripe + selected hairline) per type.
const DEFAULT_CLIP_ACCENT: Record<string, string> = {
  video: 'text-clip-video-accent',
  audio: 'text-clip-audio-accent',
  text: 'text-clip-text-accent',
  image: 'text-clip-image-accent',
  shape: 'text-clip-shape-accent',
  freehand: 'text-clip-freehand-accent',
  adjustment: 'text-clip-freehand-accent',
  generator: 'text-clip-shape-accent',
  compound: 'text-clip-freehand-accent',
  sequence: 'text-clip-image-accent',
}

/**
 * Clips with no source media to run out of: `engine.trimClip()` lets these
 * grow freely, so the drag preview must too.
 */
const SOURCELESS_TYPES: ReadonlySet<Clip['type']> = new Set([
  'text',
  'shape',
  'freehand',
  'adjustment',
  'generator',
  'sequence',
])

/** Clip types that show a name label (video/image show their filmstrip instead). */
const LABELLED_TYPES: ReadonlySet<Clip['type']> = new Set([
  'audio',
  'text',
  'shape',
  'freehand',
  'adjustment',
  'generator',
  'compound',
  'sequence',
])

interface ClipBlockProps {
  clip: Clip
  zoom: number
  trackHeight: number
  /** Override class for the clip body (merged so it wins over defaults). */
  className?: string
  /**
   * Per-clip-type body background (gradient 'from-teal-400 to-teal-600' or solid
   * 'bg-teal-500') and accent ('text-*' for stripe + selected hairline). Only the
   * pair matching the clip's own type is applied. Omit to keep the default.
   */
  clipVideo?: string
  clipAudio?: string
  clipText?: string
  clipImage?: string
  clipVideoAccent?: string
  clipAudioAccent?: string
  clipTextAccent?: string
  clipImageAccent?: string
}

export const ClipBlock = memo(function ClipBlock({
  clip,
  zoom,
  trackHeight,
  className,
  clipVideo,
  clipAudio,
  clipText,
  clipImage,
  clipVideoAccent,
  clipAudioAccent,
  clipTextAccent,
  clipImageAccent,
}: ClipBlockProps) {
  const engine = useTimeline()
  const isSelected = useSelectionStore((s) => s.selectedClipIds.has(clip.id))
  const selectClip = useSelectionStore((s) => s.selectClip)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const snapEnabled = usePlaybackStore((s) => s.snapEnabled)
  const asset = useMediaLibraryStore((s) =>
    clip.assetId ? s.assets[clip.assetId] : undefined,
  )
  // A locked track blocks drag/trim/delete gestures (engine enforces too).
  const trackLocked = useTracksStore(
    (s) => s.tracks.find((t) => t.id === clip.trackId)?.locked ?? false,
  )

  const blockRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const activeGestureCleanup = useRef<(() => void) | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)

  const left = clip.startFrame * zoom
  const width = Math.max(clip.durationFrames * zoom, 4)
  const blockHeight = trackHeight - 10

  // Pick the slot for this clip's own type (explicit — no dynamic key access).
  // Body + accent slots for this clip's own type (explicit — no dynamic keys).
  const bodySlot =
    clip.type === 'video' ? clipVideo
    : clip.type === 'audio' ? clipAudio
    : clip.type === 'text' ? clipText
    : clip.type === 'image' ? clipImage
    : undefined
  const accentSlot =
    clip.type === 'video' ? clipVideoAccent
    : clip.type === 'audio' ? clipAudioAccent
    : clip.type === 'text' ? clipTextAccent
    : clip.type === 'image' ? clipImageAccent
    : undefined
  // Body bg: slot replaces the default gradient. Accent: slot text-* class, else
  // the default token class (both feed currentColor for the stripe/border).
  const clipBg = normBg(bodySlot) ?? DEFAULT_CLIP_BG[clip.type]
  const clipAccent = accentSlot ?? DEFAULT_CLIP_ACCENT[clip.type]

  // True while the clip's asset is a remote import still being probed for its
  // real duration/thumbnail (see `beginImportUrl`) — shows a full-clip loading
  // sweep instead of the (not-yet-meaningful) filmstrip/waveform.
  const assetPending = asset?.status === 'pending'

  // True while the renderer has this clip in the scene but cannot draw it yet —
  // the decoder is opening, which for a large or remote file is seconds. Unlike
  // `assetPending` this says nothing about the asset's metadata, so the
  // filmstrip stays visible underneath the sweep.
  const clipLoading = useClipLoadStore((s) => s.byClipId[clip.id] === 'loading')

  // Filmstrip tiles for video/image — decorative; tiles repeat/reduce with zoom.
  const stripFrames =
    assetPending ? [] : (asset?.thumbnailStrip ?? (asset?.thumbnailUrl ? [asset.thumbnailUrl] : []))
  const tileAspect = asset?.width && asset?.height ? asset.width / asset.height : 16 / 9
  const tileWidth = Math.max(12, blockHeight * tileAspect)
  const tileCount = Math.min(40, Math.max(1, Math.ceil(width / tileWidth)))

  // Real waveform bars for audio — falls back to static bars while decoding.
  //
  // Memoised on width because `width` is derived from `zoom`, and a zoom
  // gesture changes it on every wheel tick: without this, every clip on the
  // timeline re-sampled up to 160 peaks per tick, for a picture that barely
  // changes between two adjacent zoom levels.
  const waveform = asset?.waveform
  const waveBars = useMemo(() => {
    if (!waveform || waveform.length === 0) return WAVE_BARS
    const count = Math.min(160, Math.max(8, Math.floor(width / 3)))
    const sampled = new Array<number>(count)
    for (let i = 0; i < count; i++) {
      sampled[i] = waveform[Math.floor((i / count) * waveform.length)]
    }
    return sampled
  }, [waveform, width])

  // The bars as one path. Each is a rect subpath in a viewBox one unit per bar
  // and 100 tall, so `preserveAspectRatio="none"` stretches it to whatever the
  // clip's width happens to be without any per-bar arithmetic here.
  const wavePath = useMemo(() => {
    let d = ''
    for (let i = 0; i < waveBars.length; i++) {
      // Floor keeps quiet passages visible as a thin line.
      const h = Math.max(6, waveBars[i] * 100)
      d += `M${i + 0.15} ${100 - h}h0.7v${h}h-0.7Z`
    }
    return d
  }, [waveBars])

  const clearActiveGesture = useCallback(() => {
    activeGestureCleanup.current?.()
    activeGestureCleanup.current = null
  }, [])

  useEffect(() => clearActiveGesture, [clearActiveGesture])

  const handleBodyPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      clearActiveGesture()
      if (trackLocked) return // selectable, but not draggable

      const startX = e.clientX
      const isTouchDrag = e.pointerType === 'touch'
      const originalStart = clip.startFrame
      const originalTrackId = clip.trackId
      let currentStart = originalStart
      let currentTrackId = originalTrackId
      isDragging.current = false

      const allClips = useTracksStore.getState().clips
      const ownLane = blockRef.current?.closest<HTMLElement>('[data-elah-lane]') ?? null

      // Everything below is measured once, at the start of the gesture, because
      // none of it can change during one — the composition is frozen while a
      // drag is in flight, and so is the lane layout. Recomputing it per
      // pointermove is what made dragging a clip expensive: `buildSnapPoints`
      // walked, de-duplicated and sorted every clip in the project, and
      // `elementsFromPoint` plus two `getBoundingClientRect` calls forced a
      // synchronous layout, all of it dozens of times a second.
      const snapPoints = snapEnabled ? buildSnapPoints(allClips, clip.id) : null
      const ownLaneTop = ownLane?.getBoundingClientRect().top ?? 0
      const lanes = ownLane
        ? [...document.querySelectorAll<HTMLElement>('[data-elah-lane]')].map((el) => {
            const rect = el.getBoundingClientRect()
            return {
              trackId: el.dataset.trackId,
              kind: el.dataset.trackKind,
              locked: el.dataset.trackLocked === 'true',
              top: rect.top,
              bottom: rect.bottom,
            }
          })
        : []

      const handleMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        if (
          isTouchDrag &&
          !isDragging.current &&
          Math.abs(deltaX) <= TOUCH_DRAG_THRESHOLD_PX
        ) {
          return
        }

        isDragging.current = true
        if (blockRef.current) {
          blockRef.current.style.zIndex = '30'
        }
        const deltaFrames = Math.round(deltaX / zoom)
        let nextStart = Math.max(0, originalStart + deltaFrames)

        if (snapPoints) {
          nextStart = snapFrame(nextStart, snapPoints, Math.max(1, Math.round(5 / zoom)))
        }

        currentStart = nextStart

        // Resolve which lane the pointer is over, and whether this clip's type
        // may actually land there — an incompatible or locked lane keeps the
        // clip on its own track instead of accepting a bad drop target. A scan
        // of the rects captured at pointerdown, rather than a hit-test: it
        // answers the same question without forcing the browser to flush
        // layout on every move. (It also works in jsdom, which has no
        // `elementsFromPoint`, so the vertical-drag behaviour is now testable
        // rather than silently degraded.)
        let dy = 0
        const hovered = lanes.find(
          (lane) => moveEvent.clientY >= lane.top && moveEvent.clientY < lane.bottom,
        )
        const allowed =
          hovered !== undefined &&
          hovered.trackId !== undefined &&
          !hovered.locked &&
          hovered.kind !== undefined &&
          isClipAllowedOnTrack(clip.type, hovered.kind as TrackKind)
        if (allowed && hovered.trackId) {
          currentTrackId = hovered.trackId
          dy = hovered.top - ownLaneTop
        } else {
          currentTrackId = originalTrackId
        }

        if (blockRef.current) {
          blockRef.current.style.transform = `translate(${nextStart * zoom - left}px, ${dy}px)`
        }
      }

      const removeWindowListeners = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const finish = (shouldCommit: boolean) => {
        removeWindowListeners()
        activeGestureCleanup.current = null

        if (
          shouldCommit &&
          isDragging.current &&
          (currentStart !== originalStart || currentTrackId !== originalTrackId)
        ) {
          const targetClips = useTracksStore.getState().clips[currentTrackId] ?? []
          const settledStart = resolveOverlapEdgeSnap(
            currentStart,
            clip,
            targetClips,
            DEFAULT_OVERLAP_TOLERANCE,
          )
          engine.moveClip(clip.id, originalTrackId, currentTrackId, settledStart)
        }

        if (blockRef.current) {
          blockRef.current.style.transform = ''
          blockRef.current.style.zIndex = ''
        }
        isDragging.current = false
      }

      const handleUp = () => finish(true)
      const handleCancel = () => finish(false)

      activeGestureCleanup.current = handleCancel
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [clip, zoom, engine, selectClip, clearActiveGesture, left, snapEnabled, trackLocked],
  )

  const handleLeftTrimPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      clearActiveGesture()
      if (trackLocked) return

      const startX = e.clientX
      const originalStart = clip.startFrame
      const originalDuration = clip.durationFrames
      const anchorEnd = originalStart + originalDuration
      // Speed-aware so the live drag preview matches what engine.trimClip()
      // will actually commit — durationFrames * speed <= sourceDurationFrames.
      const maxDuration =
        SOURCELESS_TYPES.has(clip.type)
          ? Infinity
          : Math.floor(clip.sourceDurationFrames / (clip.speed ?? 1))
      const minDuration = Math.max(1, Math.ceil((TRIM_HANDLE_WIDTH * 2) / zoom))

      const calcLeftTrim = (clientX: number) => {
        const deltaFrames = Math.round((clientX - startX) / zoom)
        let newStart = Math.max(0, originalStart + deltaFrames)
        newStart = Math.min(newStart, anchorEnd - minDuration)
        let newDuration = anchorEnd - newStart
        if (newDuration > maxDuration) {
          newDuration = maxDuration
          newStart = anchorEnd - maxDuration
        }
        return { newStart, newDuration }
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const { newStart, newDuration } = calcLeftTrim(moveEvent.clientX)
        if (blockRef.current) {
          blockRef.current.style.left = `${newStart * zoom}px`
          blockRef.current.style.width = `${newDuration * zoom}px`
        }
      }

      const restoreOriginal = () => {
        if (blockRef.current) {
          blockRef.current.style.left = `${originalStart * zoom}px`
          blockRef.current.style.width = `${Math.max(originalDuration * zoom, 4)}px`
        }
      }

      const removeWindowListeners = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const finish = (clientX: number | null) => {
        removeWindowListeners()
        activeGestureCleanup.current = null

        if (clientX === null) {
          restoreOriginal()
          return
        }

        const { newStart, newDuration } = calcLeftTrim(clientX)

        if (newStart !== originalStart || newDuration !== originalDuration) {
          engine.trimClip(clip.id, clip.trackId, newStart, newDuration)
        }

        if (blockRef.current) {
          const live = engine.findClip(clip.id)?.clip
          const liveStart = live?.startFrame ?? originalStart
          const liveDuration = live?.durationFrames ?? originalDuration
          blockRef.current.style.left = `${liveStart * zoom}px`
          blockRef.current.style.width = `${Math.max(liveDuration * zoom, 4)}px`
        }
      }

      const handleUp = (upEvent: PointerEvent) => finish(upEvent.clientX)
      const handleCancel = () => finish(null)

      activeGestureCleanup.current = handleCancel
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [clip, zoom, engine, selectClip, clearActiveGesture, trackLocked],
  )

  const handleRightTrimPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      clearActiveGesture()
      if (trackLocked) return

      const startX = e.clientX
      const originalDuration = clip.durationFrames
      // Speed-aware so the live drag preview matches what engine.trimClip()
      // will actually commit — durationFrames * speed <= sourceDurationFrames.
      const maxDuration =
        SOURCELESS_TYPES.has(clip.type)
          ? Infinity
          : Math.floor(clip.sourceDurationFrames / (clip.speed ?? 1))
      const minDuration = Math.max(1, Math.ceil((TRIM_HANDLE_WIDTH * 2) / zoom))

      const calcRightTrim = (clientX: number) => {
        const deltaFrames = Math.round((clientX - startX) / zoom)
        return Math.min(maxDuration, Math.max(minDuration, originalDuration + deltaFrames))
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const newDuration = calcRightTrim(moveEvent.clientX)
        if (blockRef.current) {
          blockRef.current.style.width = `${newDuration * zoom}px`
        }
      }

      const restoreOriginal = () => {
        if (blockRef.current) {
          blockRef.current.style.width = `${Math.max(originalDuration * zoom, 4)}px`
        }
      }

      const removeWindowListeners = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const finish = (clientX: number | null) => {
        removeWindowListeners()
        activeGestureCleanup.current = null

        if (clientX === null) {
          restoreOriginal()
          return
        }

        const newDuration = calcRightTrim(clientX)

        if (newDuration !== originalDuration) {
          engine.trimClip(clip.id, clip.trackId, clip.startFrame, newDuration)
        }

        if (blockRef.current) {
          const live = engine.findClip(clip.id)?.clip
          const liveDuration = live?.durationFrames ?? originalDuration
          blockRef.current.style.width = `${Math.max(liveDuration * zoom, 4)}px`
        }
      }

      const handleUp = (upEvent: PointerEvent) => finish(upEvent.clientX)
      const handleCancel = () => finish(null)

      activeGestureCleanup.current = handleCancel
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [clip, zoom, engine, selectClip, clearActiveGesture, trackLocked],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      selectClip(clip.id)
      setCtxMenu({ x: e.clientX, y: e.clientY })
      setSpeedMenuOpen(false)
    },
    [clip.id, selectClip],
  )

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const handleCtxDelete = useCallback(() => {
    engine.removeClip(clip.id, clip.trackId)
    clearSelection()
    setCtxMenu(null)
  }, [clip.id, clip.trackId, engine, clearSelection])

  const handleSetSpeed = useCallback(
    (speed: number) => {
      engine.setClipSpeed(clip.id, clip.trackId, speed)
      setCtxMenu(null)
      setSpeedMenuOpen(false)
    },
    [clip.id, clip.trackId, engine],
  )

  return (
    <div
      ref={blockRef}
      onPointerDown={handleBodyPointerDown}
      onContextMenu={handleContextMenu}
      // Styling hooks (inert): let CSS retint per clip type / selection state —
      // e.g. audio waveform tint and the blue selected-audio body.
      data-clip-id={clip.id}
      data-clip-type={clip.type}
      data-selected={isSelected ? 'true' : 'false'}
      className={cn('rounded-[4px]', clipAccent, clipBg, className)}
      style={{
        position: 'absolute',
        top: 5,
        left,
        width,
        height: blockHeight,
        boxSizing: 'border-box',
        // Background comes from clipBg (default gradient or the slot override).
        // Selection border vs accent border (accent paints from currentColor).
        // Same-hue border in the clip's accent color (the Figma border tone);
        // selection swaps to the selection-ring color.
        border: isSelected
          ? `2px solid var(--elah-selection-border)`
          : `1px solid currentColor`,
        // Dynamic: selection glow vs default clip shadow + inner highlight
        boxShadow: isSelected
          ? `0 0 14px var(--elah-selection-glow), inset 0 1px 0 var(--elah-effect-inner-highlight-strong)`
          : `inset 0 1px 0 var(--elah-effect-inner-highlight), var(--elah-effect-clip-shadow)`,
        cursor: trackLocked ? 'default' : 'grab',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        willChange: 'transform',
        zIndex: isSelected ? 5 : 1,
      }}
    >
      {/* Filmstrip — evenly-spaced source frames tiled across the clip. Tiles
          repeat (or thin out) as the clip widens/narrows with zoom. */}
      {(clip.type === 'video' || clip.type === 'image') && stripFrames.length > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            overflow: 'hidden',
            pointerEvents: 'none',
            borderRadius: 4,
          }}
        >
          {Array.from({ length: tileCount }).map((_, i) => {
            const frameIdx = Math.min(
              stripFrames.length - 1,
              Math.floor((i / tileCount) * stripFrames.length),
            )
            return (
              <div
                key={i}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  height: '100%',
                  backgroundImage: `url(${stripFrames[frameIdx]})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  boxShadow: `inset -1px 0 0 var(--elah-effect-tile-separator)`,
                }}
              />
            )
          })}
        </div>
      )}

      {/* Left accent stripe — paints from currentColor (the clip's accent). */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: 'currentColor',
          opacity: 0.85,
          pointerEvents: 'none',
        }}
      />

      {/* Top gloss */}
      <div
        style={{
          position: 'absolute',
          inset: '0 0 55%',
          background: `linear-gradient(180deg, var(--elah-effect-gloss) 0%, transparent 100%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Audio waveform decoration.

          One <svg> with one <rect> per bar rather than up to 160 flex divs.
          Same picture, a fraction of the DOM: a wide audio clip was by far the
          heaviest thing on the timeline, and every zoom tick re-created all of
          it. The viewBox is the bar count so each bar is one unit wide and the
          whole thing scales with the clip without any per-bar arithmetic. */}
      {clip.type === 'audio' && (
        <div
          style={{
            position: 'absolute',
            left: TRIM_HANDLE_WIDTH,
            right: TRIM_HANDLE_WIDTH,
            bottom: 4,
            height: '46%',
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          <svg
            viewBox={`0 0 ${waveBars.length} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            style={{ display: 'block', width: '100%', height: '100%' }}
          >
            <path d={wavePath} fill="var(--elah-effect-waveform)" />
          </svg>
        </div>
      )}

      {/* Full-clip loading sweep, for either of the two waits a clip can be in:
          the asset itself still being fetched (remote import — duration and
          thumbnail unknown, and the clip's width is only a provisional guess),
          or the renderer's decoder still opening, which is what the preview is
          showing a spinner for at the same moment. */}
      {(clip.type === 'video' || clip.type === 'image') && (assetPending || clipLoading) && (
        <div
          className="elah-clip-shimmer"
          // The opaque fill is only right for a pending asset, where nothing
          // underneath means anything yet. A clip that is merely waiting on its
          // decoder already has a real filmstrip, so it gets the sweep alone.
          style={assetPending ? { background: `var(--elah-effect-placeholder-bg)` } : undefined}
        />
      )}

      {/* Placeholder box for video/image clips whose filmstrip hasn't decoded yet
          (asset itself is ready — only the thumbnail generation is still running). */}
      {(clip.type === 'video' || clip.type === 'image') &&
        !assetPending &&
        stripFrames.length === 0 &&
        width > 28 && (
          <div
            style={{
              position: 'absolute',
              left: TRIM_HANDLE_WIDTH + 4,
              top: 4,
              bottom: 4,
              width: 14,
              borderRadius: 3,
              background: `var(--elah-effect-placeholder-bg)`,
              border: `1px solid var(--elah-effect-placeholder-border)`,
              pointerEvents: 'none',
            }}
          />
        )}

      {/* Speed badge — video clips only, shown whenever speed deviates from 1x. */}
      {clip.type === 'video' && clip.speed !== undefined && clip.speed !== 1 && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 1,
            padding: '1px 5px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: 'var(--elah-text-on-clip)',
            background: 'var(--elah-clip-badge-bg, rgba(0, 0, 0, 0.55))',
            pointerEvents: 'none',
          }}
        >
          {clip.speed}x
        </span>
      )}

      {/* Left trim handle */}
      <div
        className="elah-trim-handle elah-trim-handle-left"
        onPointerDown={handleLeftTrimPointerDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: TRIM_HANDLE_WIDTH,
          height: '100%',
          cursor: trackLocked ? 'default' : 'ew-resize',
          background: 'transparent',
          touchAction: 'none',
          zIndex: 2,
        }}
      >
        <div
          className="elah-trim-handle-visual"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: TRIM_HANDLE_WIDTH,
            pointerEvents: 'none',
            background: `linear-gradient(90deg, var(--elah-effect-trim-scrim) 0%, transparent 100%)`,
          }}
        />
      </div>

      {/* Clip label — every type but video/image shows a name (+ glyph).
          Video/image clips show their thumbnail filmstrip instead. */}
      {LABELLED_TYPES.has(clip.type) && (
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: TRIM_HANDLE_WIDTH + 6,
            paddingRight: TRIM_HANDLE_WIDTH + 6,
            paddingTop: clip.type === 'audio' ? 3 : 5,
            fontSize: clip.type === 'audio' ? 9 : 11,
            color: `var(--elah-text-on-clip)`,
            fontWeight: clip.type === 'audio' ? 500 : 600,
            letterSpacing: '0.01em',
            textShadow: `var(--elah-effect-label-shadow)`,
            pointerEvents: 'none',
          }}
        >
          {clip.type === 'text' && (
            <Type size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'shape' && clip.shapeKind === 'rect' && (
            <Square size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'shape' && clip.shapeKind === 'circle' && (
            <Circle size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'shape' && clip.shapeKind === 'triangle' && (
            <Triangle size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'freehand' && (
            <Pencil size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'adjustment' && (
            <SlidersHorizontal size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'generator' && (
            <Sparkles size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'compound' && (
            <Layers size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          {clip.type === 'sequence' && (
            <Film size={11} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
          )}
          <span
            style={{
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {clip.type === 'text' ? (clip.content?.trim() || clip.name) : clip.name}
          </span>
        </span>
      )}

      {/* Right trim handle */}
      <div
        className="elah-trim-handle elah-trim-handle-right"
        onPointerDown={handleRightTrimPointerDown}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: TRIM_HANDLE_WIDTH,
          height: '100%',
          cursor: trackLocked ? 'default' : 'ew-resize',
          background: 'transparent',
          touchAction: 'none',
          zIndex: 2,
        }}
      >
        <div
          className="elah-trim-handle-visual"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: TRIM_HANDLE_WIDTH,
            pointerEvents: 'none',
            background: `linear-gradient(270deg, var(--elah-effect-trim-scrim) 0%, transparent 100%)`,
          }}
        />
      </div>

      {ctxMenu && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onMouseDown={closeCtxMenu}
          />
          <div
            className="elah-root"
            style={{
              position: 'fixed',
              top: ctxMenu.y,
              left: ctxMenu.x,
              zIndex: 9999,
              background: 'var(--elah-menu-bg)',
              border: '1px solid var(--elah-menu-border)',
              borderRadius: 6,
              padding: '4px 0',
              minWidth: 140,
              boxShadow: 'var(--elah-menu-shadow)',
              fontFamily: 'var(--elah-font-ui, sans-serif)',
              color: 'var(--elah-text)',
            }}
          >
            {clip.type === 'video' && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setSpeedMenuOpen((o) => !o)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '7px 14px',
                    textAlign: 'left',
                    background: speedMenuOpen ? 'var(--elah-bg-elevated)' : 'none',
                    border: 'none',
                    color: 'var(--elah-text)',
                    fontSize: 13,
                    cursor: 'pointer',
                    letterSpacing: '0.01em',
                  }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--elah-bg-elevated)'
                  }}
                  onMouseLeave={(e) => {
                    if (!speedMenuOpen) (e.currentTarget as HTMLButtonElement).style.background = 'none'
                  }}
                >
                  <span>Speed{clip.speed && clip.speed !== 1 ? ` (${clip.speed}x)` : ''}</span>
                  <span aria-hidden style={{ opacity: 0.6 }}>▸</span>
                </button>
                {speedMenuOpen && (
                  <div
                    className="elah-root"
                    style={{
                      position: 'absolute',
                      left: '100%',
                      top: 0,
                      marginLeft: 2,
                      background: 'var(--elah-menu-bg)',
                      border: '1px solid var(--elah-menu-border)',
                      borderRadius: 6,
                      padding: '4px 0',
                      minWidth: 80,
                      boxShadow: 'var(--elah-menu-shadow)',
                      color: 'var(--elah-text)',
                    }}
                  >
                    {[0.5, 1, 1.5, 2, 4].map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => handleSetSpeed(speed)}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '7px 14px',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                          color:
                            (clip.speed ?? 1) === speed
                              ? 'var(--elah-accent)'
                              : 'var(--elah-text)',
                          fontSize: 13,
                          cursor: 'pointer',
                          letterSpacing: '0.01em',
                        }}
                        onMouseEnter={(e) => {
                          ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--elah-bg-elevated)'
                        }}
                        onMouseLeave={(e) => {
                          ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
                        }}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleCtxDelete}
              style={{
                display: 'block',
                width: '100%',
                padding: '7px 14px',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                color: 'var(--elah-danger-text)',
                fontSize: 13,
                cursor: 'pointer',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--elah-danger-bg-hover)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
              }}
            >
              Delete
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
})
