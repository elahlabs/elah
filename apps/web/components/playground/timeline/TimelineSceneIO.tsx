'use client'

import { memo, useState } from 'react'
import {
  resolveTimeline,
  useTimelineEngine,
  usePlaybackStore,
  useTracksStore,
} from '@elah/editor'

/**
 * Center "resolver in / out" view for the timeline playground.
 *
 * Visualises the single most important function in the engine:
 *   resolveTimeline(frame, project) → Scene
 *
 * Left card = the raw INPUT (current frame + the Project the engine owns).
 * Right card = the pure OUTPUT (the Scene a renderer/export would consume).
 *
 * Both re-compute on every frame (subscribes to `currentFrame`, so it animates
 * during playback) and on every edit (subscribes to tracks/clips).
 */

function JsonCard({
  title,
  subtitle,
  data,
}: {
  title: string
  subtitle: string
  data: unknown
}) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(data, null, 2)

  const copy = () => {
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex-1 min-w-0 max-w-[460px] flex flex-col bg-ed-panel/95 border border-ed-border rounded-xl shadow-2xl overflow-hidden font-sans">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ed-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ed-text">
            {title}
          </span>
          <span className="text-[9px] font-mono text-ed-text-muted">{subtitle}</span>
        </div>
        <button
          onClick={copy}
          className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
        <pre className="text-[10px] font-mono leading-relaxed text-ed-text whitespace-pre">
          {json}
        </pre>
      </div>
    </div>
  )
}

export const TimelineSceneIO = memo(function TimelineSceneIO() {
  const engine = useTimelineEngine()

  // Drive re-resolution: currentFrame ticks during playback; tracks/clips
  // change on every edit (add / move / trim / remove).
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const tracks = useTracksStore((s) => s.tracks)
  const clips = useTracksStore((s) => s.clips)
  void tracks
  void clips

  const project = engine.getProject()
  const scene = resolveTimeline(currentFrame, project)

  return (
    <div className="flex-1 min-h-0 flex items-stretch justify-center gap-3 px-4 py-4">
      <JsonCard title="Input" subtitle="frame + project" data={{ frame: currentFrame, project }} />

      {/* The function that turns one into the other. */}
      <div className="shrink-0 self-center flex flex-col items-center gap-1 text-ed-text-muted">
        <span className="text-[9px] font-mono whitespace-nowrap">resolveTimeline()</span>
        <span className="text-xl leading-none text-ed-accent">→</span>
      </div>

      <JsonCard title="Output" subtitle="Scene" data={scene} />
    </div>
  )
})
