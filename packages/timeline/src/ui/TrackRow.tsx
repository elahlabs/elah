import { memo } from 'react'
import type { Track } from '../types'
import { useTracksStore } from '../stores/tracks.store'
import { useSelectionStore } from '../stores/selection.store'
import { ClipBlock } from './ClipBlock'

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

  // Minimum pixel width so there is always a usable timeline on small screens.
  // flex:1 grows it to fill the container when the container is larger.
  const rowMinWidth = Math.max(totalFrames * zoom, 800)

  const kindAccent =
    track.kind === 'video'
      ? '#3b6fd4'
      : track.kind === 'audio'
        ? '#2da34f'
        : '#9b59b6'

  return (
    <div style={{ display: 'flex', height: track.height }}>
      {/* Track label sidebar */}
      <div
        onClick={() => setActiveTrack(track.id)}
        style={{
          width: 160,
          flexShrink: 0,
          borderLeft: `3px solid ${kindAccent}`,
          borderRight: '1px solid #2a2a2a',
          borderBottom: '1px solid #2a2a2a',
          background: isActive ? '#2a2a3a' : '#1c1c1c',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: isActive ? '#fff' : '#aaa',
            fontFamily: 'sans-serif',
            fontWeight: isActive ? 600 : 400,
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
        style={{
          position: 'relative',
          flex: 1,
          minWidth: rowMinWidth,
          borderBottom: '1px solid #2a2a2a',
          background: isActive ? '#1e1e28' : '#161616',
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
