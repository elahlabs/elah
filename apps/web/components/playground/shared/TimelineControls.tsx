'use client'

import { memo, useCallback, useState } from 'react'
import {
  Plus,
  Type as TypeIcon,
  Scissors,
  Trash2,
  Copy,
  Maximize2,
  Minus,
  ChevronDown,
  Music,
} from 'lucide-react'
import {
  useTracksStore,
  usePlaybackStore,
  useSelectionStore,
  useTimelineEngine,
  splitClipAtPlayhead,
  type TimelineRef,
} from '@elah/editor'
import { cn } from '@/lib/utils'

/**
 * Bottom toolbar shared by the Production editor and the Timeline playground:
 * track + clip tools on the left, zoom / fit on the right. Kept in one file so
 * both surfaces stay visually and behaviourally identical.
 */

const ZOOM_MIN = 0.02
const ZOOM_MAX = 50
const zoomToSlider = (z: number) =>
  (Math.log(z) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))
const sliderToZoom = (s: number) =>
  Math.exp(Math.log(ZOOM_MIN) + s * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)))

export const TimelineControls = memo(function TimelineControls({
  timelineRef,
}: {
  timelineRef: React.RefObject<TimelineRef | null>
}) {
  const engine = useTimelineEngine()
  const zoom = usePlaybackStore((s) => s.zoom)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const hasSelection = useSelectionStore((s) => s.selectedClipIds.size === 1)
  const [addOpen, setAddOpen] = useState(false)

  const handleDeleteSelected = useCallback(() => {
    const ids = useSelectionStore.getState().selectedClipIds
    if (ids.size !== 1) return
    const id = [...ids][0]
    const found = engine.findClip(id)
    if (!found) return
    engine.removeClip(id, found.clip.trackId)
    useSelectionStore.getState().clearSelection()
  }, [engine])

  const handleDuplicateSelected = useCallback(() => {
    const ids = useSelectionStore.getState().selectedClipIds
    if (ids.size !== 1) return
    const id = [...ids][0]
    const found = engine.findClip(id)
    if (!found) return
    const c = found.clip
    engine.cloneClip(id, c.trackId, c.startFrame + c.durationFrames)
  }, [engine])

  const splitAtPlayhead = useCallback(() => {
    const result = splitClipAtPlayhead(engine)
    if (!result.ok) console.warn('[playground] split failed:', result.reason)
  }, [engine])

  const addTextTrack = useCallback(() => {
    const n = useTracksStore.getState().tracks.filter((t) => t.kind === 'elements').length + 1
    engine.addTrack('elements', { name: `Elements ${n}` })
  }, [engine])

  const addAudioTrack = useCallback(() => {
    const n = useTracksStore.getState().tracks.filter((t) => t.kind === 'audio').length + 1
    engine.addTrack('audio', { name: `Audio ${n}` })
  }, [engine])

  // Ghost toolbar buttons (flat icons, matching the Figma).
  const ghostBtn =
    'inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors cursor-pointer'
  const ghostIcon =
    'inline-flex items-center justify-center w-7 h-7 rounded text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated transition-colors cursor-pointer'
  const disabledMod =
    'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-ed-text-muted'

  return (
    <div className="flex items-center justify-between h-10 px-4 bg-ed-bg-2 border-t border-ed-border shrink-0">
      {/* Left — track + clip tools */}
      <div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            type="button"
            className={ghostBtn}
            onClick={() => setAddOpen((o) => !o)}
            title="Add a track"
          >
            <Plus size={14} /> Add Track <ChevronDown size={12} />
          </button>
          {addOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[150px] rounded-md border border-ed-border bg-ed-elevated py-1 shadow-[var(--elah-menu-shadow)]">
                <button
                  type="button"
                  onClick={() => { addAudioTrack(); setAddOpen(false) }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                >
                  <Music size={14} /> Audio Track
                </button>
                <button
                  type="button"
                  onClick={() => { addTextTrack(); setAddOpen(false) }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-ed-text-muted hover:text-ed-text hover:bg-ed-highest transition-colors"
                >
                  <TypeIcon size={14} /> Text Track
                </button>
              </div>
            </>
          )}
        </div>
        <div className="w-px h-[18px] bg-ed-border shrink-0 mx-1.5" />
        <button
          type="button"
          className={cn(ghostBtn, !hasSelection && disabledMod)}
          disabled={!hasSelection}
          onClick={splitAtPlayhead}
          title="Split at playhead (S)"
        >
          <Scissors size={14} /> Split
        </button>
        <button
          type="button"
          className={cn(ghostIcon, !hasSelection && disabledMod)}
          disabled={!hasSelection}
          onClick={handleDuplicateSelected}
          title="Duplicate clip"
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          className={cn(ghostIcon, !hasSelection && disabledMod)}
          disabled={!hasSelection}
          onClick={handleDeleteSelected}
          title="Delete clip"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Right — zoom, fit */}
      <div className="flex items-center gap-1.5 justify-end">
        <button
          type="button"
          className={ghostIcon}
          title="Zoom out"
          onClick={() => setZoom(sliderToZoom(Math.max(0, zoomToSlider(zoom) - 0.08)))}
        >
          <Minus size={14} />
        </button>
        <input
          type="range"
          className="elah-range w-24"
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(zoom)}
          onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
        />
        <button
          type="button"
          className={ghostIcon}
          title="Zoom in"
          onClick={() => setZoom(sliderToZoom(Math.min(1, zoomToSlider(zoom) + 0.08)))}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className={ghostBtn}
          onClick={() => timelineRef.current?.fitToWindow()}
          title="Zoom to fit timeline"
        >
          <Maximize2 size={13} /> Fit
        </button>
      </div>
    </div>
  )
})
