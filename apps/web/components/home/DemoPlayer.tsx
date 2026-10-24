'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { Project } from '@elah/core'
import {
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  selectionStore,
  usePlaybackStore,
  useTimelineEngine,
  type TimelineRef,
} from '@elah/editor'
import { loadAllFonts } from '@/lib/motion/convert'
import { stageVars } from '@/components/landing/home/stageVars'

export interface DemoPlayerProps {
  /** The project to play. */
  project: Project
  /** Show the preview canvas. Off gives a timeline-only view. */
  preview?: boolean
  /** Show the timeline strip under the preview. */
  timeline?: boolean
  timelineHeight?: number
  /** Select every clip so the keyframe diamonds draw on the timeline. */
  showKeys?: boolean
  /** Loop playback and start it when the demo is on screen. Reduced motion shows a still frame instead. */
  loop?: boolean
  /** Frame to show as the still when motion is reduced or before play. */
  stillFrame?: number
  label: string
  /** CSS aspect ratio of the preview box. */
  aspect?: string
}

/**
 * One engine demo: `EditorProvider` + `Preview` (+ `Timeline`) on a project.
 * Everything on screen is rendered by the engine, not recorded. It plays only
 * while on screen, and under `prefers-reduced-motion` it holds a still frame
 * with a play button.
 */
export default function DemoPlayer(props: DemoPlayerProps) {
  const { project } = props
  return (
    <EditorProvider fps={project.fps} stage={project.stage} defaultTrackHeight={28} initialTracks={[]}>
      <Inner {...props} />
    </EditorProvider>
  )
}

function Inner({ project, preview = true, timeline = true, timelineHeight = 150, showKeys = true, loop = true, stillFrame = 0, label, aspect }: DemoPlayerProps) {
  const engine = useTimelineEngine()
  const root = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactory = useRef(createDefaultDemuxerFactory())
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const [reduced, setReduced] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  // Fonts first, so text is drawn in its real face from the first frame.
  useEffect(() => {
    let cancelled = false
    void loadAllFonts().then(() => {
      if (cancelled) return
      const pb = usePlaybackStore.getState()
      pb.pause()
      engine.loadProject(project)
      usePlaybackStore.setState({ loop })
      pb.setCurrentFrame(stillFrame)
      if (showKeys) {
        const ids = Object.values(engine.getProject().clips).flat().map((c) => c.id)
        selectionStore.setState({ selectedClipIds: new Set(ids) })
      }
      setReady(true)
      // Show the whole piece on the strip, not just its first seconds.
      requestAnimationFrame(() => requestAnimationFrame(() => timelineRef.current?.fitToWindow()))
    })
    return () => {
      cancelled = true
    }
  }, [engine, project, loop, stillFrame, showKeys])

  // Play while on screen, pause when off. Reduced motion never autoplays.
  useEffect(() => {
    const el = root.current
    if (!el || !ready || reduced || !loop || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const on = entries[entries.length - 1]?.isIntersecting
      const pb = usePlaybackStore.getState()
      if (on && !pb.isPlaying) pb.play()
      if (!on && pb.isPlaying) pb.pause()
    })
    io.observe(el)
    return () => {
      io.disconnect()
      usePlaybackStore.getState().pause()
    }
  }, [ready, reduced, loop])

  return (
    <div ref={root} className="elah-root flex min-w-0 flex-col bg-[#170F10]" role="group" aria-label={label} style={stageVars}>
      {preview && (
        <div className="relative w-full bg-[#170F10]" style={{ aspectRatio: aspect ?? `${project.stage.width} / ${project.stage.height}` }}>
          <Preview demuxerFactory={demuxerFactory.current} style={{ width: '100%', height: '100%' }} />
          {(reduced || !loop) && (
            <button
              type="button"
              onClick={() => usePlaybackStore.getState().togglePlayPause()}
              aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
              className="absolute bottom-[10px] left-[10px] grid h-9 w-9 place-items-center bg-white text-[#1B1416] transition-colors hover:bg-[#FFF5F3]"
            >
              {isPlaying ? <Pause size={15} strokeWidth={2} aria-hidden /> : <Play size={15} strokeWidth={2} aria-hidden />}
            </button>
          )}
        </div>
      )}
      {timeline && <Timeline ref={timelineRef} fps={project.fps} style={{ height: timelineHeight, flexShrink: 0, minWidth: 0 }} />}
    </div>
  )
}
