'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { EditorProvider, Preview, Timeline, createDefaultDemuxerFactory, usePlaybackStore, useTimelineEngine, type TimelineRef } from '@elah/editor'
import { STARTERS } from '@/lib/motion/starters'
import { titleCardSpec, titleCardSpecSource } from '@/lib/demos/titleCardSpec'
import { ConvertError, convertSpec, type Converted } from '@/lib/motion/convert'
import { getTitleCard } from '@/lib/motion/titleCard'
import { KeysTable } from '@/components/playground/motion/KeysTable'
import { stageVars } from '@/components/landing/home/stageVars'
import { mono, outline, sans } from '@/components/landing/home/ui'

type Source = 'html' | 'spec'
const TITLE_CARD = STARTERS[0]

const colHead = `border-b border-[var(--lp-line)] px-4 py-3 text-[12px] text-[var(--lp-muted)] ${mono}`

/**
 * Source, Keys, Timeline: the same animation read three ways (brief 6.2). Read
 * only. Hovering a row in the Keys column moves the playhead to that key and
 * selects its clip, so the diamond lights up and the preview shows the frame.
 */
export default function BindingExplainer() {
  const [source, setSource] = useState<Source>('html')
  const [converted, setConverted] = useState<Converted | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setConverted(null)
    setError(null)
    ;(async () => {
      try {
        const c = source === 'html' ? await getTitleCard() : convertSpec(titleCardSpec)
        if (!cancelled) setConverted(c)
      } catch (e) {
        if (!cancelled) setError(e instanceof ConvertError || e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source])

  const code = useMemo(() => (source === 'html' ? `${TITLE_CARD.html}\n\n/* css */\n${TITLE_CARD.css}` : titleCardSpecSource), [source])

  return (
    <EditorProvider fps={TITLE_CARD.fps} stage={TITLE_CARD.stage} defaultTrackHeight={36} initialTracks={[]}>
      <div className={`overflow-hidden bg-[var(--lp-card)] ${outline}`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--lp-line)] p-3">
          <div className="flex gap-1" role="tablist" aria-label="Source language">
            {(['html', 'spec'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={`px-4 py-[7px] text-[14px] font-semibold transition-colors ${sans} ${
                  source === s ? 'bg-[var(--lp-ink)] text-[var(--lp-paper)]' : 'bg-transparent text-[var(--lp-muted)] hover:bg-[var(--lp-paper)] hover:text-[var(--lp-ink)]'
                }`}
              >
                {s === 'html' ? 'HTML + CSS' : 'VideoSpec'}
              </button>
            ))}
          </div>
          <span className={`px-[10px] py-[3px] text-[11px] text-[var(--lp-muted)] ${mono} ${outline}`}>Experimental</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3">
          <div className="min-w-0 border-b border-[var(--lp-line)] lg:border-b-0 lg:border-r">
            <div className={colHead}>Source</div>
            <pre tabIndex={0} aria-label="Scene source" className={`m-0 h-64 overflow-auto p-4 text-[12px] leading-[20px] text-[var(--lp-ink)] ${mono}`}>
              <code>{code}</code>
            </pre>
          </div>
          <div className="min-w-0 border-b border-[var(--lp-line)] lg:border-b-0 lg:border-r">
            <div className={colHead}>Keys</div>
            <div className="h-64">
              {error ? <p className={`m-0 p-4 text-[13px] text-[#D10030] ${sans}`}>{error}</p> : <KeysTable readOnly tone="landing" />}
            </div>
          </div>
          <div className="min-w-0">
            <div className={colHead}>Timeline</div>
            <Stage converted={converted} />
          </div>
        </div>
      </div>
    </EditorProvider>
  )
}

function Stage({ converted }: { converted: Converted | null }) {
  const engine = useTimelineEngine()
  const demuxerFactory = useRef(createDefaultDemuxerFactory())
  const timelineRef = useRef<TimelineRef>(null)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const toggle = usePlaybackStore((s) => s.togglePlayPause)

  useEffect(() => {
    if (!converted) return
    usePlaybackStore.getState().pause()
    usePlaybackStore.getState().setCurrentFrame(0)
    engine.loadProject(converted.project)
    requestAnimationFrame(() => requestAnimationFrame(() => timelineRef.current?.fitToWindow()))
  }, [engine, converted])

  return (
    <div className="elah-root flex h-64 flex-col bg-[var(--lp-ink)]" style={stageVars}>
      <div className="relative min-h-0 flex-1 bg-[var(--lp-ink)]">
        <Preview demuxerFactory={demuxerFactory.current} style={{ width: '100%', height: '100%' }} />
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center bg-[var(--lp-card)] text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-paper)]"
        >
          {isPlaying ? <Pause size={15} strokeWidth={2} aria-hidden /> : <Play size={15} strokeWidth={2} aria-hidden />}
        </button>
      </div>
      <Timeline ref={timelineRef} fps={TITLE_CARD.fps} style={{ height: 110, flexShrink: 0, minWidth: 0 }} />
    </div>
  )
}
