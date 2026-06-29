import { memo, useState, useMemo } from 'react'
import type { Track } from '@elah/core'
import { useTracksStore } from '@elah/core'
import { useSelectionStore } from '@elah/core'
import {
  Film,
  Music,
  Type,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Volume2,
  VolumeX,
  Trash2,
} from 'lucide-react'
import { ClipBlock } from './ClipBlock'
import { TransitionChip } from './TransitionChip'
import { useTimeline } from './engine-context'
import { useTimelineDrop } from './useTimelineDrop'
import { cn } from './cn'

/** Sidebar width — kept in sync with SIDEBAR_WIDTH in Timeline.tsx (ruler offset). */
const SIDEBAR_WIDTH = 184

/** Per-kind type glyph shown at the start of the track label. */
const KIND_ICON: Record<string, typeof Film> = {
  video: Film,
  audio: Music,
  text: Type,
}

// Default track-label accent (the colored left bar) per kind — the clip mid
// ramp, applied as the label's text color so the bar can read it via
// currentColor. A clip slot's text-* overrides it, keeping bar and clip in sync.
const KIND_ACCENT: Record<string, string> = {
  video: 'text-clip-video-mid',
  audio: 'text-clip-audio-mid',
  text: 'text-clip-text-mid',
}

interface TrackRowProps {
  track: Track
  totalFrames: number
  zoom: number
  fps: number
  /** Override class for the row container. */
  className?: string
  /** Override class for the track-label sidebar. */
  labelClassName?: string
  /** Override class for the clip lane. */
  laneClassName?: string
  /** Override class forwarded to each ClipBlock. */
  clipClassName?: string
  /** Per-clip-type body + accent, forwarded to each ClipBlock (and bar). */
  clipVideo?: string
  clipAudio?: string
  clipText?: string
  clipImage?: string
  clipVideoAccent?: string
  clipAudioAccent?: string
  clipTextAccent?: string
  clipImageAccent?: string
}

/**
 * A single track row — renders all clips on this track.
 * Memoized: only re-renders when this track's clips, selection, or zoom changes.
 */
export const TrackRow = memo(function TrackRow({
  track,
  totalFrames,
  zoom,
  fps,
  className,
  labelClassName,
  laneClassName,
  clipClassName,
  clipVideo,
  clipAudio,
  clipText,
  clipImage,
  clipVideoAccent,
  clipAudioAccent,
  clipTextAccent,
  clipImageAccent,
}: TrackRowProps) {
  // Selector returns undefined (stable) when no clips exist.
  // ?? [] is intentionally outside the selector — returning a new [] inside
  // would give Zustand a different reference every call and cause an infinite loop.
  const rawClips = useTracksStore((s) => s.clips[track.id]) ?? []

  // Clips sorted by startFrame so adjacent-pair detection is reliable.
  const clips = useMemo(
    () => [...rawClips].sort((a, b) => a.startFrame - b.startFrame),
    [rawClips],
  )

  // Adjacent pairs — clips where B starts at or within 2 frames of where A ends.
  // The ≤2 tolerance handles 1-frame rounding artefacts from snap/trim operations.
  // Only video/image tracks carry visual transitions; audio/text tracks skip.
  const adjacentPairs = useMemo(() => {
    if (track.kind === 'audio' || track.kind === 'text') return []
    const pairs: Array<{ from: (typeof clips)[0]; to: (typeof clips)[0] }> = []
    for (let i = 0; i < clips.length - 1; i++) {
      const a = clips[i]
      const b = clips[i + 1]
      const gap = b.startFrame - (a.startFrame + a.durationFrames)
      if (gap >= 0 && gap <= 2) {
        pairs.push({ from: a, to: b })
      }
    }
    return pairs
  }, [clips, track.kind])
  const isActive = useSelectionStore((s) => s.activeTrackId === track.id)
  const setActiveTrack = useSelectionStore((s) => s.setActiveTrack)
  const engine = useTimeline()
  const [laneEl, setLaneEl] = useState<HTMLDivElement | null>(null)

  // Header controls toggle Track flags the resolver already honors:
  // disabled → track skipped, muted → volume 0 (see resolveTimeline).
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const toggleVisible = (e: React.MouseEvent) => {
    stop(e)
    engine.updateTrack(track.id, { disabled: !track.disabled })
  }
  const toggleLocked = (e: React.MouseEvent) => {
    stop(e)
    engine.updateTrack(track.id, { locked: !track.locked })
  }
  const toggleMuted = (e: React.MouseEvent) => {
    stop(e)
    engine.updateTrack(track.id, { muted: !track.muted })
  }
  const deleteTrack = (e: React.MouseEvent) => {
    stop(e)
    engine.removeTrack(track.id)
  }

  // Only allow deleting a track when more than one of its kind exists — never
  // remove the last audio/text track (video is single by model).
  const sameKindCount = useTracksStore(
    (s) => s.tracks.filter((t) => t.kind === track.kind).length,
  )

  const TypeIcon = KIND_ICON[track.kind] ?? Film
  const ctrlBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    padding: 0,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--elah-text-muted)',
  }

  useTimelineDrop(track.id, laneEl)

  // Minimum pixel width so there is always a usable timeline on small screens.
  // flex:1 grows it to fill the container when the container is larger.
  const rowMinWidth = Math.max(totalFrames * zoom, 800)

  // Per-track-kind accent (the colored left bar). The matching clip accent slot
  // overrides the default mid token (both as a text-color class read via
  // currentColor), so the bar follows clip-color overrides.
  const kindAccentSlot =
    track.kind === 'video'
      ? clipVideoAccent
      : track.kind === 'audio'
        ? clipAudioAccent
        : clipTextAccent
  const kindAccentClass = kindAccentSlot ?? KIND_ACCENT[track.kind] ?? KIND_ACCENT.video

  return (
    <div className={className} style={{ display: 'flex', height: track.height }}>
      {/* Track label sidebar — sticky so labels stay pinned while clips scroll
          horizontally underneath. zIndex keeps it above the clip blocks. */}
      {/* Track label sidebar — static border tokens as className; bg/text are dynamic */}
      <div
        onClick={() => setActiveTrack(track.id)}
        className={cn(
          'border-ed-border border-ed-border-subtle',
          isActive ? 'bg-ed-elevated' : 'bg-ed-panel',
          kindAccentClass,
          labelClassName,
        )}
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 6,
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          // The left bar paints from currentColor (set by kindAccentClass above).
          borderLeft: '3px solid currentColor',
          borderRightWidth: 1,
          borderRightStyle: 'solid',
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 10,
          paddingRight: 6,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {/* Type glyph — paints from currentColor (the track accent). */}
        <TypeIcon size={13} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden />

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: isActive ? `var(--elah-text)` : `var(--elah-text-muted)`,
            fontWeight: isActive ? 600 : 500,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {track.name}
        </span>

        {/* Per-track controls — visibility, mute (audio only), lock. */}
        <span style={{ display: 'inline-flex', gap: 1, flexShrink: 0 }}>
          <button
            type="button"
            onClick={toggleVisible}
            title={track.disabled ? 'Show track' : 'Hide track'}
            aria-label={track.disabled ? 'Show track' : 'Hide track'}
            aria-pressed={!track.disabled}
            style={ctrlBtn}
          >
            {track.disabled ? (
              <EyeOff size={13} strokeWidth={1.75} />
            ) : (
              <Eye size={13} strokeWidth={1.75} />
            )}
          </button>

          {track.kind === 'audio' && (
            <button
              type="button"
              onClick={toggleMuted}
              title={track.muted ? 'Unmute track' : 'Mute track'}
              aria-label={track.muted ? 'Unmute track' : 'Mute track'}
              aria-pressed={track.muted}
              style={{
                ...ctrlBtn,
                color: track.muted
                  ? 'var(--elah-color-error)'
                  : 'var(--elah-text-muted)',
              }}
            >
              {track.muted ? (
                <VolumeX size={13} strokeWidth={1.75} />
              ) : (
                <Volume2 size={13} strokeWidth={1.75} />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={toggleLocked}
            title={track.locked ? 'Unlock track' : 'Lock track'}
            aria-label={track.locked ? 'Unlock track' : 'Lock track'}
            aria-pressed={track.locked}
            style={{
              ...ctrlBtn,
              color: track.locked ? 'var(--elah-text)' : 'var(--elah-text-muted)',
            }}
          >
            {track.locked ? (
              <Lock size={13} strokeWidth={1.75} />
            ) : (
              <LockOpen size={13} strokeWidth={1.75} />
            )}
          </button>

          {/* Delete — only when more than one track of this kind exists. */}
          {sameKindCount > 1 && (
            <button
              type="button"
              onClick={deleteTrack}
              title="Delete track"
              aria-label="Delete track"
              style={{ ...ctrlBtn, color: 'var(--elah-text-muted)' }}
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          )}
        </span>
      </div>

      {/* Clip area — bottom border is static */}
      <div
        ref={setLaneEl}
        className={cn(
          'border-ed-border-subtle',
          isActive ? 'bg-ed-card' : 'bg-ed-bg-2',
          laneClassName,
        )}
        style={{
          position: 'relative',
          flex: 1,
          minWidth: rowMinWidth,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          overflow: 'visible',
          // Locked lanes read as non-editable.
          opacity: track.locked ? 0.6 : 1,
        }}
      >
        {clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            zoom={zoom}
            trackHeight={track.height}
            className={clipClassName}
            clipVideo={clipVideo}
            clipAudio={clipAudio}
            clipText={clipText}
            clipImage={clipImage}
            clipVideoAccent={clipVideoAccent}
            clipAudioAccent={clipAudioAccent}
            clipTextAccent={clipTextAccent}
            clipImageAccent={clipImageAccent}
          />
        ))}

        {adjacentPairs.map(({ from, to }) => (
          <TransitionChip
            key={`${from.id}-${to.id}`}
            fromClip={from}
            toClip={to}
            zoom={zoom}
            trackHeight={track.height}
            fps={fps}
          />
        ))}
      </div>
    </div>
  )
})
