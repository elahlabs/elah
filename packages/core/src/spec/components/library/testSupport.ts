/**
 * Shared test scaffolding for AV-8a's eight `library/*.test.ts` files — not a
 * test file itself, so it carries no assertions of its own; it exists so
 * eight component tests do not each re-derive "build one component, look at
 * its expanded parts" from scratch. A helper file under `library/`, same as
 * `textMetrics.ts` / `idleMotion.ts` (see TICKET-AV-8a.md's allowlist).
 */

import { buildVideo } from '../../build'
import { expandComponents } from '../index'
import type { AuthoredSpec, SpecComponent } from '../types'
import type { SpecElement, SpecFormat, SpecIssue } from '../../types'

export const FORMAT: SpecFormat = { width: 1080, height: 1920, fps: 30 }

type AuthoredComponent = Partial<Omit<SpecComponent, 'id' | 'kind' | 'component'>> & { component: string; id?: string }

export function specFor(component: AuthoredComponent, extra: Partial<AuthoredSpec> = {}): AuthoredSpec {
  return {
    format: FORMAT,
    duration: 30,
    design: {
      colors: [{ name: 'accent', value: '#22c55e' }],
      fonts: [{ role: 'serif', font: 'playfair-display' }],
    },
    elements: [{ id: 'x', kind: 'component', at: 0, duration: 3, ...component } as unknown as SpecElement],
    ...extra,
  }
}

export interface Expanded {
  group: SpecElement
  parts: SpecElement[]
  issues: SpecIssue[]
}

/** Expand (no compile) one component, keyed `x`, and return its group + parts. */
export function expandOne(component: AuthoredComponent, opts: { seed?: number; noDesign?: boolean } = {}): Expanded {
  const spec = specFor(component)
  if (opts.noDesign) delete spec.design
  const { spec: out, issues } = expandComponents(spec, { seed: opts.seed ?? 1 })
  const group = out.elements[0]!
  return { group, parts: group.children ?? [], issues }
}

/** Full pipeline (expand, no polish, compile) — for the "zero error issues" acceptance row. */
export function buildOne(component: AuthoredComponent, opts: { seed?: number } = {}) {
  return buildVideo(specFor(component), { polish: false, seed: opts.seed ?? 1 })
}

export function errorsOf(issues: SpecIssue[]): SpecIssue[] {
  return issues.filter((i) => i.severity === 'error')
}

/** Every keyframe on `channel` across `part.keys`, sorted by time. */
export function keysOn(part: SpecElement, channel: string) {
  return (part.keys ?? []).filter((k) => k.channel === channel).sort((a, b) => a.at - b.at)
}

/** True when `part` has SOME idle motion: an expression, or more than the bare arrival+exit keys on any channel (a continuous ramp). */
export function hasIdleMotion(part: SpecElement): boolean {
  if ((part.expressions ?? []).length > 0) return true
  const byChannel = new Map<string, number>()
  for (const k of part.keys ?? []) byChannel.set(k.channel, (byChannel.get(k.channel) ?? 0) + 1)
  // A channel with keys spread across more than a simple 2-key arrival/2-key exit pair (or a >2-key custom ramp) reads as ongoing motion.
  return [...byChannel.values()].some((n) => n > 4)
}

/** True when `part` ends with an opacity ramp down to 0 — the shared shape of every exit in this library (`exitOut`, or a hand-built equivalent). */
export function hasExit(part: SpecElement): boolean {
  const opacity = keysOn(part, 'opacity')
  const last = opacity[opacity.length - 1]
  return last !== undefined && last.value === 0
}
