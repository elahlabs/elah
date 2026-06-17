import { memo, useState, useMemo } from 'react'
import type { Track } from '@elah/core'
import { useTracksStore } from '@elah/core'
import { useSelectionStore } from '@elah/core'
import { ClipBlock } from './ClipBlock'
import { TransitionChip } from './TransitionChip'
import { useTimelineDrop } from './useTimelineDrop'

interface TrackRowProps {
  track: Track
  totalFrames: number
  zoom: number
  fps: number
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
  const [laneEl, setLaneEl] = useState<HTMLDivElement | null>(null)

  useTimelineDrop(track.id, laneEl)

  // Minimum pixel width so there is always a usable timeline on small screens.
  // flex:1 grows it to fill the container when the container is larger.
  const rowMinWidth = Math.max(totalFrames * zoom, 800)

  const kindAccent =
    track.kind === 'video'
      ? 'var(--elah-clip-video-mid)'
      : track.kind === 'audio'
        ? 'var(--elah-clip-audio-mid)'
        : 'var(--elah-clip-text-mid)'

  return (
    <div style={{ display: 'flex', height: track.height }}>
      {/* Track label sidebar — sticky so labels stay pinned while clips scroll
          horizontally underneath. zIndex keeps it above the clip blocks. */}
      <div
        onClick={() => setActiveTrack(track.id)}
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 6,
          width: 160,
          flexShrink: 0,
          borderLeft: `3px solid ${kindAccent}`,
          borderRight: '1px solid var(--elah-border)',
          borderBottom: '1px solid var(--elah-border-subtle)',
          background: isActive ? 'var(--elah-bg-card)' : 'var(--elah-bg-panel)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: isActive ? 'var(--elah-text)' : 'var(--elah-text-muted)',
            fontWeight: isActive ? 600 : 500,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {track.name}
        </span>
      </div>

      {/* Clip area */}
      <div
        ref={setLaneEl}
        style={{
          position: 'relative',
          flex: 1,
          minWidth: rowMinWidth,
          borderBottom: '1px solid var(--elah-border-subtle)',
          background: isActive ? 'var(--elah-bg-secondary)' : 'var(--elah-bg)',
          overflow: 'visible',
        }}
      >
        {clips.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            zoom={zoom}
            trackHeight={track.height}
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


