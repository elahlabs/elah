/**
 * TICKET-PF-16: comments pinned to a moment in the video, through the `comments` capability's custom anchors.
 *
 * Anchor names are the page's own durable words for a spot, and they are what Claude reads as the thread's
 * location, so they stay legible: `t=12.40` (seconds, two decimals) or `t=12.40;clip=<clipId>` in the editor.
 * The shell keeps and renders every thread, card and composer; this module only
 *   - registers `customAnchors` once at load (it writes nothing, so load is allowed),
 *   - opens the shell's composer at a moment (`compose`), only from the viewer's gesture,
 *   - reports where each thread's pin goes (`placed`) after every thread list, re-render, seek, zoom, scroll
 *     and resize. A thread whose moment is not on screen is reported `null` and shows in the shell's list.
 * Outside claude.ai `getCap('comments')` is null: nothing registers, `useMomentComments().available` stays
 * false and no comment UI renders. The page builds no thread list of its own (the contract is write-only).
 */
import { useSyncExternalStore } from 'react'
import { getCap } from './claudeCaps'

/** Document CSS pixels, scroll offset included (pageX/pageY). */
export interface DocPoint {
  x: number
  y: number
}

/** A moment: seconds from the start, and in the editor optionally the clip it is about. */
export interface Moment {
  t: number
  clip?: string
}

interface OverrideThread {
  id: string
  anchor: string
  resolved: boolean
  active: boolean
}

interface ComposeOptions {
  label?: string
  detail?: string
  area?: boolean
}

interface AnchorsController {
  compose(anchor: string, at: Element | DocPoint, opts?: ComposeOptions): Promise<{ opened: boolean }>
  open(id: string, at: Element | DocPoint): Promise<void>
  placed(map: Record<string, DocPoint | null>): void
  exitMode(): void
  release(): void
}

interface AnchorsCallbacks {
  mode: (on: boolean) => void
  threads: (list: OverrideThread[]) => void
  reveal: (id: string) => void
  composing?: (open: boolean) => void
  move?: (id: string, at: DocPoint) => ({ anchor: string; at: DocPoint; label?: string } | null)
}

interface CommentsWithAnchors {
  customAnchors?: (cb: AnchorsCallbacks) => Promise<AnchorsController>
}

/**
 * What the mounted shell (programmatic-video preview or editor) tells this module. Points are CLIENT pixels;
 * the module adds the scroll offset.
 */
export interface PinSurface {
  /** Where a moment's pin belongs, or null when that moment is not on screen. */
  pointFor(m: Moment): { x: number; y: number } | null
  /** The moment under a client point (stage, scrub strip, timeline, clip), or null when it is none of those. */
  momentAt(clientX: number, clientY: number): Moment | null
  /** Bring a moment into view (the shell opened its thread from the list). */
  reveal(m: Moment): void
}

// ---------------------------------------------------------------------------------------------------------
// Anchor names

const MAX_ANCHOR_BYTES = 128
const CLIP_ID = /^[A-Za-z0-9_.:-]+$/

export function formatAnchor(m: Moment): string {
  const base = `t=${Math.max(0, m.t).toFixed(2)}`
  if (!m.clip || !CLIP_ID.test(m.clip)) return base
  const withClip = `${base};clip=${m.clip}`
  return new TextEncoder().encode(withClip).length <= MAX_ANCHOR_BYTES ? withClip : base
}

export function parseAnchor(anchor: string): Moment | null {
  const m = /^t=(\d+(?:\.\d+)?)(?:;clip=([A-Za-z0-9_.:-]+))?$/.exec(anchor.trim())
  if (!m) return null
  const t = Number(m[1])
  if (!Number.isFinite(t)) return null
  return m[2] ? { t, clip: m[2] } : { t }
}

/** "0:12" (or "1:02:05" past an hour). */
export function clockLabel(t: number): string {
  const s = Math.max(0, Math.floor(t))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// ---------------------------------------------------------------------------------------------------------
// Geometry helpers shared by the two shells

/** The element's client rect when it is rendered and has area, else null. */
export function shownRect(el: Element | null | undefined): DOMRect | null {
  if (!el || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

export function inside(r: DOMRect, x: number, y: number, pad = 0): boolean {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
}

/** A pin on a full-width scrub strip: x by time, on the rail. */
export function stripPoint(track: DOMRect, t: number, duration: number): { x: number; y: number } | null {
  if (!(duration > 0) || t < 0 || t > duration + 1e-3) return null
  return { x: track.left + (Math.min(t, duration) / duration) * track.width, y: track.top + 3 }
}

/** The fallback when no strip or timeline is shown (theater): the player's bottom edge, x by time. */
export function edgePoint(stage: DOMRect, t: number, duration: number): { x: number; y: number } | null {
  if (!(duration > 0) || t < 0 || t > duration + 1e-3) return null
  return { x: stage.left + (Math.min(t, duration) / duration) * stage.width, y: stage.bottom - 6 }
}

export function stripTime(track: DOMRect, clientX: number, duration: number): number {
  return Math.min(1, Math.max(0, (clientX - track.left) / track.width)) * duration
}

// ---------------------------------------------------------------------------------------------------------
// Registration and placement (one per page load)

let started = false
let controller: AnchorsController | null = null
let available = false
let modeOn = false
let threads: OverrideThread[] = []
let surface: PinSurface | null = null
let frame = 0
const subscribers = new Set<() => void>()

const notify = () => subscribers.forEach((f) => f())

function toDoc(p: { x: number; y: number }): DocPoint {
  return { x: Math.round(p.x + window.scrollX), y: Math.round(p.y + window.scrollY) }
}

/** A shell CSS-path anchor (the follow-up buttons' threads, PF-10): pin it on that element when it is shown. */
function domPoint(anchor: string): { x: number; y: number } | null {
  try {
    const r = shownRect(document.querySelector(anchor))
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  } catch {
    return null
  }
}

function report() {
  frame = 0
  const ctl = controller
  if (!ctl) return
  const map: Record<string, DocPoint | null> = {}
  for (const th of threads) {
    let p: { x: number; y: number } | null = null
    try {
      const m = parseAnchor(th.anchor)
      p = m ? (surface?.pointFor(m) ?? null) : domPoint(th.anchor)
    } catch {
      p = null
    }
    map[th.id] = p ? toDoc(p) : null
  }
  try {
    ctl.placed(map)
  } catch {
    /* the shell stopped answering; nothing to do */
  }
}

/** Re-report pins on the next frame (coalesced). Call after anything that moves the subjects. */
export function requestPlace() {
  if (!controller || frame) return
  frame = requestAnimationFrame(report)
}

/** The mounted shell hands over its geometry; returns the cleanup. */
export function setPinSurface(s: PinSurface): () => void {
  surface = s
  requestPlace()
  return () => {
    if (surface === s) surface = null
    requestPlace()
  }
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const callbacks: AnchorsCallbacks = {
  mode: (on) => {
    modeOn = on
    if (!on) threads = [] // drop the list and its handles
    requestPlace()
  },
  threads: (list) => {
    threads = Array.isArray(list) ? list.slice(0, 256) : []
    // The first report (an empty map included) tells the shell the page is listening.
    if (controller) report()
  },
  reveal: (id) => {
    const th = threads.find((x) => x.id === id)
    const m = th ? parseAnchor(th.anchor) : null
    if (m && surface) surface.reveal(m)
    else if (th) {
      try {
        document.querySelector(th.anchor)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      } catch {
        /* not a selector */
      }
    }
    requestPlace()
  },
  // The thread's starter dragged its pin: the moment under the drop point becomes its new anchor.
  move: (id, at) => {
    if (!surface || !threads.some((x) => x.id === id)) return null
    const m = surface.momentAt(at.x - window.scrollX, at.y - window.scrollY)
    if (!m) return null
    return { anchor: formatAnchor(m), at, label: `At ${clockLabel(m.t)}` }
  },
}

/** While comment mode is on, a click on the stage, the strip or the timeline starts a comment at that moment. */
function onModeClick(e: MouseEvent) {
  if (!modeOn || !controller || !surface || e.button !== 0) return
  const m = surface.momentAt(e.clientX, e.clientY)
  if (!m) return
  void controller.compose(formatAnchor(m), { x: e.pageX, y: e.pageY }, { label: `At ${clockLabel(m.t)}` }).catch(() => undefined)
}

/** Register custom anchors once, at load. Safe to call repeatedly; resolves quietly when unavailable. */
export async function startMomentComments(): Promise<void> {
  if (started) return
  started = true
  const cap = await getCap<CommentsWithAnchors>('comments')
  if (!cap || typeof cap.customAnchors !== 'function') return
  try {
    controller = await cap.customAnchors(callbacks)
  } catch {
    controller = null // not_granted (no customAnchors in the declaration), capability_disabled, ...: shell anchoring
    return
  }
  available = true
  notify()
  report() // after a thread list that arrived before registration resolved, or an empty map
  const again = () => requestPlace()
  window.addEventListener('resize', again)
  document.addEventListener('scroll', again, { capture: true, passive: true }) // timeline and panel scrolls
  document.addEventListener('click', onModeClick, true)
  if (typeof ResizeObserver === 'function') new ResizeObserver(again).observe(document.body)
}

/** Open the shell's composer for a NEW thread at moment `m`, placed at `at`. Only from the viewer's gesture. */
export async function composeAt(m: Moment, at: Element, label?: string): Promise<void> {
  const ctl = controller
  if (!ctl) return
  try {
    await ctl.compose(formatAnchor(m), at, { label: (label ?? `At ${clockLabel(m.t)}`).slice(0, 200) })
  } catch (e) {
    const code = (e as { code?: string } | null)?.code
    // Permanent for this view: hide the affordance. Anything else (rate_limited, a soft refusal) leaves it.
    if (code === 'forbidden' || code === 'unavailable' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      available = false
      notify()
    }
  }
}

const subscribe = (f: () => void) => {
  subscribers.add(f)
  return () => subscribers.delete(f)
}

/** True once custom anchors are registered in this view (never outside claude.ai). */
export function useMomentComments(): boolean {
  return useSyncExternalStore(subscribe, () => available, () => false)
}
