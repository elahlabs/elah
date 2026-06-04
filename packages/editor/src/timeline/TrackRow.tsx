import { memo, useState } from 'react'
import type { Track } from '../core/types'
import { useTracksStore } from '../core/stores/tracks.store'
import { useSelectionStore } from '../core/stores/selection.store'
import { ClipBlock } from './ClipBlock'
import { useTimelineDrop } from './useTimelineDrop'

interface TrackRowProps {
  track: Track
  totalFrames: number
  zoom: number
}

/**
 * A single track row — renders all clips on this track.
 * Memoized: only re-renders when this track's clips, selection, or zoom changes.
 */
export const TrackRow = memo(function TrackRow({
  track,
  totalFrames,
  zoom,
}: TrackRowProps) {
  // Selector returns undefined (stable) when no clips exist.
  // ?? [] is intentionally outside the selector — returning a new [] inside
  // would give Zustand a different reference every call and cause an infinite loop.
  const clips = useTracksStore((s) => s.clips[track.id]) ?? []
  const isActive = useSelectionStore((s) => s.activeTrackId === track.id)
  const setActiveTrack = useSelectionStore((s) => s.setActiveTrack)
  const [laneEl, setLaneEl] = useState<HTMLDivElement | null>(null)

  useTimelineDrop(track.id, laneEl)

  // Minimum pixel width so there is always a usable timeline on small screens.
  // flex:1 grows it to fill the container when the container is larger.
  const rowMinWidth = Math.max(totalFrames * zoom, 800)

  const kindAccent =
    track.kind === 'video'
      ? '#2563EB'
      : track.kind === 'audio'
        ? '#16A34A'
        : '#9333EA'

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
          borderRight: '1px solid #232938',
          borderBottom: '1px solid #1A1F2B',
          background: isActive ? '#171D2B' : '#121722',
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
            color: isActive ? '#F3F4F6' : '#A7AFBF',
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
          borderBottom: '1px solid #1A1F2B',
          background: isActive ? '#0D1017' : '#0A0D14',
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
      </div>
    </div>
  )
})
