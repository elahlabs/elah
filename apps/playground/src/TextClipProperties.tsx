import { useEffect, useState } from 'react'
import {
  useSelectionStore,
  useTracksStore,
  useTimelineEngine,
  type Clip,
} from '@elah/editor'

const FONTS = ['sans-serif', 'serif', 'monospace', 'Georgia', 'Impact']

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
}
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  fontFamily: 'monospace',
  width: 68,
  flexShrink: 0,
}
const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#1e1e1e',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#ddd',
  fontSize: 12,
  fontFamily: 'monospace',
  padding: '3px 6px',
}
const btnGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 3,
}

function AlignBtn({
  value,
  current,
  onClick,
}: {
  value: 'left' | 'center' | 'right'
  current: string
  onClick: () => void
}) {
  const icons: Record<string, string> = { left: '⬤▬▬', center: '▬⬤▬', right: '▬▬⬤' }
  const labels: Record<string, string> = { left: 'L', center: 'C', right: 'R' }
  return (
    <button
      title={`Align ${value}`}
      onClick={onClick}
      style={{
        padding: '3px 8px',
        fontSize: 11,
        background: current === value ? '#3b6fd4' : '#2a2a2a',
        color: current === value ? '#fff' : '#aaa',
        border: `1px solid ${current === value ? '#3b6fd4' : '#3a3a3a'}`,
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'monospace',
      }}
    >
      {labels[value]}
    </button>
  )
}

/** Returns the single selected text clip, or null. */
function useSelectedTextClip(): Clip | null {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const clips = useTracksStore((s) => s.clips)

  if (selectedClipIds.size !== 1) return null
  const [id] = selectedClipIds
  for (const trackClips of Object.values(clips)) {
    const clip = trackClips.find((c) => c.id === id && c.type === 'text')
    if (clip) return clip
  }
  return null
}

export function TextClipProperties() {
  const engine = useTimelineEngine()
  const clip = useSelectedTextClip()

  // Mirror clip state into local controlled inputs so the user's mid-edit
  // cursor position isn't reset when the engine emits 'change' and the parent
  // re-renders. Changes commit to the engine on blur / explicit submission.
  const [local, setLocal] = useState<Partial<Clip>>({})

  useEffect(() => {
    if (clip) setLocal({})  // reset local overrides whenever selection changes
  }, [clip?.id])

  if (!clip) return null

  const effective = { ...clip, ...local }

  const commit = (updates: Partial<Clip>) => {
    setLocal((prev) => ({ ...prev, ...updates }))
    engine.updateClip(clip.id, clip.trackId, updates)
  }

  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#151515',
        borderTop: '1px solid #2a2a2a',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#666',
          marginBottom: 8,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        Text Properties — {clip.name}
      </div>

      {/* Content */}
      <div style={rowStyle}>
        <span style={labelStyle}>Content</span>
        <textarea
          value={effective.content ?? ''}
          onChange={(e) => setLocal((p) => ({ ...p, content: e.target.value }))}
          onBlur={() =>
            effective.content !== clip.content &&
            commit({ content: effective.content })
          }
          rows={2}
          style={{
            ...inputStyle,
            resize: 'vertical',
            minHeight: 36,
            lineHeight: '1.4',
          }}
        />
      </div>

      {/* Font size + color */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <div style={{ ...rowStyle, flex: 1, marginBottom: 0 }}>
          <span style={labelStyle}>Size</span>
          <input
            type="number"
            min={6}
            max={4000}
            value={effective.fontSize ?? 48}
            onChange={(e) => setLocal((p) => ({ ...p, fontSize: Number(e.target.value) }))}
            onBlur={() => {
              const v = effective.fontSize ?? 48
              if (v !== (clip.fontSize ?? 48)) commit({ fontSize: v })
            }}
            style={{ ...inputStyle, width: 60 }}
          />
        </div>
        <div style={{ ...rowStyle, flex: 1, marginBottom: 0 }}>
          <span style={labelStyle}>Color</span>
          <div style={{ display: 'flex', gap: 4, flex: 1, alignItems: 'center' }}>
            <input
              type="color"
              value={effective.color ?? '#ffffff'}
              onChange={(e) => commit({ color: e.target.value })}
              style={{ width: 32, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            />
            <input
              type="text"
              value={effective.color ?? '#ffffff'}
              onChange={(e) => setLocal((p) => ({ ...p, color: e.target.value }))}
              onBlur={() => {
                const v = effective.color ?? '#ffffff'
                if (v !== (clip.color ?? '#ffffff')) commit({ color: v })
              }}
              style={{ ...inputStyle, fontFamily: 'monospace', width: 80 }}
            />
          </div>
        </div>
      </div>

      {/* Font family + weight */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <div style={{ ...rowStyle, flex: 1, marginBottom: 0 }}>
          <span style={labelStyle}>Font</span>
          <select
            value={effective.fontFamily ?? 'sans-serif'}
            onChange={(e) => commit({ fontFamily: e.target.value })}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div style={{ ...rowStyle, flex: 0, marginBottom: 0 }}>
          <span style={labelStyle}>Weight</span>
          <div style={btnGroupStyle}>
            {(['normal', 'bold'] as const).map((w) => (
              <button
                key={w}
                onClick={() => commit({ fontWeight: w })}
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: w,
                  background: (effective.fontWeight ?? 'normal') === w ? '#3b6fd4' : '#2a2a2a',
                  color: (effective.fontWeight ?? 'normal') === w ? '#fff' : '#aaa',
                  border: `1px solid ${(effective.fontWeight ?? 'normal') === w ? '#3b6fd4' : '#3a3a3a'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                {w === 'bold' ? 'B' : 'A'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Text align */}
      <div style={rowStyle}>
        <span style={labelStyle}>Align</span>
        <div style={btnGroupStyle}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <AlignBtn
              key={a}
              value={a}
              current={effective.textAlign ?? 'center'}
              onClick={() => commit({ textAlign: a })}
            />
          ))}
        </div>
      </div>

      {/* Opacity */}
      <div style={rowStyle}>
        <span style={labelStyle}>Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={effective.opacity ?? 1}
          onChange={(e) => commit({ opacity: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', width: 34, textAlign: 'right' }}>
          {Math.round((effective.opacity ?? 1) * 100)}%
        </span>
      </div>
    </div>
  )
}
