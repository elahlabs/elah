import { memo, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Clip } from '@elah/core'
import { useTimeline } from './engine-context'
import { useSelectionStore } from '@elah/core'
import { usePlaybackStore } from '@elah/core'
import {
  buildSnapPoints,
  DEFAULT_OVERLAP_TOLERANCE,
  resolveOverlapEdgeSnap,
  snapFrame,
} from '@elah/core'
import { useTracksStore } from '@elah/core'
import { useMediaLibraryStore } from '@elah/core'
import { cn } from './cn'

/** Static bar heights for decorative audio waveform (visual only). */
const WAVE_BARS = [
  0.35, 0.55, 0.75, 0.45, 0.9, 0.6, 0.8, 0.5, 0.7, 0.4, 0.85, 0.55, 0.65, 0.45, 0.75,
  0.5, 0.95, 0.6, 0.8, 0.45, 0.7, 0.55, 0.85, 0.4, 0.65, 0.75, 0.5, 0.9, 0.6, 0.45,
]

const TRIM_HANDLE_WIDTH = 8

interface ClipBlockProps {
  clip: Clip
  zoom: number
  trackHeight: number
  /** Override class for the clip body (merged so it wins over defaults). */
  className?: string
}

export const ClipBlock = memo(function ClipBlock({ clip, zoom, trackHeight, className }: ClipBlockProps) {
  const engine = useTimeline()
  const isSelected = useSelectionStore((s) => s.selectedClipIds.has(clip.id))
  const selectClip = useSelectionStore((s) => s.selectClip)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const snapEnabled = usePlaybackStore((s) => s.snapEnabled)
  const asset = useMediaLibraryStore((s) =>
    clip.assetId ? s.assets[clip.assetId] : undefined,
  )

  const blockRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const left = clip.startFrame * zoom
  const width = Math.max(clip.durationFrames * zoom, 4)
  const blockHeight = trackHeight - 10

  // Filmstrip tiles for video/image — decorative; tiles repeat/reduce with zoom.
  const stripFrames =
    asset?.thumbnailStrip ?? (asset?.thumbnailUrl ? [asset.thumbnailUrl] : [])
  const tileAspect = asset?.width && asset?.height ? asset.width / asset.height : 16 / 9
  const tileWidth = Math.max(12, blockHeight * tileAspect)
  const tileCount = Math.min(40, Math.max(1, Math.ceil(width / tileWidth)))

  // Real waveform bars for audio — falls back to static bars while decoding.
  const waveform = asset?.waveform
  let waveBars: number[] = WAVE_BARS
  if (waveform && waveform.length > 0) {
    const count = Math.min(160, Math.max(8, Math.floor(width / 3)))
    const sampled = new Array<number>(count)
    for (let i = 0; i < count; i++) {
      sampled[i] = waveform[Math.floor((i / count) * waveform.length)]
    }
    waveBars = sampled
  }

  const handleBodyMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)

      const startX = e.clientX
      const originalStart = clip.startFrame
      let currentStart = originalStart
      isDragging.current = false

      const allClips = useTracksStore.getState().clips

      const handleMove = (moveEvent: MouseEvent) => {
        isDragging.current = true
        if (blockRef.current) {
          blockRef.current.style.zIndex = '30'
        }
        const deltaX = moveEvent.clientX - startX
        const deltaFrames = Math.round(deltaX / zoom)
        let nextStart = Math.max(0, originalStart + deltaFrames)

        if (snapEnabled) {
          const snapPoints = buildSnapPoints(allClips, clip.id)
          nextStart = snapFrame(nextStart, snapPoints, Math.max(1, Math.round(5 / zoom)))
        }

        currentStart = nextStart

        if (blockRef.current) {
          blockRef.current.style.transform = `translateX(${nextStart * zoom - left}px)`
        }
      }

      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)

        if (isDragging.current && currentStart !== originalStart) {
          const trackClips =
            useTracksStore.getState().clips[clip.trackId] ?? []
          const settledStart = resolveOverlapEdgeSnap(
            currentStart,
            clip,
            trackClips,
            DEFAULT_OVERLAP_TOLERANCE,
          )
          engine.moveClip(clip.id, clip.trackId, clip.trackId, settledStart)
        }

        if (blockRef.current) {
          blockRef.current.style.transform = ''
          blockRef.current.style.zIndex = ''
        }
        isDragging.current = false
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [clip, zoom, engine, selectClip, left, snapEnabled],
  )

  const handleLeftTrimMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      selectClip(clip.id)

      const startX = e.clientX
      const originalStart = clip.startFrame
      const originalDuration = clip.durationFrames
      const anchorEnd = originalStart + originalDuration
      const maxDuration = clip.type === 'text' ? Infinity : clip.sourceDurationFrames
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

      const handleMove = (moveEvent: MouseEvent) => {
        const { newStart, newDuration } = calcLeftTrim(moveEvent.clientX)
        if (blockRef.current) {
          blockRef.current.style.left = `${newStart * zoom}px`
          blockRef.current.style.width = `${newDuration * zoom}px`
        }
      }

      const handleUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)

        const { newStart, newDuration } = calcLeftTrim(upEvent.clientX)

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

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [clip, zoom, engine, selectClip],
  )

  const handleRightTrimMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      selectClip(clip.id)

      const startX = e.clientX
      const originalDuration = clip.durationFrames
      const maxDuration = clip.type === 'text' ? Infinity : clip.sourceDurationFrames
      const minDuration = Math.max(1, Math.ceil((TRIM_HANDLE_WIDTH * 2) / zoom))

      const calcRightTrim = (clientX: number) => {
        const deltaFrames = Math.round((clientX - startX) / zoom)
        return Math.min(maxDuration, Math.max(minDuration, originalDuration + deltaFrames))
      }

      const handleMove = (moveEvent: MouseEvent) => {
        const newDuration = calcRightTrim(moveEvent.clientX)
        if (blockRef.current) {
          blockRef.current.style.width = `${newDuration * zoom}px`
        }
      }

      const handleUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)

        const newDuration = calcRightTrim(upEvent.clientX)

        if (newDuration !== originalDuration) {
          engine.trimClip(clip.id, clip.trackId, clip.startFrame, newDuration)
        }

        if (blockRef.current) {
          const live = engine.findClip(clip.id)?.clip
          const liveDuration = live?.durationFrames ?? originalDuration
          blockRef.current.style.width = `${Math.max(liveDuration * zoom, 4)}px`
        }
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [clip, zoom, engine, selectClip],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      engine.removeClip(clip.id, clip.trackId)
      clearSelection()
    },
    [clip.id, clip.trackId, engine, clearSelection],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      selectClip(clip.id)
      setCtxMenu({ x: e.clientX, y: e.clientY })
    },
    [clip.id, selectClip],
  )

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const handleCtxDelete = useCallback(() => {
    engine.removeClip(clip.id, clip.trackId)
    clearSelection()
    setCtxMenu(null)
  }, [clip.id, clip.trackId, engine, clearSelection])

  return (
    <div
      ref={blockRef}
      onMouseDown={handleBodyMouseDown}
      onContextMenu={handleContextMenu}
      className={cn('rounded-[7px]', className)}
      style={{
        position: 'absolute',
        top: 5,
        left,
        width,
        height: blockHeight,
        boxSizing: 'border-box',
        // Dynamic: per-clip-type gradient using CSS vars
        background: `linear-gradient(180deg, var(--elah-clip-${clip.type}-top) 0%, var(--elah-clip-${clip.type}-mid) 42%, var(--elah-clip-${clip.type}-bottom) 100%)`,
        // Dynamic: selection border vs accent border
        border: isSelected
          ? `2px solid var(--elah-selection-border)`
          : `1px solid color-mix(in srgb, var(--elah-clip-${clip.type}-accent) 33%, transparent)`,
        // Dynamic: selection glow vs default clip shadow + inner highlight
        boxShadow: isSelected
          ? `0 0 14px var(--elah-selection-glow), inset 0 1px 0 var(--elah-effect-inner-highlight-strong)`
          : `inset 0 1px 0 var(--elah-effect-inner-highlight), var(--elah-effect-clip-shadow)`,
        cursor: 'grab',
        overflow: 'hidden',
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
            borderRadius: 7,
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

      {/* Left accent stripe */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: `var(--elah-clip-${clip.type}-accent)`,
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

      {/* Audio waveform decoration */}
      {clip.type === 'audio' && (
        <div
          style={{
            position: 'absolute',
            left: TRIM_HANDLE_WIDTH,
            right: TRIM_HANDLE_WIDTH,
            bottom: 4,
            height: '46%',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 1,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        >
          {waveBars.map((h, i) => (
            <div
              key={i}
              style={{
                flex: '1 1 2px',
                minWidth: 1,
                maxWidth: 3,
                // Floor keeps quiet passages visible as a thin line.
                height: `${Math.max(6, h * 100)}%`,
                background: `var(--elah-effect-waveform)`,
                borderRadius: 1,
              }}
            />
          ))}
        </div>
      )}

      {/* Placeholder box for video/image clips whose filmstrip hasn't decoded yet. */}
      {(clip.type === 'video' || clip.type === 'image') &&
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

      {/* Left trim handle */}
      <div
        onMouseDown={handleLeftTrimMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: TRIM_HANDLE_WIDTH,
          height: '100%',
          cursor: 'ew-resize',
          background: `linear-gradient(90deg, var(--elah-effect-trim-scrim) 0%, transparent 100%)`,
          zIndex: 2,
        }}
      />

      {/* Clip label */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'block',
          paddingLeft: clip.type === 'video' || clip.type === 'image' ? TRIM_HANDLE_WIDTH + 22 : TRIM_HANDLE_WIDTH + 6,
          paddingRight: TRIM_HANDLE_WIDTH + 6,
          paddingTop: 5,
          fontSize: 10,
          color: `var(--elah-text-on-clip)`,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: 600,
          letterSpacing: '0.01em',
          textShadow: `var(--elah-effect-label-shadow)`,
          pointerEvents: 'none',
        }}
      >
        {clip.type === 'text' ? (clip.content?.trim() || clip.name) : clip.name}
      </span>

      {/* Right trim handle */}
      <div
        onMouseDown={handleRightTrimMouseDown}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: TRIM_HANDLE_WIDTH,
          height: '100%',
          cursor: 'ew-resize',
          background: `linear-gradient(270deg, var(--elah-effect-trim-scrim) 0%, transparent 100%)`,
          zIndex: 2,
        }}
      />

      {isSelected && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleDelete}
          title="Delete clip (Del)"
          aria-label="Delete clip"
          style={{
            position: 'absolute',
            top: 3,
            right: TRIM_HANDLE_WIDTH + 3,
            width: 16,
            height: 16,
            padding: 0,
            lineHeight: '14px',
            fontSize: 11,
            color: `var(--elah-effect-delete-btn-text)`,
            background: `var(--elah-effect-delete-btn-bg)`,
            border: `1px solid var(--elah-effect-delete-btn-border)`,
            borderRadius: 4,
            cursor: 'pointer',
            zIndex: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      )}

      {ctxMenu && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onMouseDown={closeCtxMenu}
          />
          <div
            style={{
              position: 'fixed',
              top: ctxMenu.y,
              left: ctxMenu.x,
              zIndex: 9999,
              background: `var(--elah-menu-bg)`,
              border: `1px solid var(--elah-menu-border)`,
              borderRadius: 6,
              padding: '4px 0',
              minWidth: 140,
              boxShadow: `var(--elah-menu-shadow)`,
              fontFamily: 'sans-serif',
            }}
          >
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
                color: `var(--elah-danger-text)`,
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
