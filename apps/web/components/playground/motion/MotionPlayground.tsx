'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileJson, Pause, Play, RefreshCw, Square } from 'lucide-react'
import {
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  lazyExportVideo,
  serializeProject,
  usePlaybackStore,
  useTimelineEngine,
  type TimelineRef,
} from '@elah/editor'
import { detectExportSupport } from '@elah/core'
import { STARTERS, type Starter } from '@/lib/motion/starters'
import { ConvertError, convertHtml, FONT_BASE_URL, loadAllFonts, type Converted, type ReportItem } from '@/lib/motion/convert'
import { KeysTable } from './KeysTable'

type Result =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'ready'; converted: Converted }
  | { status: 'failed'; message: string; report: ReportItem[] }

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function MotionPlayground() {
  const [starter, setStarter] = useState<Starter>(STARTERS[0])
  const [html, setHtml] = useState(STARTERS[0].html)
  const [css, setCss] = useState(STARTERS[0].css)
  const [tab, setTab] = useState<'html' | 'css'>('html')
  const [result, setResult] = useState<Result>({ status: 'idle' })

  const convert = useCallback(async (src: { html: string; css: string }, s: Starter) => {
    setResult({ status: 'working' })
    try {
      const converted = await convertHtml({ ...src, durationSeconds: s.durationSeconds, stage: s.stage, fps: s.fps })
      setResult({ status: 'ready', converted })
    } catch (e) {
      setResult({
        status: 'failed',
        message: e instanceof Error ? e.message : String(e),
        report: e instanceof ConvertError ? e.report : [],
      })
    }
  }, [])

  // Convert the first starter once on mount so the page opens with something to look at.
  const first = useRef(true)
  useEffect(() => {
    if (!first.current) return
    first.current = false
    void convert({ html: STARTERS[0].html, css: STARTERS[0].css }, STARTERS[0])
  }, [convert])

  function pick(id: string) {
    const s = STARTERS.find((x) => x.id === id)
    if (!s) return
    setStarter(s)
    setHtml(s.html)
    setCss(s.css)
    void convert({ html: s.html, css: s.css }, s)
  }

  const ready = result.status === 'ready' ? result.converted : null

  return (
    <EditorProvider fps={starter.fps} stage={starter.stage} defaultTrackHeight={36} initialTracks={[]}>
      <div className="elah-root grid min-h-full grid-cols-1 gap-px bg-outline-variant lg:h-full lg:grid-cols-2">
        {/* Left: the code */}
        <section className="flex min-h-[24rem] min-w-0 flex-col bg-surface" aria-label="Scene code">
          <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant p-3">
            <label className="text-xs text-on-surface-variant" htmlFor="starter">
              Starter scene
            </label>
            <select
              id="starter"
              value={starter.id}
              onChange={(e) => pick(e.target.value)}
              className="border border-outline-variant bg-surface-container px-2 py-1 text-xs text-on-surface"
            >
              {STARTERS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="border border-outline-variant px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider text-on-surface-variant">
              Experimental
            </span>
            <div className="ml-auto flex gap-1" role="tablist" aria-label="Source">
              {(['html', 'css'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className="px-2 py-1 font-mono text-xs text-on-surface-variant aria-selected:bg-surface-container aria-selected:text-on-surface"
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              onClick={() => void convert({ html, css }, starter)}
              disabled={result.status === 'working'}
              className="inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-medium text-on-primary disabled:opacity-60"
            >
              <RefreshCw size={13} /> Convert
            </button>
          </div>
          <textarea
            aria-label={tab === 'html' ? 'HTML source' : 'CSS source'}
            spellCheck={false}
            value={tab === 'html' ? html : css}
            onChange={(e) => (tab === 'html' ? setHtml(e.target.value) : setCss(e.target.value))}
            className="min-h-[14rem] flex-1 resize-none overflow-auto whitespace-pre bg-surface p-3 font-mono text-xs leading-relaxed text-on-surface outline-none"
          />
          <Report result={result} />
        </section>

        {/* Right: preview, timeline, keys */}
        <section className="flex min-h-0 min-w-0 flex-col bg-surface" aria-label="Preview and timeline">
          <Stage converted={ready} title={starter.id} />
        </section>
      </div>
    </EditorProvider>
  )
}

function Report({ result }: { result: Result }) {
  const items = result.status === 'ready' ? result.converted.report : result.status === 'failed' ? result.report : []
  return (
    <div className="max-h-48 overflow-auto border-t border-outline-variant p-3 text-xs" role="status" aria-live="polite">
      <div className="mb-1 font-medium text-on-surface">
        {result.status === 'working' ? 'Converting…' : result.status === 'failed' ? result.message : 'Conversion report'}
      </div>
      <ul className="space-y-1 font-mono text-on-surface-variant">
        {items.map((i, n) => (
          <li key={n} className={i.severity === 'refused' ? 'text-error' : i.severity === 'warn' ? 'text-amber-500' : undefined}>
            [{i.severity}] {i.where}: {i.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stage({ converted, title }: { converted: Converted | null; title: string }) {
  const engine = useTimelineEngine()
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactory = useRef(createDefaultDemuxerFactory())
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const toggle = usePlaybackStore((s) => s.togglePlayPause)
  const [status, setStatus] = useState<{ text: string; progress?: number } | null>(null)
  const exporting = useRef<AbortController | null>(null)
  // Probed after mount so server and client markup agree.
  const [support, setSupport] = useState<ReturnType<typeof detectExportSupport> | null>(null)
  useEffect(() => setSupport(detectExportSupport()), [])

  useEffect(() => {
    if (!converted) return
    usePlaybackStore.getState().pause()
    usePlaybackStore.getState().setCurrentFrame(0)
    engine.loadProject(converted.project)
    requestAnimationFrame(() => requestAnimationFrame(() => timelineRef.current?.fitToWindow()))
  }, [engine, converted])

  const onExport = useCallback(async () => {
    if (exporting.current) {
      exporting.current.abort()
      return
    }
    const ctl = new AbortController()
    exporting.current = ctl
    usePlaybackStore.getState().pause()
    setStatus({ text: 'Exporting MP4: starting', progress: 0 })
    try {
      await loadAllFonts()
      const blob = await lazyExportVideo(engine.getProject(), {
        signal: ctl.signal,
        fonts: { baseUrl: FONT_BASE_URL },
        onProgress: ({ frame, totalFrames }) =>
          setStatus({ text: `Exporting MP4: frame ${frame} of ${totalFrames}`, progress: totalFrames ? frame / totalFrames : 0 }),
      })
      saveBlob(`${title}.mp4`, blob)
      setStatus({ text: `Exported ${title}.mp4 in your browser. Nothing was uploaded.` })
    } catch (e) {
      setStatus({ text: ctl.signal.aborted ? 'Export cancelled.' : `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      exporting.current = null
    }
  }, [engine, title])

  const onDownload = useCallback(() => {
    saveBlob(`${title}.elah.json`, new Blob([serializeProject(engine)], { type: 'application/json' }))
  }, [engine, title])

  return (
    <>
      <div className="relative h-56 shrink-0 bg-black sm:h-72 lg:h-80">
        <Preview demuxerFactory={demuxerFactory.current} style={{ width: '100%', height: '100%' }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant p-2">
        <button onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'} className="p-2 text-on-surface hover:bg-surface-container">
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          onClick={() => {
            usePlaybackStore.getState().pause()
            usePlaybackStore.getState().setCurrentFrame(0)
          }}
          aria-label="Stop"
          className="p-2 text-on-surface hover:bg-surface-container"
        >
          <Square size={14} />
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={onDownload}
            disabled={!converted}
            className="inline-flex items-center gap-1.5 border border-outline-variant px-3 py-1.5 text-xs text-on-surface disabled:opacity-50"
          >
            <FileJson size={13} /> Download project JSON
          </button>
          <button
            onClick={onExport}
            disabled={!converted || (support !== null && !support.ok)}
            className="inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-medium text-on-primary disabled:opacity-50"
          >
            <Download size={13} /> Export MP4
          </button>
        </div>
      </div>
      {support && !support.ok && (
        <p className="border-b border-outline-variant p-2 text-xs text-amber-500" role="note">
          {support.message}
        </p>
      )}
      {status && (
        <div className="border-b border-outline-variant p-2 text-xs text-on-surface-variant" role="status">
          {status.text}
          {status.progress !== undefined && (
            <span className="mt-1 block h-1 overflow-hidden bg-surface-container">
              <i className="block h-full bg-primary" style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </span>
          )}
        </div>
      )}
      <Timeline ref={timelineRef} fps={converted?.fps ?? 30} style={{ height: 150, flexShrink: 0, minWidth: 0 }} />
      <div className="h-56 shrink-0 border-t border-outline-variant lg:h-auto lg:min-h-0 lg:flex-1">
        <KeysTable />
      </div>
    </>
  )
}
