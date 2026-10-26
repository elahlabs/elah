import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Download, FileJson, Maximize2, MessageSquarePlus, PencilLine, Minimize2, Moon, Pause, Play, Redo2, Save, Square, Sun, Undo2, X } from 'lucide-react'
import {
  EditorProvider,
  Preview,
  Timeline,
  createDefaultDemuxerFactory,
  lazyExportVideo,
  serializeProject,
  readProjectDocument,
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
import { HeaderLinks, MadeWithElah } from './HeaderLinks'
import { FollowUps } from './FollowUps'
import { InElah } from './InElah'
import { PreviewStrip } from './PreviewStrip'
import { clockLabel, composeAt, edgePoint, inside, requestPlace, setPinSurface, shownRect, startMomentComments, stripPoint, stripTime, useMomentComments, type Moment } from './comments'
import { convert, fontBaseUrl, InputError, loadAllFonts, loadInput, preparePage, type Converted, type Issue } from './input'
import { PagePlayer } from './page/PagePlayer'
import { convertPage, editPage, takePageConversion, type PageConversion } from './page/convert'
import { ConversionReport } from './page/ConversionReport'
import type { PageHooks, PagePlayerHandle, PageSource, PageStatus } from './page/types'
import { AddFootageButton, CreatorNudge, ReconnectPrompt, STAYS_LOCAL, useFileDrop, useFilePicker } from './Footage'
import {
  CREATOR_NUDGE_SECONDS,
  addFootage,
  footageKey,
  footageSeconds,
  forgetSavedProject,
  hasFootage,
  missingFootage,
  readSavedProject,
  reconnectFootage,
  refusedLine,
  removeMissingFootage,
  sortFiles,
  writeSavedProject,
  type MissingFile,
} from './footageFiles'
import { formatBytes, getArtifactCap, saveVersion, takeStash, type ArtifactCap, type Stash } from './save'

type Load =
  | { status: 'loading' }
  | { status: 'failed'; message: string; issues: Issue[] }
  | { status: 'ready'; converted: Converted; key: string; restored?: boolean }
  | { status: 'page'; title: string; page: PageSource; issues: Issue[]; key: string }

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
  // PF-14: files dropped on a programmatic video before Edit; the editor adds them once it is open.
  const [pendingFootage, setPendingFootage] = useState<File[] | undefined>(undefined)
  const onConverted = useCallback((c: PageConversion, files?: File[]) => {
    setPendingFootage(files)
    setConv(c)
  }, [])

  // PF-16: register comment custom anchors once at load (writes nothing; null outside claude.ai).
  useEffect(() => {
    void startMomentComments()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const input = await loadInput()
        // PF-14: a project with footage on it is kept per viewer (localStorage) so a reload can ask for the files.
        const key = footageKey(input)
        const saved = readSavedProject(key)
        if (input.source.kind === 'page') {
          const prepared = preparePage(input)
          await loadAllFonts()
          if (cancelled) return
          document.title = prepared.title
          if (saved) {
            const converted: Converted = { title: prepared.title, kind: 'page', project: saved, fps: saved.fps, stage: saved.stage ?? { width: 1920, height: 1080 }, issues: [] }
            setLoad({ status: 'ready', converted, key, restored: true })
          } else {
            setLoad({ status: 'page', title: prepared.title, page: prepared.page, issues: prepared.issues, key })
          }
          return
        }
        const built = await convert(input)
        const converted = saved ? { ...built, project: saved } : built
        await loadAllFonts()
        if (!cancelled) {
          document.title = converted.title
          setLoad({ status: 'ready', converted, key, restored: !!saved })
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
    if (conv) {
      const onRevert = () => {
        forgetSavedProject(load.key)
        setPendingFootage(undefined)
        setConv(null)
      }
      return <Editor converted={conv.converted} origin={{ report: conv.report, text: conv.text, onRevert }} footageKey={load.key} initialFootage={pendingFootage} />
    }
    return <PageShell title={load.title} page={load.page} issues={load.issues} onConverted={onConverted} />
  }
  return <Editor converted={load.converted} footageKey={load.key} startUnsaved={load.restored} />
}

/** Preview mode for a `page` input: the page runs as HTML; Export and Edit go through `pageHooks`. */
function PageShell({ title, page, issues, onConverted }: { title: string; page: PageSource; issues: Issue[]; onConverted: (c: PageConversion, files?: File[]) => void }) {
  const [, toggleTheme] = useTheme()
  const [dark, setDark] = useState(true)
  const [status, setStatus] = useState<PageStatus>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<PagePlayerHandle | null>(null)
  const { fullscreen, theater, toggleFullscreen } = usePlayerFullscreen(playerRef)
  const exporting = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  // Layout warnings (overlapping text, text outside the safe margin) measured by the player after mount.
  const [layoutIssues, setLayoutIssues] = useState<Issue[]>([])
  const allIssues = useMemo(() => [...issues, ...layoutIssues], [issues, layoutIssues])

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
  const onLayout = useCallback((found: Issue[]) => setLayoutIssues(found), [])

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
  const onEdit = useCallback(async (footage?: File[]) => {
    if (editing.current) return
    editing.current = true
    try {
      await pageHooks.onEditPage({ page, title, player: handleRef.current, setStatus })
      const done = takePageConversion(page)
      if (done) onConverted(done, footage)
    } catch (e) {
      setStatus({ text: `Edit failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      editing.current = false
    }
  }, [page, title, onConverted])

  // PF-14: footage needs the timeline, so adding it to a programmatic video runs Edit first and the editor adds
  // the files once it opens. The picker opens on the click itself (a file dialog needs the user's gesture).
  const onFootage = useCallback(
    (files: File[]) => {
      const { accepted, refused } = sortFiles(files)
      if (accepted.length === 0) {
        setStatus({ text: refusedLine(refused) })
        return
      }
      setStatus({ text: 'Footage needs the timeline, so the video opens in the editor first.' })
      void onEdit(accepted)
    },
    [onEdit],
  )
  const picker = useFilePicker(onFootage)
  const drop = useFileDrop(onFootage)

  // PF-16: comment pins for the programmatic video sit on its scrub strip, x by time.
  const commenting = useMomentComments()
  useEffect(() => {
    const duration = page.durationSeconds
    const track = () => shownRect(playerRef.current?.querySelector('[data-testid="page-timeline"] .pt-track'))
    const strip = () => shownRect(playerRef.current?.querySelector('[data-testid="page-timeline"]'))
    const stage = () => shownRect(playerRef.current?.querySelector('[data-testid="page-stage"]'))
    return setPinSurface({
      pointFor: (m) => {
        const tr = track()
        if (tr) return stripPoint(tr, m.t, duration)
        const st = stage()
        return st ? edgePoint(st, m.t, duration) : null
      },
      momentAt: (x, y) => {
        const tr = track()
        const sr = strip()
        if (tr && sr && inside(sr, x, y)) return { t: stripTime(tr, x, duration) }
        const st = stage()
        return st && inside(st, x, y) ? { t: handleRef.current?.time() ?? 0 } : null
      },
      reveal: (m) => {
        handleRef.current?.pause()
        handleRef.current?.seek(m.t)
        playerRef.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      },
    })
  }, [page])

  // Download project before Edit: run the same conversion Edit runs, serialise its project (what the editor's
  // serializeProject writes: loadProject keeps the object as is), and leave the preview mounted and paused.
  const saving = useRef(false)
  const [savingProject, setSavingProject] = useState(false)
  const onDownloadProject = useCallback(async () => {
    if (saving.current) return
    saving.current = true
    setSavingProject(true)
    const name = `${slug(title)}.elah.json`
    try {
      const player = handleRef.current
      if (!player) throw new Error('The programmatic video is not loaded yet.')
      setStatus({ text: 'Converting the programmatic video to a project...', progress: 0 })
      const conv = await convertPage(page, title, player, (p, text) => setStatus({ text, progress: p }))
      const json = JSON.stringify(conv.converted.project)
      const route = await saveFile(name, new Blob([json], { type: 'application/json' }))
      setStatus({ text: `Saved ${name} (${route === 'capability' ? 'artifact download' : 'browser download'}).` })
      ;(window as unknown as { __elahLastProject?: { name: string; size: number; route: string } }).__elahLastProject = { name, size: json.length, route }
    } catch (e) {
      setStatus({ text: `Could not save ${name}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      saving.current = false
      setSavingProject(false)
    }
  }, [page, title])

  return (
    <div className={`app elah-root${theater ? ' theater' : ''}`} data-mode="preview" data-kind="page" data-dark={dark ? '1' : '0'} {...drop.handlers}>
      {drop.overlay}
      {picker.input}
      <header className="hdr">
        <span className="brand"><i aria-hidden />Elah</span><MadeWithElah />
        <span className="title" title={title}>{title}</span>
        <div className="hdr-actions">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed="true">Preview</button>
            <button type="button" aria-pressed="false" onClick={() => void onEdit()} data-testid="edit-page">Edit</button>
          </div>
          <button type="button" className="btn icon" aria-label="Toggle light and dark" title="Toggle light and dark" onClick={toggleTheme}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <AddFootageButton onClick={picker.open} title={`Add your own video or audio. This opens the editor first, because footage needs the timeline. ${STAYS_LOCAL}`} />
          <HeaderLinks />
          <button type="button" className="btn" onClick={() => void onDownloadProject()} disabled={savingProject} aria-busy={savingProject} title="Save the project as a .elah.json file" aria-label="Download project" data-testid="download-project">
            <FileJson size={14} /> <span className="lbl-wide">{savingProject ? 'Saving...' : 'Download project'}</span><span className="lbl-narrow">{savingProject ? '...' : 'Project'}</span>
          </button>
          <button type="button" className="btn primary" onClick={() => void onExport()} data-testid="export">
            <Download size={14} /> {busy ? 'Cancel export' : 'Export MP4'}
          </button>
        </div>
      </header>

      <div className="main">
        <div className="player" ref={playerRef}>
          <PagePlayer page={page} fullscreen={fullscreen || theater} onToggleFullscreen={toggleFullscreen} onHandle={onHandle} onLayout={onLayout} />
          {commenting && (
            <div className="comment-row">
              <PageCommentButton handleRef={handleRef} playerRef={playerRef} />
            </div>
          )}
        </div>
      </div>
      {!theater && <div className="below"><FollowUps /><InElah /></div>}

      {status && (
        <div className="status" role="status">
          <span>{status.text}</span>
          {status.progress !== undefined && <span className="bar"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></span>}
        </div>
      )}
      <IssueList issues={allIssues} open={allIssues.some((i) => i.severity === 'error')} />
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

/** `startUnsaved`: the project came from this viewer's local copy (PF-14), so it differs from the published version. */
type EditorProps = { converted: Converted; origin?: PageOrigin; footageKey: string; initialFootage?: File[]; startUnsaved?: boolean }

function Editor(props: EditorProps) {
  return (
    <EditorProvider
      fps={props.converted.fps}
      stage={props.converted.stage}
      defaultTrackHeight={36}
      initialTracks={[]}
    >
      <Shell {...props} />
    </EditorProvider>
  )
}

function Shell({ converted, origin, footageKey: storeKey, initialFootage, startUnsaved }: EditorProps) {
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
  // Save version (PF-15): the project as published (or last saved by this view); '' = it differs from that.
  const savedJson = useRef('')
  useEffect(() => {
    if (laid.current) return
    laid.current = true
    engine.loadProject(converted.project)
    savedJson.current = startUnsaved ? '' : serializeProject(engine)
    ;(window as unknown as { __elah?: unknown }).__elah = { engine } // handle for browser checks
  }, [engine, converted]) // eslint-disable-line react-hooks/exhaustive-deps
  // Revert disposes this engine: the probe handle must not keep pointing at it.
  useEffect(
    () => () => {
      const w = window as unknown as { __elah?: { engine?: unknown } }
      if (w.__elah?.engine === engine) delete w.__elah
    },
    [engine],
  )

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
      // Footage clips carry only each file's name and size (clip.media); the bytes are never in the project.
      const footNote = hasFootage(engine.getProject()) ? ' Footage is saved by file name and size only: drop the same files again when you open it.' : ''
      setStatus({ text: `Saved ${name} (${route === 'capability' ? 'artifact download' : 'browser download'}).${footNote}` })
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

  // PF-16: comment pins. Preview: on the scene strip under the player. Edit: on the timeline at that x (on the
  // clip's block for a `clip=` anchor), null when the time is scrolled out of view. Inside a compound the
  // timeline's times are local, so no pins and no Comment button there.
  const commenting = useMomentComments()
  const timelineWrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fps = converted.fps
    const duration = () => Math.max(1, useTracksStore.getState().totalFrames) / fps
    const now = () => usePlaybackStore.getState().currentFrame / fps
    const stage = () => shownRect(playerRef.current?.querySelector('.stage'))
    const strip = () => shownRect(playerRef.current?.querySelector('[data-testid="preview-strip"]'))
    const track = () => shownRect(playerRef.current?.querySelector('[data-testid="preview-strip"] .pt-track'))
    const root = () => timelineWrapRef.current?.querySelector<HTMLElement>('[data-elah-timeline-root]') ?? null
    // The ruler's clip-lane box: its left edge is frame 0 minus the shared horizontal scroll.
    const lane = () => {
      const ruler = root()?.firstElementChild?.lastElementChild as HTMLElement | null | undefined
      const r = shownRect(ruler)
      return ruler && r ? { r, scroll: ruler.scrollLeft } : null
    }
    const laneX = (l: { r: DOMRect; scroll: number }, t: number) => l.r.left + t * fps * usePlaybackStore.getState().zoom - l.scroll
    const laneT = (l: { r: DOMRect; scroll: number }, x: number) => Math.max(0, (x - l.r.left + l.scroll) / (fps * usePlaybackStore.getState().zoom))
    const clipEl = (id: string) => {
      try {
        return timelineWrapRef.current?.querySelector(`[data-clip-id="${CSS.escape(id)}"]`) ?? null
      } catch {
        return null
      }
    }
    const fallback = (t: number) => {
      const st = stage()
      return st ? edgePoint(st, t, duration()) : null
    }
    return setPinSurface({
      pointFor: (m: Moment) => {
        if (inCompound || m.t > duration() + 1e-3) return null
        if (!edit) {
          const tr = track()
          return tr ? stripPoint(tr, m.t, duration()) : fallback(m.t)
        }
        const l = lane()
        if (!l) return fallback(m.t)
        const x = laneX(l, m.t)
        if (x < l.r.left - 1 || x > l.r.right + 1) return null // scrolled out of view: the shell lists it
        const cr = m.clip ? shownRect(clipEl(m.clip)) : null
        const tl = shownRect(root())
        if (cr && tl && cr.bottom > l.r.bottom && cr.top < tl.bottom) return { x: Math.min(cr.right - 4, Math.max(cr.left + 4, x)), y: cr.top + cr.height / 2 }
        return { x, y: l.r.top + l.r.height / 2 }
      },
      momentAt: (x, y) => {
        if (inCompound) return null
        const st = stage()
        if (st && inside(st, x, y)) {
          const sel = [...useSelectionStore.getState().selectedClipIds]
          return edit && sel.length === 1 ? { t: now(), clip: sel[0] } : { t: now() }
        }
        if (!edit) {
          const tr = track()
          const sr = strip()
          return tr && sr && inside(sr, x, y) ? { t: Math.min(duration(), stripTime(tr, x, duration())) } : null
        }
        const l = lane()
        const tl = shownRect(root())
        if (!l || !tl || !inside(tl, x, y) || x < l.r.left) return null
        const t = Math.min(duration(), laneT(l, x))
        const hit = document.elementFromPoint(x, y)?.closest('[data-clip-id]')
        const id = hit?.getAttribute('data-clip-id')
        return id ? { t, clip: id } : { t }
      },
      reveal: (m: Moment) => {
        usePlaybackStore.getState().pause()
        seek(m.t * fps)
        playerRef.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      },
    })
  }, [converted.fps, edit, inCompound]) // eslint-disable-line react-hooks/exhaustive-deps
  // Seeks (the timeline follows the playhead), zoom and clip edits move the pins.
  useEffect(() => {
    if (!commenting) return
    const a = usePlaybackStore.subscribe(requestPlace)
    const b = useTracksStore.subscribe(requestPlace)
    return () => {
      a()
      b()
    }
  }, [commenting])

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

  // --- Footage (PF-14) --------------------------------------------------------------------------------------
  // Files stay in this tab: the engine's own import makes an object URL, and the clip keeps only the file's name
  // and size. While footage is on the timeline the project is kept per viewer, so a reload lists the files again.
  const [missing, setMissing] = useState<MissingFile[]>([])
  const [reconnectHidden, setReconnectHidden] = useState(false)
  const [footSecs, setFootSecs] = useState(0)
  const [nudgeHidden, setNudgeHidden] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      // Inside a compound the engine holds a draft, not the root: neither listed nor saved until Done.
      if (navRef.current) return
      const project = engine.getProject()
      setMissing(missingFootage(project))
      setFootSecs(footageSeconds(project))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!navRef.current) writeSavedProject(storeKey, engine.getProject())
      }, 400)
    }
    read()
    engine.on('change', read)
    return () => {
      engine.off('change', read)
      if (timer) clearTimeout(timer)
    }
  }, [engine, storeKey])

  const adding = useRef(false)
  const onFootage = useCallback(
    async (files: File[], lead?: string) => {
      if (navRef.current) {
        setStatus({ text: 'Finish editing the compound first, then add footage.' })
        return
      }
      if (adding.current) return
      const { accepted, refused } = sortFiles(files)
      const refusedText = refusedLine(refused)
      if (accepted.length === 0) {
        setStatus({ text: refusedText })
        return
      }
      adding.current = true
      usePlaybackStore.getState().pause()
      const progress = (text: string, p: number) => (text ? setStatus({ text, progress: p }) : undefined)
      try {
        const lines: string[] = lead ? [lead] : []
        let rest = accepted
        if (missingFootage(engine.getProject()).length > 0) {
          const r = await reconnectFootage(engine, accepted, progress)
          rest = r.unmatched
          if (r.reconnected.length) lines.push(`Reconnected ${r.reconnected.join(', ')}.`)
        }
        if (rest.length) {
          const r = await addFootage(engine, rest, usePlaybackStore.getState().currentFrame, progress)
          if (r.added) {
            lines.push(`Added ${r.names.join(', ')} at the playhead, under the graphics.`)
            if (r.hidBackground) lines.push('The background layer is hidden so the footage shows; turn it back on in the timeline.')
            setMode('edit')
          }
        }
        if (refusedText) lines.push(refusedText)
        lines.push(STAYS_LOCAL)
        setStatus({ text: lines.join(' ') })
      } catch (e) {
        setStatus({ text: `Could not add the footage: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        adding.current = false
      }
    },
    [engine],
  )
  const picker = useFilePicker((files) => void onFootage(files))
  const drop = useFileDrop((files) => void onFootage(files))

  // Files dropped on the programmatic video before Edit arrive here once, after the project is laid.
  const tookInitial = useRef(false)
  useEffect(() => {
    if (tookInitial.current || !initialFootage?.length) return
    tookInitial.current = true
    void onFootage(initialFootage, 'Footage needs the timeline, so the video is now open in the editor.')
  }, [initialFootage, onFootage])

  const onRemoveMissing = useCallback(() => {
    const n = removeMissingFootage(engine)
    setStatus({ text: `Removed ${n} clip${n === 1 ? '' : 's'} whose files were not reconnected (Undo brings them back).` })
  }, [engine])

  // --- Save version (PF-15) ---------------------------------------------------------------------------------
  // Save publishes elah-input.json as { kind: 'project' } through the artifact capability's files form, on an
  // explicit click only. Wherever the capability is null (locally, always) the button is not shown.
  const [saveCap, setSaveCap] = useState<ArtifactCap | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [coolUntil, setCoolUntil] = useState(0)
  const [unsaved, setUnsaved] = useState(!!startUnsaved)
  const [savedOnce, setSavedOnce] = useState(false)
  const shaRef = useRef<string | undefined>(undefined)
  const [stashed, setStashed] = useState<Stash | null>(null)
  useEffect(() => {
    let live = true
    void getArtifactCap().then((cap) => {
      if (live) setSaveCap(cap)
    })
    // A conflict reloads the view to the newer version; the edits this tab was saving were stashed first.
    const s = takeStash()
    if (s && s.project !== savedJson.current) setStashed(s)
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (navRef.current) return // a compound draft is not the project; Done brings the change back here
        setUnsaved(serializeProject(engine) !== savedJson.current)
      }, 300)
    }
    engine.on('change', check)
    return () => {
      engine.off('change', check)
      if (timer) clearTimeout(timer)
    }
  }, [engine])
  useEffect(() => {
    if (!coolUntil) return
    const t = setTimeout(() => setCoolUntil(0), Math.max(0, coolUntil - Date.now()))
    return () => clearTimeout(t)
  }, [coolUntil])

  const onSave = useCallback(async () => {
    if (!saveCap || saving || navRef.current) return
    setSaving(true)
    usePlaybackStore.getState().pause()
    setStatus({ text: 'Saving this version...' })
    const json = serializeProject(engine)
    const out = await saveVersion(saveCap, converted.title, json, shaRef.current)
    setSaving(false)
    switch (out.kind) {
      case 'saved': {
        savedJson.current = json
        shaRef.current = out.sha
        setUnsaved(serializeProject(engine) !== json)
        setSavedOnce(true)
        const lines = ['Saved. Everyone with the link now sees this version.']
        if (origin) lines.push('Revert to original is no longer available: the saved version replaced the programmatic video.')
        if (hasFootage(engine.getProject())) lines.push('Footage is saved by file name and size only, so other viewers are asked for the same files.')
        setStatus({ text: lines.join(' ') })
        break
      }
      case 'conflict':
        setStatus({ text: 'A newer version was published; reloading. Your edits are kept in this tab.' })
        break
      case 'read-only':
        setReadOnly(true)
        setStatus({ text: 'This view is read-only. Use Download project to keep your edits.' })
        break
      case 'unavailable':
        setReadOnly(true)
        setStatus({ text: 'Saving is not available here. Use Download project.' })
        break
      case 'too-large':
        setStatus({ text: `This project is ${formatBytes(out.bytes)}, over the artifact's size limit, so it was not saved. Use Download project.` })
        break
      case 'rate-limited':
        setCoolUntil(Date.now() + 30_000)
        setStatus({ text: 'Saved too often. Save is paused for 30 seconds.' })
        break
      case 'failed':
        setStatus({ text: `Could not save: ${out.message}` })
        break
    }
  }, [saveCap, saving, engine, converted.title, origin])

  const onRestoreStash = useCallback(() => {
    if (!stashed) return
    try {
      usePlaybackStore.getState().pause()
      engine.loadProject(readProjectDocument(JSON.parse(stashed.project)))
      setStatus({ text: 'Your edits from before the reload are back. Save publishes them over the newer version.' })
    } catch (e) {
      setStatus({ text: `Could not restore your edits: ${e instanceof Error ? e.message : String(e)}` })
    }
    setStashed(null)
  }, [stashed, engine])

  const showSave = saveCap !== null && !readOnly
  const cooling = coolUntil > 0
  const saveTitle = lockedTitle ?? (cooling ? 'Saved too often; try again in a few seconds' : unsaved ? "Publish this edit as the artifact's next version" : 'No unsaved changes')
  const canRevert = !!origin && !savedOnce

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
    <div className={`app elah-root${theater ? ' theater' : ''}`} data-mode={mode} data-dark={dark ? '1' : '0'} {...drop.handlers}>
      {drop.overlay}
      {picker.input}
      <header className="hdr">
        <span className="brand"><i aria-hidden />Elah</span><MadeWithElah />
        <span className="title" title={converted.title}>{converted.title}</span>
        <div className="hdr-actions">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!edit} disabled={inCompound} title={lockedTitle} onClick={() => setMode('preview')}>Preview</button>
            <button type="button" aria-pressed={edit} disabled={inCompound} title={lockedTitle} onClick={() => setMode('edit')}>Edit</button>
          </div>
          <button type="button" className="btn icon" aria-label="Toggle light and dark" title="Toggle light and dark" onClick={toggleTheme}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {canRevert && (
            <button type="button" className="btn" onClick={onRevertClick} disabled={inCompound} title={lockedTitle ?? 'Back to the original programmatic video (export comes from it again)'} data-testid="revert-header">
              <Undo2 size={14} /> {confirmRevert ? 'Discard edits?' : 'Revert to original'}
            </button>
          )}
          <AddFootageButton onClick={picker.open} disabled={inCompound} title={lockedTitle} />
          <HeaderLinks />
          {showSave && (
            <button type="button" className={`btn save${unsaved ? ' unsaved' : ''}`} onClick={() => void onSave()} disabled={inCompound || saving || cooling || !unsaved} aria-busy={saving} title={saveTitle} aria-label={unsaved ? 'Save, unsaved changes' : 'Saved'} data-testid="save-version">
              <Save size={14} /> <span>{saving ? 'Saving...' : unsaved ? 'Save' : 'Saved'}</span>
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
          {/* Preview shows the compact scene strip (the first-load look); Edit shows the full timeline below. */}
          {!edit && <PreviewStrip />}
          <Transport
            showHistory={edit}
            canUndo={canUndo}
            canRedo={canRedo}
            fps={converted.fps}
            fullscreen={fullscreen || theater}
            onToggleFullscreen={toggleFullscreen}
            extra={commenting && !inCompound ? <EditorCommentButton fps={converted.fps} edit={edit} playerRef={playerRef} timelineWrapRef={timelineWrapRef} /> : null}
          />
        </div>
        {/* Kept mounted in Preview (hidden): the Timeline keeps the tracks store in sync with the engine. */}
        <div className="timeline-wrap" hidden={!edit} ref={timelineWrapRef}>
          {edit && <TimelineControls timelineRef={timelineRef} compact={narrow} />}
          <Timeline
            ref={timelineRef}
            fps={converted.fps}
            sidebarWidth={narrow ? 48 : undefined}
            compactSidebar={narrow}
            style={{ height: narrow ? 158 : 200, flexShrink: 0, minWidth: 0 }}
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

      {!theater && !nav && stashed && (
        <div className="nudge" role="note" data-testid="save-stash">
          <span>A newer version was published while you were saving. Your edits from before the reload were kept in this tab.</span>
          <button type="button" className="btn" onClick={onRestoreStash}>Restore my edits</button>
          <button type="button" className="btn icon" aria-label="Discard my edits" title="Discard my edits" onClick={() => setStashed(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {!theater && !nav && !reconnectHidden && <ReconnectPrompt missing={missing} onPick={picker.open} onRemove={onRemoveMissing} onDismiss={() => setReconnectHidden(true)} />}
      {!theater && !nudgeHidden && footSecs > CREATOR_NUDGE_SECONDS && <CreatorNudge onDismiss={() => setNudgeHidden(true)} />}
      {!theater && !nav && <div className="below"><FollowUps /><InElah /></div>}
      {status && (
        <div className="status" role="status">
          <span>{status.text}</span>
          {status.progress !== undefined && <span className="bar"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></span>}
        </div>
      )}
      {canRevert && origin && <ConversionReport report={origin.report} text={origin.text} dirty={canUndo} onRevert={origin.onRevert} />}
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

function Transport({ showHistory, canUndo, canRedo, fps, fullscreen, onToggleFullscreen, extra }: { showHistory: boolean; canUndo: boolean; canRedo: boolean; fps: number; fullscreen: boolean; onToggleFullscreen: () => void; extra?: ReactNode }) {
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
      {extra}
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

/**
 * PF-16: "Comment at 0:12" in the editor's transport. With one clip selected in Edit the anchor names it
 * (`t=12.40;clip=<id>`) and the composer opens at that clip's block; otherwise at the player. Gesture only.
 */
function EditorCommentButton({ fps, edit, playerRef, timelineWrapRef }: { fps: number; edit: boolean; playerRef: RefObject<HTMLDivElement | null>; timelineWrapRef: RefObject<HTMLDivElement | null> }) {
  const engine = useTimelineEngine()
  const [sec, setSec] = useState(() => Math.floor(usePlaybackStore.getState().currentFrame / fps))
  useEffect(() => usePlaybackStore.subscribe((s) => setSec(Math.floor(s.currentFrame / fps))), [fps])
  const onClick = () => {
    const t = usePlaybackStore.getState().currentFrame / fps
    const sel = edit ? [...useSelectionStore.getState().selectedClipIds] : []
    const clip = sel.length === 1 ? engine.findClip(sel[0]!)?.clip : undefined
    let at: Element | null = playerRef.current
    if (clip) {
      try {
        const el = timelineWrapRef.current?.querySelector(`[data-clip-id="${CSS.escape(clip.id)}"]`)
        if (el && shownRect(el)) at = el
      } catch {
        /* keep the player */
      }
    }
    if (!at) return
    const m: Moment = clip ? { t, clip: clip.id } : { t }
    void composeAt(m, at, clip ? `At ${clockLabel(t)}, ${clip.name}` : `At ${clockLabel(t)}`)
  }
  return (
    <button type="button" className="btn comment-at" onClick={onClick} title="Comment on this moment (Claude can change exactly this beat)" data-testid="comment-at">
      <MessageSquarePlus size={14} /> <span>Comment at {clockLabel(sec)}</span>
    </button>
  )
}

/** PF-16: the same button for the programmatic video, under its transport. */
function PageCommentButton({ handleRef, playerRef }: { handleRef: RefObject<PagePlayerHandle | null>; playerRef: RefObject<HTMLDivElement | null> }) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    // The page player has no time subscription; a light poll keeps the label current.
    const id = window.setInterval(() => setSec(Math.floor(handleRef.current?.time() ?? 0)), 250)
    return () => window.clearInterval(id)
  }, [handleRef])
  const onClick = () => {
    const t = handleRef.current?.time() ?? 0
    if (playerRef.current) void composeAt({ t }, playerRef.current, `At ${clockLabel(t)}`)
  }
  return (
    <button type="button" className="btn comment-at" onClick={onClick} title="Comment on this moment (Claude can change exactly this beat)" data-testid="comment-at">
      <MessageSquarePlus size={14} /> <span>Comment at {clockLabel(sec)}</span>
    </button>
  )
}
