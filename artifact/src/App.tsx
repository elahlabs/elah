import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, Moon, Pause, Play, Redo2, Square, Sun, Undo2 } from 'lucide-react'
import {
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  lazyExportVideo,
  serializeProject,
  framesToTimecode,
  usePlaybackStore,
  useTimelineEngine,
  useTracksStore,
  type TimelineRef,
} from '@elah/editor'
import { ClipProperties } from '@/components/playground/production/properties/ClipProperties'
import { CurveEditor } from '@/components/playground/production/curves/CurveEditor'
import { TimelineControls } from '@/components/playground/shared/TimelineControls'
import { saveFile } from './download'
import { convert, fontBaseUrl, InputError, loadAllFonts, loadInput, type Converted, type Issue } from './input'

type Load =
  | { status: 'loading' }
  | { status: 'failed'; message: string; issues: Issue[] }
  | { status: 'ready'; converted: Converted }

type Mode = 'preview' | 'edit'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'elah-video'

export function App() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const input = await loadInput()
        const converted = await convert(input)
        await loadAllFonts()
        if (!cancelled) {
          document.title = converted.title
          setLoad({ status: 'ready', converted })
        }
      } catch (e) {
        if (cancelled) return
        const issues = e instanceof InputError ? e.issues : []
        setLoad({ status: 'failed', message: e instanceof Error ? e.message : String(e), issues })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (load.status === 'loading') return <p className="boot">Loading the video</p>
  if (load.status === 'failed') {
    return (
      <div className="fatal">
        <h1>This video could not be opened</h1>
        <pre>{load.message}</pre>
        <IssueList issues={load.issues} open />
      </div>
    )
  }
  return <Editor converted={load.converted} />
}

function IssueList({ issues, open }: { issues: Issue[]; open?: boolean }) {
  if (issues.length === 0) return null
  const text = issues.map((i) => `[${i.severity}] ${i.where}: ${i.message}`).join('\n')
  const errs = issues.filter((i) => i.severity === 'error').length
  return (
    <details className="issues" open={open}>
      <summary>
        Issues ({issues.length}
        {errs ? `, ${errs} error${errs > 1 ? 's' : ''}` : ''})
      </summary>
      <ul>
        {issues.map((i, n) => (
          <li key={n} className={i.severity === 'error' ? 'err' : i.severity === 'warn' ? 'wrn' : undefined}>
            [{i.severity}] {i.where}: {i.message}
          </li>
        ))}
      </ul>
      <button type="button" className="btn copy" onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)}>
        Copy issues
      </button>
    </details>
  )
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('elah-theme') ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  const toggle = useCallback(() => {
    const current = document.documentElement.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const next = current === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem('elah-theme', next)
    } catch {
      /* storage can be blocked; the toggle still works for this session */
    }
  }, [])
  return [theme, toggle]
}

function Editor({ converted }: { converted: Converted }) {
  return (
    <EditorProvider
      fps={converted.fps}
      stage={converted.stage}
      defaultTrackHeight={36}
      initialTracks={[]}
    >
      <Shell converted={converted} />
    </EditorProvider>
  )
}

function Shell({ converted }: { converted: Converted }) {
  const engine = useTimelineEngine()
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactory = useRef(createDefaultDemuxerFactory())
  const [mode, setMode] = useState<Mode>('preview')
  const [, toggleTheme] = useTheme()
  const [dark, setDark] = useState(true)
  const [status, setStatus] = useState<{ text: string; progress?: number; link?: string } | null>(null)
  const exporting = useRef<AbortController | null>(null)

  // Hand the converted project to the fresh engine once (loadProject starts with an empty undo stack).
  const laid = useRef(false)
  useEffect(() => {
    if (laid.current) return
    laid.current = true
    engine.loadProject(converted.project)
    ;(window as unknown as { __elah?: unknown }).__elah = { engine } // handle for browser checks
  }, [engine, converted])

  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute('data-theme') !== 'light' && (document.documentElement.getAttribute('data-theme') === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches))
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  const edit = mode === 'edit'
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 800px)').matches)
  useEffect(() => {
    const mq = matchMedia('(max-width: 800px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const canUndo = useTracksStore((s) => s.canUndo)
  const canRedo = useTracksStore((s) => s.canRedo)

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
      const blob = await lazyExportVideo(engine.getProject(), {
        signal: ctl.signal,
        fonts: { baseUrl: fontBaseUrl() },
        onProgress: ({ frame, totalFrames }) =>
          setStatus({ text: `Exporting MP4: frame ${frame} of ${totalFrames}`, progress: totalFrames ? frame / totalFrames : 0 }),
      })
      const route = await saveFile(`${slug(converted.title)}.mp4`, blob)
      const mb = (blob.size / 1048576).toFixed(2)
      setStatus({ text: `Exported ${slug(converted.title)}.mp4 (${mb} MB, saved by ${route === 'capability' ? 'the artifact downloads capability' : 'a browser download'}).` })
      ;(window as unknown as { __elahLastExport?: { size: number; type: string; route: string } }).__elahLastExport = { size: blob.size, type: blob.type, route }
    } catch (e) {
      setStatus({ text: ctl.signal.aborted ? 'Export cancelled.' : `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      exporting.current = null
    }
  }, [engine, converted.title])

  const onOpenInElah = useCallback(async () => {
    const json = serializeProject(engine)
    const route = await saveFile(`${slug(converted.title)}.elah.json`, new Blob([json], { type: 'application/json' }))
    setStatus({
      text: `Saved ${slug(converted.title)}.elah.json (${route === 'capability' ? 'artifact download' : 'browser download'}). Open it in the Elah editor: `,
      link: 'https://elah.dev/playground/production',
    })
  }, [engine, converted.title])

  const issues = converted.issues
  return (
    <div className={`app elah-root`} data-mode={mode} data-dark={dark ? '1' : '0'}>
      <header className="hdr">
        <span className="brand"><i aria-hidden />Elah</span>
        <span className="title" title={converted.title}>{converted.title}</span>
        <div className="hdr-actions">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!edit} onClick={() => setMode('preview')}>Preview</button>
            <button type="button" aria-pressed={edit} onClick={() => setMode('edit')}>Edit</button>
          </div>
          <button type="button" className="btn icon" aria-label="Toggle light and dark" title="Toggle light and dark" onClick={toggleTheme}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="btn" onClick={onOpenInElah} title="Save the project as .elah.json to open in Elah">
            <ExternalLink size={14} /> Open in Elah
          </button>
          <button type="button" className="btn primary" onClick={onExport} data-testid="export">
            <Download size={14} /> {exporting.current ? 'Cancel export' : 'Export MP4'}
          </button>
        </div>
      </header>

      <div className={`main${edit ? ' edit' : ''}`}>
        <div className="stage">
          <Preview demuxerFactory={demuxerFactory.current} style={{ width: '100%', height: '100%' }} />
        </div>
        <Transport showHistory={edit} canUndo={canUndo} canRedo={canRedo} fps={converted.fps} />
        <div className="timeline-wrap">
          {edit && <TimelineControls timelineRef={timelineRef} compact={narrow} />}
          <Timeline
            ref={timelineRef}
            fps={converted.fps}
            sidebarWidth={narrow ? 48 : undefined}
            compactSidebar={narrow}
            style={{ height: narrow ? 158 : edit ? 200 : 150, flexShrink: 0, minWidth: 0 }}
          />
          {edit && <CurveEditor />}
        </div>
        {edit && (
          <aside className="props" aria-label="Properties">
            <ClipProperties />
          </aside>
        )}
      </div>

      {status && (
        <div className="status" role="status">
          <span>{status.text}{status.link && <a href={status.link} target="_blank" rel="noopener noreferrer">elah.dev/playground/production</a>}</span>
          {status.progress !== undefined && <span className="bar"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></span>}
        </div>
      )}
      <IssueList issues={issues} open={issues.some((i) => i.severity === 'error')} />
    </div>
  )
}

function Transport({ showHistory, canUndo, canRedo, fps }: { showHistory: boolean; canUndo: boolean; canRedo: boolean; fps: number }) {
  const engine = useTimelineEngine()
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const toggle = usePlaybackStore((s) => s.togglePlayPause)
  const total = useTracksStore((s) => s.totalFrames)
  const cur = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const paint = (f: number) => {
      if (cur.current) cur.current.textContent = framesToTimecode(f, fps)
    }
    paint(usePlaybackStore.getState().currentFrame)
    return usePlaybackStore.subscribe((s) => paint(s.currentFrame))
  }, [fps])
  const stop = useCallback(() => {
    usePlaybackStore.getState().pause()
    usePlaybackStore.getState().setCurrentFrame(0)
  }, [])
  const totalLabel = useMemo(() => framesToTimecode(Math.max(total, 1), fps), [total, fps])
  return (
    <div className="transport">
      <button type="button" className="btn icon" onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'} title="Play / Pause (Space)" data-testid="play">
        {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <button type="button" className="btn icon" onClick={stop} aria-label="Stop" title="Stop">
        <Square size={13} fill="currentColor" />
      </button>
      <span className="time"><b ref={cur}>00:00:00:00</b> | {totalLabel}</span>
      <span className="spacer" />
      {showHistory && (
        <>
          <button type="button" className="btn icon" disabled={!canUndo} onClick={() => engine.undo()} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
          <button type="button" className="btn icon" disabled={!canRedo} onClick={() => engine.redo()} aria-label="Redo" title="Redo (Ctrl+Y)"><Redo2 size={15} /></button>
        </>
      )}
    </div>
  )
}
