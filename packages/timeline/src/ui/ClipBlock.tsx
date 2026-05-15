import { useCallback, useRef } from 'react'
import type { Clip } from '../types'
import { useTimeline } from './engine-context'
import { useSelectionStore } from '../stores/selection.store'
import { usePlaybackStore } from '../stores/playback.store'
import {
  buildSnapPoints,
  DEFAULT_OVERLAP_TOLERANCE,
  resolveOverlapEdgeSnap,
  snapFrame,
} from '../utils/snap'
import { useTracksStore } from '../stores/tracks.store'

const CLIP_COLORS: Record<string, string> = {
  video: '#3b6fd4',
  audio: '#2da34f',
  text: '#9b59b6',
  image: '#e67e22',
}

const TRIM_HANDLE_WIDTH = 8

interface ClipBlockProps {
  clip: Clip
  zoom: number
  trackHeight: number
}

/**
 * A single clip block on the timeline.
 *
 * Supports:
 * - Click to select
 * - Drag body to move (horizontal only)
 * - Drag left/right edge to trim
 *
 * High-frequency drag position updates write directly to DOM (RAF style)
 * and only commit to the engine on mouseup — zero React re-renders during drag.
 */
export function ClipBlock({ clip, zoom, trackHeight }: ClipBlockProps) {
  const engine = useTimeline()
  const isSelected = useSelectionStore((s) => s.selectedClipIds.has(clip.id))
  const selectClip = useSelectionStore((s) => s.selectClip)
  const snapEnabled = usePlaybackStore((s) => s.snapEnabled)

  const blockRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const left = clip.startFrame * zoom
  const width = Math.max(clip.durationFrames * zoom, 4)

  // --- Body drag (move) ---
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

        // Direct DOM write — no React setState during drag
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

  // --- Left trim handle ---
  const handleLeftTrimMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const startX = e.clientX
      const originalStart = clip.startFrame
      const originalDuration = clip.durationFrames
      // Text clips have no source asset, so they may grow freely.
      const maxDuration = clip.type === 'text' ? Infinity : clip.sourceDurationFrames

      const calcLeftTrim = (clientX: number) => {
        const deltaFrames = Math.round((clientX - startX) / zoom)
        let newStart = Math.max(0, originalStart + deltaFrames)
        let newDuration = Math.max(1, originalDuration - (newStart - originalStart))
        if (newDuration > maxDuration) {
          newDuration = maxDuration
          newStart = originalStart + originalDuration - maxDuration
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
        engine.trimClip(clip.id, clip.trackId, newStart, newDuration)

        if (blockRef.current) {
          blockRef.current.style.left = ''
          blockRef.current.style.width = ''
        }
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [clip, zoom, engine],
  )

  // --- Right trim handle ---
  const handleRightTrimMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const startX = e.clientX
      const originalDuration = clip.durationFrames
      // Text clips have no source asset, so they may grow freely.
      const maxDuration = clip.type === 'text' ? Infinity : clip.sourceDurationFrames

      const calcRightTrim = (clientX: number) => {
        const deltaFrames = Math.round((clientX - startX) / zoom)
        return Math.min(maxDuration, Math.max(1, originalDuration + deltaFrames))
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
        engine.trimClip(clip.id, clip.trackId, clip.startFrame, newDuration)

        if (blockRef.current) {
          blockRef.current.style.width = ''
        }
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [clip, zoom, engine],
  )

  const baseColor = CLIP_COLORS[clip.type] ?? '#555'

  return (
    <div
      ref={blockRef}
      onMouseDown={handleBodyMouseDown}
      style={{
        position: 'absolute',
        top: 4,
        left,
        width,
        height: trackHeight - 8,
        background: baseColor,
        borderRadius: 4,
        boxSizing: 'border-box',
        border: isSelected ? '2px solid #fff' : '2px solid transparent',
        cursor: 'grab',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        userSelect: 'none',
        willChange: 'transform',
        zIndex: isSelected ? 5 : 1,
      }}
    >
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
          background: 'rgba(0,0,0,0.3)',
          zIndex: 2,
        }}
      />

      {/* Clip label */}
      <span
        style={{
          paddingLeft: TRIM_HANDLE_WIDTH + 4,
          paddingRight: TRIM_HANDLE_WIDTH + 4,
          fontSize: 11,
          color: '#fff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: 'sans-serif',
          fontWeight: 600,
          pointerEvents: 'none',
        }}
      >
        {clip.name}
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
          background: 'rgba(0,0,0,0.3)',
          zIndex: 2,
        }}
      />
    </div>
  )
}
