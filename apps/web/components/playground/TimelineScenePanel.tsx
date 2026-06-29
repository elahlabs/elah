'use client'

import { memo, useEffect, useState } from 'react'
import {
  resolveTimeline,
  useTimelineEngine,
  usePlaybackStore,
  useTracksStore,
} from '@elah/editor'

/**
 * Live `resolveTimeline` output for the timeline playground (playground-only).
 *
 * The timeline playground has no renderer wired in, so instead of a preview we
 * surface the pure resolver result — the `Scene` that a renderer/export would
 * consume. It re-resolves on every frame (subscribes to `currentFrame`, so it
 * animates during playback) and on every edit (subscribes to tracks/clips).
 */
export const TimelineScenePanel = memo(function TimelineScenePanel() {
  const engine = useTimelineEngine()
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  // Drive re-resolution: currentFrame ticks during playback; tracks/clips
  // change on every edit (add / move / trim / remove).
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const tracks = useTracksStore((s) => s.tracks)
  const clips = useTracksStore((s) => s.clips)
  void tracks
  void clips

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const scene = resolveTimeline(currentFrame, engine.getProject())
  const json = JSON.stringify(scene, null, 2)

  const copy = () => {
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-3 py-1.5 bg-ed-panel/90 backdrop-blur border border-ed-border rounded-lg text-xs font-medium text-ed-text-muted hover:text-ed-text hover:border-ed-accent/50 shadow-lg transition-colors font-mono"
        title="Show resolveTimeline output"
      >
        {'{ } Scene'}
      </button>
    )
  }

  const counts: { label: string; n: number }[] = [
    { label: 'V', n: scene.videos.length },
    { label: 'A', n: scene.audios.length },
    { label: 'T', n: scene.texts.length },
    { label: 'I', n: scene.images.length },
  ]

  return (
    <aside className="absolute top-3 left-3 z-30 w-[320px] max-h-[calc(100%-1.5rem)] flex flex-col bg-ed-panel/95 backdrop-blur border border-ed-border rounded-xl shadow-2xl overflow-hidden font-sans">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ed-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ed-text">
            Scene
          </span>
          <span className="text-[9px] font-mono text-ed-text-muted">
            resolveTimeline()
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copy}
            className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
          >
            {copied ? '✓ copied' : 'copy'}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-ed-text-muted hover:text-ed-text text-base leading-none px-1 cursor-pointer"
            aria-label="Collapse scene panel"
          >
            ×
          </button>
        </div>
      </div>

      {/* Compact summary — frame + active-clip counts */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-ed-border shrink-0 text-[10px] font-mono">
        <span className="text-ed-text-muted">
          frame <span className="text-ed-text tabular-nums">{scene.frame}</span>
        </span>
        <span className="flex items-center gap-2">
          {counts.map((c) => (
            <span
              key={c.label}
              className={c.n > 0 ? 'text-ed-accent-hover' : 'text-ed-text-muted/50'}
              title={`${c.n} active ${c.label}`}
            >
              {c.label}
              <span className="tabular-nums">{c.n}</span>
            </span>
          ))}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        <pre className="text-[10px] font-mono leading-relaxed text-ed-text whitespace-pre">
          {json}
        </pre>
      </div>
    </aside>
  )
})
