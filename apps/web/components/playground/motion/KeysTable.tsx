'use client'

import { useMemo } from 'react'
import { selectionStore, usePlaybackStore, useTimelineEngine, useTracksStore } from '@elah/editor'
import { keyRows, type KeyRow } from '@/lib/motion/keysTable'

/**
 * The keys of the loaded project as a table: clip, channel, frame, value,
 * easing and the key's id. Frame and value are numbers you can edit; this is
 * the open-source way to edit keys (through the data), not a curve editor.
 */
const tones = {
  app: {
    empty: 'p-4 text-xs text-on-surface-variant',
    head: 'sticky top-0 bg-surface-container text-on-surface-variant',
    row: 'cursor-pointer border-t border-outline-variant text-on-surface hover:bg-surface-container',
    input: 'rounded border border-outline-variant bg-surface px-1.5 py-0.5',
    id: 'text-on-surface-variant',
  },
  // DESIGN.md: ink on white, muted labels, #F3E2DF outlines, blush hover.
  landing: {
    empty: 'p-4 text-[12px] text-[#1B1416]',
    head: 'sticky top-0 bg-[#FFF5F3] text-[#1B1416]',
    row: 'cursor-pointer border-t border-[#F3E2DF] text-[#1B1416] transition-colors hover:bg-[#FFF5F3]',
    input: 'rounded-[6px] border border-[#F3E2DF] bg-white px-1.5 py-0.5',
    id: 'text-[#1B1416]',
  },
} as const

export function KeysTable({ readOnly = false, tone = 'app' }: { readOnly?: boolean; tone?: keyof typeof tones }) {
  const t = tones[tone]
  const engine = useTimelineEngine()
  const clips = useTracksStore((s) => s.clips)
  const rows = useMemo(() => keyRows({ clips }), [clips])

  function edit(row: KeyRow, patch: { frame?: number; value?: number }) {
    const clip = (clips[row.trackId] ?? []).find((c) => c.id === row.clipId)
    const channels = clip?.keyframes?.channels
    const channel = channels?.[row.channel as keyof typeof channels]
    if (!clip || !channels || !channel) return
    const keys = channel.keys
      .map((k) =>
        k.id === row.keyId
          ? {
              ...k,
              ...(patch.frame !== undefined ? { frame: Math.max(0, Math.round(patch.frame)) } : {}),
              ...(patch.value !== undefined ? { value: patch.value } : {}),
            }
          : k,
      )
      .sort((a, b) => a.frame - b.frame)
    engine.updateClip(row.clipId, row.trackId, {
      keyframes: { channels: { ...channels, [row.channel]: { ...channel, keys } } },
    })
  }

  function focus(row: KeyRow) {
    selectionStore.setState({ selectedClipIds: new Set([row.clipId]) })
    usePlaybackStore.getState().setCurrentFrame(row.clipStart + row.frame)
  }

  if (rows.length === 0) {
    return <p className={t.empty}>No keyframes yet. Convert a scene to see its keys.</p>
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left font-mono text-xs">
        <thead className={t.head}>
          <tr>
            <th className="px-3 py-2 font-medium">clip</th>
            <th className="px-3 py-2 font-medium">channel</th>
            <th className="px-3 py-2 font-medium">frame</th>
            <th className="px-3 py-2 font-medium">value</th>
            <th className="px-3 py-2 font-medium">easing</th>
            <th className="px-3 py-2 font-medium">id</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.clipId}:${r.channel}:${r.keyId}`}
              onClick={() => focus(r)}
              onMouseEnter={readOnly ? () => focus(r) : undefined}
              className={t.row}
            >
              <td className="max-w-[9rem] truncate px-3 py-1.5">{r.clipName}</td>
              <td className="px-3 py-1.5">{r.channel}</td>
              <td className="px-3 py-1.5">
                {readOnly ? r.frame : <input
                  aria-label={`Frame of key ${r.keyId}`}
                  type="number"
                  className={`w-16 ${t.input}`}
                  value={r.frame}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => e.target.value !== '' && edit(r, { frame: Number(e.target.value) })}
                />}
              </td>
              <td className="px-3 py-1.5">
                {readOnly ? Number(r.value.toFixed(4)) : <input
                  aria-label={`Value of key ${r.keyId}`}
                  type="number"
                  step="any"
                  className={`w-20 ${t.input}`}
                  value={Number(r.value.toFixed(4))}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => e.target.value !== '' && edit(r, { value: Number(e.target.value) })}
                />}
              </td>
              <td className="px-3 py-1.5">{r.easing}</td>
              <td className={`px-3 py-1.5 ${t.id}`}>{r.keyId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
