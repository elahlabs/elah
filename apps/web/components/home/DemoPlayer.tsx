'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { Project } from '@elah/core'
import {
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  selectionStore,
  tracksStore,
  useKeySelectionStore,
  usePlaybackStore,
  useTimelineEngine,
  useTracksStore,
  type TimelineRef,
} from '@elah/editor'
import { loadAllFonts } from '@/lib/motion/convert'
import { stageVars } from '@/components/landing/home/stageVars'
import { drawerChannels } from '@/lib/editor/curves'
import { CurveEditor } from '@/components/playground/production/curves/CurveEditor'

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
  /**
   * Invite the visitor to retime the keys: a strip under the timeline says
   * "Drag a diamond to retime it". Grabbing anything on the timeline pauses the
   * loop (and stops autoplay from resuming it), and Reset reloads the original.
   * Under it, the curve editor for one keyed clip at a time, picked by a row of
   * tabs (or by clicking a diamond on that clip).
   */
  editableKeys?: boolean
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

function Inner({ project, preview = true, timeline = true, timelineHeight = 150, showKeys = true, loop = true, stillFrame = 0, label, aspect, editableKeys = false }: DemoPlayerProps) {
  const engine = useTimelineEngine()
  const root = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactory = useRef(createDefaultDemuxerFactory())
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const [reduced, setReduced] = useState(false)
  const [ready, setReady] = useState(false)
  /** The visitor has touched the timeline: keep it paused and offer Reset. */
  const [edited, setEdited] = useState(false)
  const [version, setVersion] = useState(0)
  // The timeline's container, so the curve editor follows this timeline and not another on the page.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const clipsByTrack = useTracksStore((s) => s.clips)
  const keyedClips = useMemo(
    () =>
      Object.values(clipsByTrack)
        .flat()
        .filter((c) => drawerChannels(c).length > 0)
        .sort((a, b) => a.startFrame - b.startFrame),
    [clipsByTrack],
  )
  const [curveClipId, setCurveClipId] = useState<string | null>(null)
  const keyClipId = useKeySelectionStore((s) => s.clipId)
  // Clicking a diamond on the timeline shows that clip's curves.
  useEffect(() => {
    if (keyClipId && keyedClips.some((c) => c.id === keyClipId)) setCurveClipId(keyClipId)
  }, [keyClipId, keyedClips])
  const curveClip = keyedClips.find((c) => c.id === curveClipId) ?? keyedClips[0]

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
    // `version` bumps on Reset, reloading the original project.
  }, [engine, project, loop, stillFrame, showKeys, version])

  // Play while on screen, pause when off. Reduced motion never autoplays.
  useEffect(() => {
    const el = root.current
    if (!el || !ready || reduced || !loop || edited || typeof IntersectionObserver === 'undefined') return
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
  }, [ready, reduced, loop, edited])

  /**
   * The editor's stores (clips, selection, playback) are global, one set per
   * page, and every demo on the page writes its project into them as it loads:
   * the last one to load wins. This timeline reads those stores, so when it is
   * looked at again it re-publishes its own project, edits and undo included,
   * if another demo has replaced it.
   */
  const reclaim = useCallback(() => {
    if (!ready) return
    const own = Object.values(engine.getProject().clips).flat()
    const shown = new Set(
      Object.values(tracksStore.getState().clips)
        .flat()
        .map((c) => c.id),
    )
    const selected = selectionStore.getState().selectedClipIds
    const ours = own.length === shown.size && own.every((c) => shown.has(c.id))
    if (ours && (!showKeys || own.every((c) => selected.has(c.id)))) return
    engine.loadProject(engine.getProject(), { transport: 'keep', history: 'keep' })
    if (showKeys) selectionStore.setState({ selectedClipIds: new Set(own.map((c) => c.id)) })
    usePlaybackStore.setState({ loop })
    requestAnimationFrame(() => timelineRef.current?.fitToWindow())
  }, [ready, engine, showKeys, loop])

  // Scrolling back to this demo takes the stores back.
  useEffect(() => {
    const el = root.current
    if (!el || !ready || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries[entries.length - 1]?.isIntersecting) reclaim()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ready, reclaim])

  function grab() {
    reclaim()
    if (!editableKeys) return
    usePlaybackStore.getState().pause()
    setEdited(true)
  }

  function reset() {
    setEdited(false)
    setReady(false)
    setVersion((v) => v + 1)
  }

  return (
    <div ref={root} onPointerEnter={reclaim} className="elah-root flex min-w-0 flex-col bg-[#170F10]" role="group" aria-label={label} style={stageVars}>
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
      {timeline && (
        // Capture phase, so the pause happens before the timeline's own drag starts.
        <div ref={setRootEl} onPointerDownCapture={grab} className="flex min-w-0 flex-col">
          <Timeline ref={timelineRef} fps={project.fps} style={{ height: timelineHeight, flexShrink: 0, minWidth: 0 }} />
        </div>
      )}
      {timeline && editableKeys && (
        <div className="flex items-center justify-between gap-3 border-t border-[#2E2E33] px-4 py-2 font-[family-name:var(--font-geist-mono),ui-monospace,monospace] text-[11px] uppercase tracking-[0.14em] text-[#9A9993]">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-[7px] w-[7px] rotate-45 bg-[#F0EFEA]" />
            {edited ? 'Edited. Press play to see your timing.' : 'Drag a diamond to retime it'}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => usePlaybackStore.getState().togglePlayPause()}
              aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
              className="grid h-8 w-8 place-items-center border border-[#2E2E33] text-[#F0EFEA] transition-colors hover:bg-[#F0EFEA] hover:text-[#0E0E10]"
            >
              {isPlaying ? <Pause size={14} strokeWidth={2} aria-hidden /> : <Play size={14} strokeWidth={2} aria-hidden />}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={!edited}
              className="flex h-8 items-center gap-2 border border-[#2E2E33] px-3 uppercase tracking-[0.14em] text-[#F0EFEA] transition-colors hover:bg-[#F0EFEA] hover:text-[#0E0E10] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#F0EFEA]"
            >
              <RotateCcw size={13} strokeWidth={2} aria-hidden />
              Reset
            </button>
          </span>
        </div>
      )}
      {timeline && editableKeys && curveClip && (
        <div onPointerDownCapture={grab} className="flex min-w-0 flex-col border-t border-[#2E2E33]">
          <div role="tablist" aria-label="Clip curves" className="flex min-w-0 items-stretch overflow-x-auto font-[family-name:var(--font-geist-mono),ui-monospace,monospace] text-[11px] uppercase tracking-[0.12em]">
            {keyedClips.map((c) => {
              const on = c.id === curveClip.id
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setCurveClipId(c.id)}
                  className={`shrink-0 border-r border-[#2E2E33] px-4 py-2 uppercase tracking-[0.12em] transition-colors ${on ? 'bg-[#FF003C] text-[#0E0E10]' : 'text-[#9A9993] hover:bg-[#242428] hover:text-[#F0EFEA]'}`}
                >
                  {c.name ?? c.type}
                </button>
              )
            })}
          </div>
          <CurveEditor clipId={curveClip.id} root={rootEl} pinned />
        </div>
      )}
    </div>
  )
}
