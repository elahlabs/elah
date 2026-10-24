import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Download, ExternalLink, FileJson, Maximize2, PencilLine, Minimize2, Moon, Pause, Play, Redo2, Square, Sun, Undo2 } from 'lucide-react'
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
  useSelectionStore,
  type Project,
  type TimelineRef,
} from '@elah/editor'
import {
  commitAll,
  compoundForClip,
  currentProject,
  editCompoundDraft,
  enterCompound,
  foldTo,
  hasUnsavedDraft,
  rootSession,
  type CompoundSession,
} from '@/lib/editor/compound'
import { useSelectedClips } from '@/components/playground/production/curves/useSelectedClip'
import { CompoundBar } from './CompoundBar'
import { ClipProperties } from '@/components/playground/production/properties/ClipProperties'
import { CurveEditor } from '@/components/playground/production/curves/CurveEditor'
import { TimelineControls } from '@/components/playground/shared/TimelineControls'
import { saveFile } from './download'
import { convert, fontBaseUrl, InputError, loadAllFonts, loadInput, preparePage, type Converted, type Issue } from './input'
import { PagePlayer } from './page/PagePlayer'
import { editPage, takePageConversion, type PageConversion } from './page/convert'
import { ConversionReport } from './page/ConversionReport'
import type { PageHooks, PagePlayerHandle, PageSource, PageStatus } from './page/types'

type Load =
  | { status: 'loading' }
  | { status: 'failed'; message: string; issues: Issue[] }
  | { status: 'ready'; converted: Converted }
  | { status: 'page'; title: string; page: PageSource; issues: Issue[] }

/**
 * HTML-first seam (PLAN-HTML-FIRST). A `page` input previews as HTML in `PageShell`; these two hooks are what
 * Export MP4 and Edit call. HF-2 replaces `onExportPage` (raster the page frame by frame, encode MP4) and HF-3
 * replaces `onEditPage` (convert the page to native clips + keys, swap to the editor, offer Revert). Until then
 * both only say what is coming.
 */
export const pageHooks: PageHooks = {
  // HF-2: raster every frame from the HTML, encode MP4 (page/exportPage.ts; lazy so the page player loads first).
  onExportPage: async (ctx) => (await import('./page/exportPage')).exportPage(ctx),
  // HF-3: convert the page to native clips + keys (page/convert.ts); the shell then takes the result and opens it.
  onEditPage: (ctx) => editPage(ctx),
}

type Mode = 'preview' | 'edit'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'elah-video'

export function App() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  // HF-3: a page converted by Edit; while set, the native editor shows it and "Revert to original" clears it.
  const [conv, setConv] = useState<PageConversion | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const input = await loadInput()
        if (input.source.kind === 'page') {
          const prepared = preparePage(input)
          await loadAllFonts()
          if (!cancelled) {
            document.title = prepared.title
            setLoad({ status: 'page', title: prepared.title, page: prepared.page, issues: prepared.issues })
          }
          return
        }
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
  if (load.status === 'page') {
    if (conv) return <Editor converted={conv.converted} origin={{ report: conv.report, text: conv.text, onRevert: () => setConv(null) }} />
    return <PageShell title={load.title} page={load.page} issues={load.issues} onConverted={setConv} />
  }
  return <Editor converted={load.converted} />
}

/** Preview mode for a `page` input: the page runs as HTML; Export and Edit go through `pageHooks`. */
function PageShell({ title, page, issues, onConverted }: { title: string; page: PageSource; issues: Issue[]; onConverted: (c: PageConversion) => void }) {
  const [, toggleTheme] = useTheme()
  const [dark, setDark] = useState(true)
  const [status, setStatus] = useState<PageStatus>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<PagePlayerHandle | null>(null)
  const { fullscreen, theater, toggleFullscreen } = usePlayerFullscreen(playerRef)
  const exporting = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute('data-theme') !== 'light' && (document.documentElement.getAttribute('data-theme') === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches))
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  const onHandle = useCallback((h: PagePlayerHandle | null) => {
    handleRef.current = h
  }, [])

  const onExport = useCallback(async () => {
    if (exporting.current) {
      exporting.current.abort()
      return
    }
    const ctl = new AbortController()
    exporting.current = ctl
    setBusy(true)
    handleRef.current?.pause()
    try {
      await pageHooks.onExportPage({ page, title, player: handleRef.current, setStatus, signal: ctl.signal })
    } catch (e) {
      setStatus({ text: ctl.signal.aborted ? 'Export cancelled.' : `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      exporting.current = null
      setBusy(false)
    }
  }, [page, title])

  const editing = useRef(false)
  const onEdit = useCallback(async () => {
    if (editing.current) return
    editing.current = true
    try {
      await pageHooks.onEditPage({ page, title, player: handleRef.current, setStatus })
      const done = takePageConversion(page)
      if (done) onConverted(done)
    } catch (e) {
      setStatus({ text: `Edit failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      editing.current = false
    }
  }, [page, title, onConverted])

  return (
    <div className={`app elah-root${theater ? ' theater' : ''}`} data-mode="preview" data-kind="page" data-dark={dark ? '1' : '0'}>
      <header className="hdr">
        <span className="brand"><i aria-hidden />Elah</span>
        <span className="title" title={title}>{title}</span>
        <div className="hdr-actions">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed="true">Preview</button>
            <button type="button" aria-pressed="false" onClick={() => void onEdit()} data-testid="edit-page">Edit</button>
          </div>
          <button type="button" className="btn icon" aria-label="Toggle light and dark" title="Toggle light and dark" onClick={toggleTheme}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="btn soon" disabled aria-disabled="true" title="Coming soon" data-testid="open-in-elah">
            <ExternalLink size={14} /> Open in Elah <span className="pill">Coming soon</span>
          </button>
          <button type="button" className="btn primary" onClick={() => void onExport()} data-testid="export">
            <Download size={14} /> {busy ? 'Cancel export' : 'Export MP4'}
          </button>
        </div>
      </header>

      <div className="main">
        <div className="player" ref={playerRef}>
          <PagePlayer page={page} fullscreen={fullscreen || theater} onToggleFullscreen={toggleFullscreen} onHandle={onHandle} />
        </div>
      </div>

      {status && (
        <div className="status" role="status">
          <span>{status.text}</span>
          {status.progress !== undefined && <span className="bar"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></span>}
        </div>
      )}
      <IssueList issues={issues} open={issues.some((i) => i.severity === 'error')} />
    </div>
  )
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

/** HF-3: set when the project came from converting a page; Revert goes back to the HTML page. */
type PageOrigin = { report: PageConversion['report']; text: string; onRevert: () => void }

function Editor({ converted, origin }: { converted: Converted; origin?: PageOrigin }) {
  return (
    <EditorProvider
      fps={converted.fps}
      stage={converted.stage}
      defaultTrackHeight={36}
      initialTracks={[]}
    >
      <Shell converted={converted} origin={origin} />
    </EditorProvider>
  )
}

function Shell({ converted, origin }: { converted: Converted; origin?: PageOrigin }) {
  const engine = useTimelineEngine()
  const timelineRef = useRef<TimelineRef>(null)
  const demuxerFactory = useRef(createDefaultDemuxerFactory())
  const [mode, setMode] = useState<Mode>(origin ? 'edit' : 'preview')
  const [, toggleTheme] = useTheme()
  const [dark, setDark] = useState(true)
  const [status, setStatus] = useState<{ text: string; progress?: number } | null>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const { fullscreen, theater, toggleFullscreen } = usePlayerFullscreen(playerRef)
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

  const onDownloadProject = useCallback(async () => {
    const name = `${slug(converted.title)}.elah.json`
    try {
      const json = serializeProject(engine)
      const route = await saveFile(name, new Blob([json], { type: 'application/json' }))
      setStatus({ text: `Saved ${name} (${route === 'capability' ? 'artifact download' : 'browser download'}).` })
      ;(window as unknown as { __elahLastProject?: { name: string; size: number; route: string } }).__elahLastProject = { name, size: json.length, route }
    } catch (e) {
      setStatus({ text: `Could not save ${name}: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [engine, converted.title])

  // --- Enter and edit inside a compound ----------------------------------------------------------------------
  // The root project is snapshotted and the open level's draft is loaded into this same engine, so the whole
  // normal editor (Animate, properties, curves) works on it. Nothing reaches the root until Done, which
  // loads the snapshot back and commits the folded draft with ONE updateCompoundProject (one undo step).
  // Known limit: loadProject clears history, so the root undo stack from before entering is gone.
  type Nav = { session: CompoundSession; root: Project; frame: number }
  const [nav, setNav] = useState<Nav | null>(null)
  const navRef = useRef<Nav | null>(null)
  navRef.current = nav
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const inCompound = nav !== null
  const lockedTitle = inCompound ? 'Finish editing the compound first' : undefined
  const { clips: selectedClips } = useSelectedClips()
  const selectedCompound = compoundForClip(selectedClips[0])

  const seek = (frame: number) => usePlaybackStore.getState().setCurrentFrame(Math.max(0, Math.round(frame)))
  useEffect(() => {
    const w = window as unknown as { __elah?: Record<string, unknown> }
    if (w.__elah) w.__elah.seek = seek // handle for browser checks (frame -> playhead)
  })
  const showLevel = (project: Project, frame: number) => {
    usePlaybackStore.getState().pause()
    useSelectionStore.getState().clearSelection()
    engine.loadProject(project)
    seek(frame)
  }

  const enterSelected = useCallback(() => {
    const cur = navRef.current
    const project = engine.getProject()
    const picked = compoundForClip(
      [...useSelectionStore.getState().selectedClipIds]
        .map((id) => engine.findClip(id)?.clip)
        .find((c) => compoundForClip(c)),
    )
    if (!picked) return
    // The open level's draft is whatever the engine holds now.
    const session = cur ? editCompoundDraft(cur.session, project) : rootSession()
    const entered = enterCompound(session, project, picked.id)
    if (!entered.ok) {
      setStatus({ text: entered.error.message })
      return
    }
    const frame = usePlaybackStore.getState().currentFrame
    const next: Nav = { session: entered.data, root: cur?.root ?? project, frame: cur?.frame ?? frame }
    setNav(next)
    setConfirmingCancel(false)
    setStatus(null)
    showLevel(currentProject(next.session, next.root), Math.max(0, frame - picked.startFrame))
  }, [engine]) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(
    (commit: boolean) => {
      const cur = navRef.current
      if (!cur) return
      const synced = editCompoundDraft(cur.session, engine.getProject())
      if (commit) {
        engine.loadProject(cur.root)
        const done = commitAll(synced, engine)
        if (!done.ok) {
          // Keep the root as it was and keep the user's work open in the level that holds it.
          setStatus({ text: `Could not save the compound: ${done.error.message}` })
          const keep: Nav = { ...cur, session: done.session }
          setNav(keep)
          engine.loadProject(currentProject(keep.session, keep.root))
          return
        }
        setStatus({ text: done.committed ? 'Compound saved (one undo step).' : 'No changes inside the compound.' })
      } else {
        engine.loadProject(cur.root)
        setStatus({ text: 'Discarded the changes inside the compound.' })
      }
      setNav(null)
      setConfirmingCancel(false)
      usePlaybackStore.getState().pause()
      useSelectionStore.getState().clearSelection()
      seek(cur.frame)
    },
    [engine],
  )

  const onCancelCompound = useCallback(() => {
    const cur = navRef.current
    if (!cur) return
    const dirty = hasUnsavedDraft(editCompoundDraft(cur.session, engine.getProject()))
    if (dirty && !confirmingCancel) {
      setConfirmingCancel(true)
      return
    }
    finish(false)
  }, [engine, confirmingCancel, finish])

  const onFold = useCallback(
    (depth: number) => {
      const cur = navRef.current
      if (!cur || depth >= cur.session.frames.length) return
      const synced = editCompoundDraft(cur.session, engine.getProject())
      const left = synced.frames[synced.frames.length - 1]!
      const folded = foldTo(synced, engine, depth)
      if (!folded.ok) {
        setStatus({ text: folded.error.message })
        return
      }
      const next: Nav = { ...cur, session: folded.data }
      const parent = currentProject(next.session, next.root)
      const clipStart = Object.values(parent.clips).flat().find((c) => c.id === left.compoundId)?.startFrame ?? 0
      setNav(next)
      setConfirmingCancel(false)
      showLevel(parent, clipStart + usePlaybackStore.getState().currentFrame)
    },
    [engine], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Double click on the stage opens the selected compound (Edit mode only).
  const onStageDoubleClick = useCallback(() => {
    if (mode === 'edit') enterSelected()
  }, [mode, enterSelected])

  const crumbs = useMemo(() => {
    if (!nav) return []
    const names: string[] = []
    let parent: Project = nav.root
    for (const f of nav.session.frames) {
      const clip = Object.values(parent.clips).flat().find((c) => c.id === f.compoundId)
      names.push(clip?.name?.trim() || f.compoundId)
      parent = f.draft
    }
    return names
  }, [nav])
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!nav) {
      setDirty(false)
      return
    }
    const check = () => setDirty(hasUnsavedDraft(editCompoundDraft(nav.session, engine.getProject())))
    check()
    engine.on('change', check)
    return () => engine.off('change', check)
  }, [nav, engine])

  const issues = converted.issues
  const [confirmRevert, setConfirmRevert] = useState(false)
  const onRevertClick = () => {
    if (!origin) return
    if (canUndo && !confirmRevert) {
      setConfirmRevert(true)
      return
    }
    origin.onRevert()
  }
  return (
    <div className={`app elah-root${theater ? ' theater' : ''}`} data-mode={mode} data-dark={dark ? '1' : '0'}>
      <header className="hdr">
        <span className="brand"><i aria-hidden />Elah</span>
        <span className="title" title={converted.title}>{converted.title}</span>
        <div className="hdr-actions">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!edit} disabled={inCompound} title={lockedTitle} onClick={() => setMode('preview')}>Preview</button>
            <button type="button" aria-pressed={edit} disabled={inCompound} title={lockedTitle} onClick={() => setMode('edit')}>Edit</button>
          </div>
          <button type="button" className="btn icon" aria-label="Toggle light and dark" title="Toggle light and dark" onClick={toggleTheme}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="btn soon" disabled aria-disabled="true" title="Coming soon" data-testid="open-in-elah">
            <ExternalLink size={14} /> Open in Elah <span className="pill">Coming soon</span>
          </button>
          {origin && (
            <button type="button" className="btn" onClick={onRevertClick} disabled={inCompound} title={lockedTitle ?? 'Go back to the HTML page (Export is the HTML export again)'} data-testid="revert-header">
              <Undo2 size={14} /> {confirmRevert ? 'Discard edits?' : 'Revert to original'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => void onDownloadProject()} disabled={inCompound} title={lockedTitle ?? 'Save the project as a .elah.json file'} aria-label="Download project" data-testid="download-project">
            <FileJson size={14} /> <span className="lbl-wide">Download project</span><span className="lbl-narrow">Project</span>
          </button>
          <button type="button" className="btn primary" onClick={onExport} disabled={inCompound} title={lockedTitle} data-testid="export">
            <Download size={14} /> {exporting.current ? 'Cancel export' : 'Export MP4'}
          </button>
        </div>
      </header>

      <div className={`main${edit ? ' edit' : ''}`}>
        <div className="player" ref={playerRef}>
          {nav && (
            <CompoundBar
              title={converted.title}
              crumbs={crumbs}
              dirty={dirty}
              confirmingCancel={confirmingCancel}
              onFold={onFold}
              onDone={() => finish(true)}
              onCancel={onCancelCompound}
            />
          )}
          <div className="stage" onDoubleClick={onStageDoubleClick}>
            <Preview demuxerFactory={demuxerFactory.current} style={{ width: '100%', height: '100%' }} />
          </div>
          <Transport showHistory={edit} canUndo={canUndo} canRedo={canRedo} fps={converted.fps} fullscreen={fullscreen || theater} onToggleFullscreen={toggleFullscreen} />
        </div>
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
            {selectedCompound && (
              <div className="props-head">
                <button type="button" className="btn" onClick={enterSelected} data-testid="edit-contents" title="Open this compound and edit its parts on their own timeline">
                  <PencilLine size={14} /> Edit contents
                </button>
              </div>
            )}
            <ClipProperties />
          </aside>
        )}
      </div>

      {status && (
        <div className="status" role="status">
          <span>{status.text}</span>
          {status.progress !== undefined && <span className="bar"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></span>}
        </div>
      )}
      {origin && <ConversionReport report={origin.report} text={origin.text} dirty={canUndo} onRevert={origin.onRevert} />}
      <IssueList issues={issues} open={issues.some((i) => i.severity === 'error')} />
    </div>
  )
}

const typing =(t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/**
 * Full screen for the player region (stage + transport). Real fullscreen when the browser allows it; inside a
 * sandboxed iframe without `allow="fullscreen"` the request is refused, so fall back to "theater": a fixed,
 * viewport-filling layout driven by a class on `.app`. F toggles, Esc leaves theater (the browser handles Esc
 * for real fullscreen).
 */
function usePlayerFullscreen(playerRef: RefObject<HTMLDivElement | null>) {
  const [fullscreen, setFullscreen] = useState(false)
  const [theater, setTheater] = useState(false)
  const theaterRef = useRef(false)
  theaterRef.current = theater

  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [playerRef])

  const toggleFullscreen = useCallback(() => {
    if (theaterRef.current) {
      setTheater(false)
      return
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    const el = playerRef.current
    const enter = document.fullscreenEnabled && el && typeof el.requestFullscreen === 'function' ? el.requestFullscreen() : undefined
    if (!enter) {
      setTheater(true)
      return
    }
    Promise.resolve(enter).catch(() => setTheater(true))
  }, [playerRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 'Escape' && theaterRef.current) {
        e.preventDefault()
        setTheater(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFullscreen])

  return { fullscreen, theater, toggleFullscreen }
}

function Transport({ showHistory, canUndo, canRedo, fps, fullscreen, onToggleFullscreen }: { showHistory: boolean; canUndo: boolean; canRedo: boolean; fps: number; fullscreen: boolean; onToggleFullscreen: () => void }) {
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
      <button type="button" className="btn icon" onClick={onToggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen} title="Full screen (F)" data-testid="fullscreen">
        {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
      {showHistory && (
        <>
          <button type="button" className="btn icon" disabled={!canUndo} onClick={() => engine.undo()} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
          <button type="button" className="btn icon" disabled={!canRedo} onClick={() => engine.redo()} aria-label="Redo" title="Redo (Ctrl+Y)"><Redo2 size={15} /></button>
        </>
      )}
    </div>
  )
}
