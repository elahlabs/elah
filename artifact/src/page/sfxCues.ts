/**
 * Sound cues in a programmatic video (TICKET-PF-13).
 *
 * An element (or a whole scene) declares `data-sfx="whoosh"`, optionally `data-sfx-gain="0.5"`. The cue fires at that
 * element's first animation start: the earliest `delay` among the animations on the element and inside it, read from the
 * mounted page's WAAPI timing (so `calc(var(--at) + 0.2s)` is already resolved by the browser), clamped to the video.
 * Infinite ambient loops are ignored when the element has a finite animation.
 *
 * The cues become audio clips through PF-12's resolver (`../sfx.ts`), so Preview, Export and Edit share one answer:
 *   - `cueProject` builds a small audio-only Project that core's `renderAudioMix` mixes for the MP4 (encode.ts);
 *   - `createCuePlayer` schedules the same clips with WebAudio against the page player's clock (PagePlayer.tsx);
 *   - convert.ts adds the same clips to the converted project on Edit.
 */

import type { Clip, Project } from '@elah/core'
import { addSfxClips, resolveCue, sfxBaseUrl } from '../sfx'

export interface PageCue {
  /** The cue word as written (lower-cased). */
  cue: string
  /** Seconds from the start of the video. */
  at: number
  /** 0..1, from `data-sfx-gain`; absent = the resolver's default. */
  gain?: number
  /** A short description of the element, for reports. */
  where: string
}

export interface CueRead {
  cues: PageCue[]
  /** Plain-language notes: unknown words, a bad gain, an element with no animation. */
  notes: Array<{ where: string; message: string }>
}

function describe(el: Element): string {
  const scene = el.getAttribute('data-scene')
  if (scene) return `scene "${scene}"`
  const cls = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join('')
  return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}>`
}

/**
 * Read every `[data-sfx]` element under the stage and its first animation start (seconds). Pure apart from reading the
 * DOM and the animations' timing; `anims` is the list the player collected at mount (all of them, paused).
 */
export function cuesFromPage(stageEl: HTMLElement, anims: readonly Animation[], durationSeconds: number): CueRead {
  const cues: PageCue[] = []
  const notes: CueRead['notes'] = []
  const els = Array.from(stageEl.querySelectorAll<HTMLElement>('[data-sfx]'))
  for (const el of els) {
    const where = describe(el)
    const cue = (el.getAttribute('data-sfx') ?? '').trim().toLowerCase()
    if (!cue) continue
    if (!resolveCue(cue)) {
      notes.push({ where, message: `unknown sound cue "${cue}"; not played` })
      continue
    }
    let gain: number | undefined
    const rawGain = el.getAttribute('data-sfx-gain')
    if (rawGain !== null && rawGain.trim() !== '') {
      const g = Number(rawGain)
      if (Number.isFinite(g) && g >= 0) gain = Math.min(1, g)
      else notes.push({ where, message: `data-sfx-gain="${rawGain}" is not a number from 0 to 1; the default loudness is used` })
    }
    let finite = Infinity
    let any = Infinity
    for (const a of anims) {
      const effect = a.effect as KeyframeEffect | null
      const target = effect?.target
      if (!effect || !target || (target !== el && !el.contains(target))) continue
      const timing = effect.getTiming()
      const delay = Number(timing.delay ?? 0)
      if (!Number.isFinite(delay)) continue
      any = Math.min(any, delay)
      if (Number.isFinite(Number(timing.iterations ?? 1))) finite = Math.min(finite, delay)
    }
    const startMs = Number.isFinite(finite) ? finite : any
    if (!Number.isFinite(startMs)) notes.push({ where, message: `data-sfx="${cue}" is on an element with no animation; it plays at 0 s` })
    const at = Math.min(Math.max(0, Number.isFinite(startMs) ? startMs / 1000 : 0), durationSeconds)
    cues.push({ cue, at, ...(gain !== undefined ? { gain } : {}), where })
  }
  cues.sort((a, b) => a.at - b.at)
  return { cues, notes }
}

/**
 * The cues as audio clips on one "Sound effects" track of a stub project the length of the video (clips cut at the end,
 * a cue at the very end dropped). Null when no cue resolves.
 */
export function cueProject(
  cues: readonly PageCue[],
  page: { fps: number; durationSeconds: number; stage: { width: number; height: number } },
  baseUrl: string = sfxBaseUrl(),
): Project | null {
  if (!cues.length) return null
  const fps = page.fps
  const frames = Math.max(1, Math.round(page.durationSeconds * fps))
  const stub = { id: 'elah-sfx-mix', fps, stage: page.stage, tracks: [], clips: {}, transitions: [], version: 1 } as unknown as Project
  const { project } = addSfxClips(stub, cues.map((c) => ({ at: c.at, cue: c.cue, gain: c.gain })), baseUrl)
  const clips: Record<string, Clip[]> = {}
  let count = 0
  for (const [trackId, list] of Object.entries(project.clips)) {
    clips[trackId] = list
      .filter((c) => c.startFrame < frames)
      .map((c) => ({ ...c, name: sfxClipName(c), durationFrames: Math.min(c.durationFrames, frames - c.startFrame) }))
    count += clips[trackId]!.length
  }
  return count ? { ...project, clips } : null
}

/** `sfx · whoosh` (the clip name the ticket asks for; PF-12's resolver names them `sfx whoosh`). */
export function sfxClipName(c: Pick<Clip, 'name'>): string {
  return c.name.replace(/^sfx\s+(?!·)/, 'sfx · ')
}

/** Every audio clip of a project's top level, flattened, in start order. */
export function cueClips(project: Project): Clip[] {
  return Object.values(project.clips)
    .flat()
    .filter((c) => c.type === 'audio')
    .sort((a, b) => a.startFrame - b.startFrame)
}

// ---------------------------------------------------------------------------------------------------------------------
// Preview: WebAudio against the page player's clock
// ---------------------------------------------------------------------------------------------------------------------

export interface CuePlayer {
  /** Keep the sounds in step with the player: call on play, pause, every seek and every playing tick. */
  sync(t: number, playing: boolean): void
  /** How many sources are scheduled right now, and the context state (for browser checks). */
  state(): { scheduled: number; context: AudioContextState | 'none'; decoded: number; started: number }
  dispose(): void
}

interface Slot {
  src: string
  at: number
  seconds: number
  gain: number
}

/** Drift (s) between the player clock and the audio clock above which every cue is rescheduled. */
const RESYNC = 0.06

/**
 * Plays `project`'s cue clips in sync with a player clock. The AudioContext is created on the first `sync(t, true)`,
 * which always follows a click or a key press (Play), so autoplay rules allow it. Files are fetched at once and
 * decoded once. A seek, a pause or a jump in the player clock stops every source and schedules again.
 */
export function createCuePlayer(project: Project): CuePlayer {
  const fps = project.fps
  const slots: Slot[] = cueClips(project).map((c) => ({
    src: c.src!,
    at: c.startFrame / fps,
    seconds: c.durationFrames / fps,
    gain: c.volume ?? 1,
  }))
  const bytes = new Map<string, Promise<ArrayBuffer>>()
  for (const s of slots) if (!bytes.has(s.src)) bytes.set(s.src, fetch(s.src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))))
  const buffers = new Map<string, AudioBuffer>()
  let ctx: AudioContext | null = null
  let decoding: Promise<void> | null = null
  let live: AudioBufferSourceNode[] = []
  let anchor: { ctxTime: number; t: number } | null = null
  let playing = false
  let lastT = 0
  let started = 0
  let disposed = false

  const stopAll = () => {
    for (const n of live) {
      try {
        n.stop()
      } catch {
        /* never started */
      }
      n.disconnect()
    }
    live = []
    anchor = null
  }

  const schedule = (t: number) => {
    stopAll()
    if (!ctx || !playing) return
    const now = ctx.currentTime
    anchor = { ctxTime: now, t }
    for (const s of slots) {
      const buf = buffers.get(s.src)
      if (!buf) continue
      const end = s.at + Math.min(s.seconds, buf.duration)
      if (end <= t) continue
      const offset = Math.max(0, t - s.at)
      const node = ctx.createBufferSource()
      node.buffer = buf
      const g = ctx.createGain()
      g.gain.value = s.gain
      node.connect(g).connect(ctx.destination)
      node.start(now + Math.max(0, s.at - t), offset, end - s.at - offset)
      node.onended = () => {
        live = live.filter((x) => x !== node)
      }
      live.push(node)
      started++
    }
  }

  const ensureContext = () => {
    if (ctx || disposed) return
    const AC: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = new AC()
    const c = ctx
    decoding = Promise.all(
      [...bytes].map(async ([src, p]) => {
        try {
          // decodeAudioData detaches its input; keep the fetched bytes reusable by copying.
          const buf = await c.decodeAudioData((await p).slice(0))
          buffers.set(src, buf)
        } catch (e) {
          console.warn(`[sfx] could not decode ${src}`, e)
        }
      }),
    ).then(() => {
      // Decoding finished after Play: start the cues from where the player is now.
      if (playing && !disposed) schedule(lastT)
    })
  }

  return {
    sync(t, isPlaying) {
      if (disposed || !slots.length) return
      lastT = t
      if (!isPlaying) {
        playing = false
        stopAll()
        return
      }
      ensureContext()
      if (!ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      if (!playing) {
        playing = true
        schedule(t)
        return
      }
      // Playing: follow the player's clock; reschedule on a jump (seek, wrap at the end, a throttled frame).
      const expected = anchor ? anchor.t + (ctx.currentTime - anchor.ctxTime) : NaN
      if (!anchor || !(Math.abs(expected - t) <= RESYNC)) schedule(t)
    },
    state() {
      return { scheduled: live.length, context: ctx ? ctx.state : 'none', decoded: buffers.size, started }
    },
    dispose() {
      disposed = true
      playing = false
      stopAll()
      void decoding
      if (ctx) void ctx.close().catch(() => undefined)
      ctx = null
    },
  }
}
