/**
 * Event-bound sound cues (MI-P6): `{ cue, on: { element, event } }` -> `SpecSfx { at, cue, gain }`.
 *
 * A model that writes a sound cue in seconds guesses the second an element lands on, and the guess goes
 * stale the moment a scene is retimed. An authored cue can instead name the element and the moment
 * (`arrive`, `exit`, or the Nth key on a channel); this pass reads the time off the element's own keys
 * and presets and hands the engine the frozen `SpecSfx` shape. Pure and total: no engine, no I/O, never
 * throws. A cue it cannot place is dropped with a `warn` (a missing sound is better than a wrong one).
 *
 * It runs on the EXPANDED spec (after components and systems), so a swarm copy or a component part is
 * addressable by the id the expander gave it, and before `polishSpec`, so what it reads is what the
 * author (or a system) wrote. It never caps: the cap is a scene-scope concern of the director.
 *
 * What the three events mean, in seconds from the START OF THE ELEMENT (`at` is added afterwards):
 *   arrive  the earliest key on opacity/scale/x/y, or 0 when the element has an `enter` preset
 *           (whichever is earlier). No keys and no preset: nothing to read, the cue is dropped.
 *   exit    the latest key on those channels, or `duration - exitDuration` when it has an `exit` preset
 *           (whichever is later; the preset's own default ramp when `exitDuration` is omitted).
 *   key     `keys[]` entry `index` (0-based) among the element's keys on `channel`, in the element's own
 *           key order; with no `channel`, among all its keys.
 * `offset` (clamped to -0.5..0.5 s) is added last. Inside a group, the group's own `at` chain is added,
 * because a child's `at` and keys are relative to the group.
 */

import { resolveTemplateRamp } from '../elements/textTemplates'
import type { AuthoredEventSfx, AuthoredSfx, SfxEvent } from './components/types'
import type { SpecElement, SpecIssue, SpecSfx } from './types'

export const SFX_EVENTS = ['arrive', 'exit', 'key'] as const

/**
 * The cue words the client resolves from a curated pack before it searches (web `sfxPacks.ts`, whose
 * test asserts its keys equal this list). Names only: core carries no sound ids.
 */
export const SFX_CUE_WORDS = ['pop', 'click', 'tick', 'whoosh', 'snap', 'impact', 'swoosh', 'chime'] as const

/** Words a model reaches for that mean one of the pack words. */
export const SFX_CUE_SYNONYMS: Readonly<Record<string, (typeof SFX_CUE_WORDS)[number]>> = {
  ding: 'chime',
  swish: 'swoosh',
}

/** Channels whose first/last key mark an element arriving/leaving. */
const MOTION_CHANNELS: ReadonlySet<string> = new Set(['opacity', 'scale', 'x', 'y'])
const OFFSET_LIMIT = 0.5
/** `motionPresetKeys`' default ramp, as a fraction of the clip (elements/motionPresets.ts). */
const DEFAULT_RAMP_FRACTION = 0.25

export interface LoweredSfx {
  /** `undefined` only when the document had no `sfx` at all. Order follows the authored order. */
  sfx: SpecSfx[] | undefined
  issues: SpecIssue[]
}

interface Located {
  el: SpecElement
  /** Seconds: the sum of every ancestor group's `at`. */
  base: number
}

function locate(elements: ReadonlyArray<SpecElement>, base: number, out: Map<string, Located>): void {
  for (const el of elements) {
    if (!out.has(el.id)) out.set(el.id, { el, base })
    if (el.children) locate(el.children, base + (Number.isFinite(el.at) ? el.at : 0), out)
  }
}

const isEventCue = (cue: AuthoredSfx): cue is AuthoredEventSfx =>
  typeof (cue as AuthoredEventSfx).on === 'object' && (cue as AuthoredEventSfx).on !== null

const isEvent = (v: unknown): v is SfxEvent => typeof v === 'string' && (SFX_EVENTS as ReadonlyArray<string>).includes(v)

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Seconds from the element's own start, or `undefined` when the element gives nothing to read. */
function eventTime(el: SpecElement, on: AuthoredEventSfx['on'], fps: number): number | undefined {
  const keys = (el.keys ?? []).filter((k) => finite(k.at))
  const motion = keys.filter((k) => MOTION_CHANNELS.has(k.channel)).map((k) => k.at)
  if (on.event === 'arrive') {
    const times = [...motion, ...(el.enter ? [0] : [])]
    return times.length > 0 ? Math.min(...times) : undefined
  }
  if (on.event === 'exit') {
    const times = [...motion]
    if (el.exit) {
      const frames = Math.max(1, Math.round((finite(el.duration) ? el.duration : 0) * fps))
      const ramp = finite(el.exitDuration) ? el.exitDuration : resolveTemplateRamp(DEFAULT_RAMP_FRACTION, frames) / fps
      times.push(Math.max(0, (finite(el.duration) ? el.duration : 0) - ramp))
    }
    return times.length > 0 ? Math.max(...times) : undefined
  }
  const pool = on.channel ? keys.filter((k) => k.channel === on.channel) : keys
  const index = finite(on.index) ? Math.max(0, Math.floor(on.index)) : 0
  return pool[index]?.at
}

const round = (n: number) => Math.round(n * 10_000) / 10_000

/**
 * Lower every event-bound cue in `cues` against `elements` (the expanded spec's elements). Seconds cues
 * pass through unchanged (same object, same order); a cue with neither `on` nor a usable `at` is dropped.
 */
export function lowerSfx(cues: ReadonlyArray<AuthoredSfx> | undefined, elements: ReadonlyArray<SpecElement>, fps = 30): LoweredSfx {
  if (!cues) return { sfx: undefined, issues: [] }
  const issues: SpecIssue[] = []
  const byId = new Map<string, Located>()
  if (cues.some(isEventCue)) locate(elements, 0, byId)

  const out: SpecSfx[] = []
  cues.forEach((cue, i) => {
    const path = `sfx[${i}]`
    if (!isEventCue(cue)) {
      if (finite((cue as SpecSfx).at)) out.push(cue as SpecSfx)
      else issues.push({ severity: 'warn', path: `${path}.at`, code: 'sfx-no-event', message: `sound cue "${String(cue.cue)}" has neither a time nor an "on" event; dropped` })
      return
    }
    const { on } = cue
    const found = typeof on.element === 'string' ? byId.get(on.element) : undefined
    if (!found) {
      issues.push({ severity: 'warn', path: `${path}.on.element`, code: 'sfx-unknown-element', message: `sound cue "${cue.cue}" is bound to element "${String(on.element)}", which does not exist; dropped` })
      return
    }
    const t = isEvent(on.event) ? eventTime(found.el, on, fps) : undefined
    if (t === undefined) {
      const why = !isEvent(on.event)
        ? `"${String(on.event)}" is not an event (arrive, exit, key)`
        : on.event === 'key'
          ? `element "${on.element}" has no key ${finite(on.index) ? on.index : 0}${on.channel ? ` on ${on.channel}` : ''}`
          : `element "${on.element}" has no ${on.event === 'arrive' ? 'enter preset or opacity/scale/x/y key' : 'exit preset or opacity/scale/x/y key'} to read`
      issues.push({ severity: 'warn', path: `${path}.on`, code: 'sfx-no-event', message: `sound cue "${cue.cue}" dropped: ${why}` })
      return
    }
    let offset = finite(on.offset) ? on.offset : 0
    if (Math.abs(offset) > OFFSET_LIMIT) {
      offset = Math.sign(offset) * OFFSET_LIMIT
      issues.push({ severity: 'info', path: `${path}.on.offset`, code: 'clamped', message: `sound cue offset limited to ±${OFFSET_LIMIT} s` })
    }
    out.push({
      at: Math.max(0, round(found.base + (finite(found.el.at) ? found.el.at : 0) + t + offset)),
      cue: cue.cue,
      ...(cue.gain !== undefined ? { gain: cue.gain } : {}),
    })
  })
  return { sfx: out, issues }
}
