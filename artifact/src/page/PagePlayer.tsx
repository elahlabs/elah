import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, Pause, Play, Square } from 'lucide-react'
import { framesToTimecode } from '@elah/editor'
import { loadAllFonts, type Issue } from '../input'
import { layoutReport, type LayoutReport } from './layout'
import { mountPage, type MountedPage } from './mount'
import { collectAnimations, sceneWindows, seekAnimations } from './seek'
import type { PagePlayerHandle, PageSource, SceneWindow } from './types'

interface Props {
  page: PageSource
  fullscreen: boolean
  onToggleFullscreen: () => void
  /** Called with the live handle once mounted, and with null on unmount. */
  onHandle?: (h: PagePlayerHandle | null) => void
  /** Called once after mount with the layout report's warnings (possibly none). */
  onLayout?: (issues: Issue[]) => void
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Greedy lane packing so overlapping scene windows stack instead of covering each other. */
function lanes(scenes: readonly SceneWindow[]): number[] {
  const ends: number[] = []
  return scenes.map((s) => {
    let lane = ends.findIndex((e) => e <= s.start + 1e-6)
    if (lane === -1) lane = ends.length
    ends[lane] = s.end
    return lane
  })
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && !!el.tagName && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * The page, scaled to fit the stage, with play / pause / stop, a scrub bar and scene bars. Renders the three
 * children `.player` expects (stage, timeline strip, transport) so it drops into the same region the editor
 * preview uses and the fullscreen / theater mode of that region works unchanged.
 */
export function PagePlayer({ page, fullscreen, onToggleFullscreen, onHandle, onLayout }: Props) {
  const fitRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)

  const mountedRef = useRef<MountedPage | null>(null)
  const animsRef = useRef<Animation[]>([])
  const tRef = useRef(0)
  const playingRef = useRef(false)
  const rafRef = useRef(0)
  const lastRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [scenes, setScenes] = useState<SceneWindow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 })

  const duration = page.durationSeconds
  const fps = page.fps
  const total = useMemo(() => framesToTimecode(Math.round(duration * fps), fps), [duration, fps])

  const paint = useCallback(
    (t: number) => {
      const pct = duration > 0 ? (t / duration) * 100 : 0
      if (playheadRef.current) playheadRef.current.style.left = `${pct}%`
      if (fillRef.current) fillRef.current.style.width = `${pct}%`
      if (readoutRef.current) readoutRef.current.textContent = framesToTimecode(Math.round(t * fps), fps)
      trackRef.current?.setAttribute('aria-valuenow', t.toFixed(2))
    },
    [duration, fps],
  )

  const seek = useCallback(
    (t: number) => {
      const c = clamp(t, 0, duration)
      tRef.current = c
      seekAnimations(animsRef.current, c)
      paint(c)
    },
    [duration, paint],
  )

  const stopLoop = useCallback(() => {
    playingRef.current = false
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
  }, [])

  const play = useCallback(() => {
    if (playingRef.current || animsRef.current.length === 0) return
    playingRef.current = true
    setPlaying(true)
    lastRef.current = performance.now()
    const tick = (now: number) => {
      if (!playingRef.current) return
      const dt = Math.min(0.25, (now - lastRef.current) / 1000)
      lastRef.current = now
      let t = tRef.current + dt
      if (t >= duration) t = duration > 0 ? t % duration : 0 // wrap at the end
      seek(t)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [duration, seek])

  const toggle = useCallback(() => (playingRef.current ? stopLoop() : play()), [play, stopLoop])
  const stop = useCallback(() => {
    stopLoop()
    seek(0)
  }, [seek, stopLoop])

  // Mount once fonts are in (the loader registers faces on document.fonts; shadow roots share them).
  useEffect(() => {
    let cancelled = false
    let handle: PagePlayerHandle | null = null
    ;(async () => {
      try {
        await loadAllFonts()
        if (cancelled || !hostRef.current) return
        const mounted = mountPage(hostRef.current, page)
        mountedRef.current = mounted
        const anims = collectAnimations(mounted.stageEl)
        animsRef.current = anims
        const windows = sceneWindows(mounted.stageEl, anims, duration)
        setScenes(windows)
        // Layout report (overlaps, safe margin): measured once, here; a failure must never stop the preview.
        let layout: LayoutReport = { issues: [], ms: 0, times: [] }
        try {
          layout = layoutReport(mounted.stageEl, anims, windows, page.stage, duration)
        } catch (e) {
          console.warn('layout report failed', e)
        }
        onLayout?.(layout.issues)
        handle = {
          page,
          root: mounted.root,
          stageEl: mounted.stageEl,
          scenes: windows,
          animations: () => animsRef.current,
          seek,
          time: () => tRef.current,
          play,
          pause: stopLoop,
          isPlaying: () => playingRef.current,
          layout,
        }
        seek(0)
        ;(window as unknown as { __elahPage?: unknown }).__elahPage = handle
        onHandle?.(handle)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      playingRef.current = false
      cancelAnimationFrame(rafRef.current)
      // The window hook must never outlive its mount (Edit and Revert unmount the player).
      const w = window as unknown as { __elahPage?: unknown }
      if (handle && w.__elahPage === handle) delete w.__elahPage
      handle = null
      mountedRef.current?.dispose()
      mountedRef.current = null
      animsRef.current = []
      onHandle?.(null)
    }
    // The page is fixed for the life of the player; seek/play are stable for it.
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the stage-sized page into the available region, letterboxed and centred.
  useLayoutEffect(() => {
    const el = fitRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w <= 0 || h <= 0) return
      const scale = Math.min(w / page.stage.width, h / page.stage.height)
      setFit({ scale, x: (w - page.stage.width * scale) / 2, y: (h - page.stage.height * scale) / 2 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page.stage.width, page.stage.height])

  // Space plays / pauses (typing in a field keeps its own space).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  // Scrub: drag anywhere on the strip. Playback pauses while dragging and resumes after.
  const scrubbing = useRef<{ resume: boolean } | null>(null)
  const timeFromPointer = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * duration
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbing.current = { resume: playingRef.current }
    stopLoop()
    seek(timeFromPointer(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) seek(timeFromPointer(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return
    const { resume } = scrubbing.current
    scrubbing.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (resume) play()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 1 / fps
    if (e.key === 'ArrowLeft') seek(tRef.current - step)
    else if (e.key === 'ArrowRight') seek(tRef.current + step)
    else if (e.key === 'Home') seek(0)
    else if (e.key === 'End') seek(duration)
    else return
    e.preventDefault()
  }

  const laneOf = useMemo(() => lanes(scenes), [scenes])
  const laneCount = Math.max(1, ...laneOf.map((l) => l + 1))

  return (
    <>
      <div className="stage page-stage" data-testid="page-stage">
        <div className="page-fit" ref={fitRef}>
          <div
            ref={hostRef}
            className="page-host"
            style={{ width: page.stage.width, height: page.stage.height, transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}
          />
        </div>
        {error && <p className="page-error" role="alert">The video could not be loaded: {error}</p>}
      </div>

      <div
        className="page-timeline"
        data-testid="page-timeline"
        style={{ height: 22 + laneCount * 24 }}
      >
        <div
          className="pt-track"
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className="pt-rail"><div className="pt-fill" ref={fillRef} /></div>
          <div className="pt-scenes">
            {scenes.map((s, i) => (
              <div
                key={`${s.name}-${i}`}
                className="pt-scene"
                data-scene-bar={s.name}
                style={{
                  left: `${(s.start / duration) * 100}%`,
                  width: `${Math.max(0.5, ((s.end - s.start) / duration) * 100)}%`,
                  top: laneOf[i] * 24,
                }}
                title={`${s.name}: ${s.start.toFixed(1)} s to ${s.end.toFixed(1)} s`}
              >
                <span>{s.name}</span>
              </div>
            ))}
          </div>
          <div className="pt-playhead" ref={playheadRef} />
        </div>
      </div>

      <div className="transport">
        <button type="button" className="btn icon" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play / Pause (Space)" data-testid="play">
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <button type="button" className="btn icon" onClick={stop} aria-label="Stop" title="Stop">
          <Square size={13} fill="currentColor" />
        </button>
        <span className="time"><b ref={readoutRef}>00:00:00:00</b> | {total}</span>
        <span className="spacer" />
        <button type="button" className="btn icon" onClick={onToggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen} title="Full screen (F)" data-testid="fullscreen">
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </>
  )
}
