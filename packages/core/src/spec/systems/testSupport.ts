/**
 * Shared scaffolding for the system tests — not a test file itself.
 */

import type { Clip, Project } from '../../types'
import { buildVideo } from '../build'
import { expandComponents } from '../components'
import type { AuthoredElement, AuthoredSpec } from '../components/types'
import type { SpecElement, SpecFormat, SpecIssue } from '../types'
import { sampleSpecKeys } from './freeze'

export const FORMAT: SpecFormat = { width: 1080, height: 1920, fps: 30 }

export function specOf(elements: AuthoredElement[], extra: Partial<AuthoredSpec> = {}): AuthoredSpec {
  return {
    format: FORMAT,
    duration: 12,
    design: { colors: [{ name: 'accent', value: '#22c55e' }] },
    elements,
    ...extra,
  }
}

/** A 100 px square placed at x,y (fractions), alive 0..6 s. */
export function square(id: string, x: number, y: number, extra: Partial<SpecElement> = {}): SpecElement {
  return { id, kind: 'shape', shape: 'rect', at: 0, duration: 6, x, y, w: 100, h: 100, fill: '#111111', ...extra }
}

/** A system element. `params` is a plain record here, turned into rows. */
export function sys(
  id: string,
  system: string,
  extra: Record<string, unknown> & { params?: Record<string, number | string | boolean> } = {},
): AuthoredElement {
  const { params, ...rest } = extra
  return {
    id,
    kind: 'system',
    system,
    at: 1,
    duration: 1,
    ...rest,
    ...(params ? { params: Object.entries(params).map(([name, value]) => ({ name, value })) } : {}),
  } as AuthoredElement
}

export function expand(elements: AuthoredElement[], seed = 1, extra: Partial<AuthoredSpec> = {}) {
  return expandComponents(specOf(elements, extra), { seed })
}

/** The full pipeline, unpolished, so keys are exactly what the system wrote. */
export function build(elements: AuthoredElement[], seed = 1, extra: Partial<AuthoredSpec> = {}) {
  return buildVideo(structuredClone(specOf(elements, extra)), { polish: false, seed })
}

export const errorsOf = (issues: ReadonlyArray<SpecIssue>) => issues.filter((i) => i.severity === 'error')

export function byId(elements: ReadonlyArray<SpecElement>, id: string): SpecElement {
  const found = elements.find((e) => e.id === id)
  if (!found) throw new Error(`no element "${id}" in [${elements.map((e) => e.id).join(', ')}]`)
  return found
}

/** One channel's keys on a spec element, sorted by time. */
export function keysOn(el: SpecElement, channel: string) {
  return (el.keys ?? []).filter((k) => k.channel === channel).sort((a, b) => a.at - b.at)
}

/** The value a spec element's channel takes at `t` seconds from its own start, by the engine's rules. */
export function valueAt(el: SpecElement, channel: string, t: number): number {
  return sampleSpecKeys(keysOn(el, channel), t)
}

export function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

/** Every clip in the project including those inside compounds. */
export function deepClips(project: Project): Clip[] {
  return allClips(project).flatMap((c) => [c, ...(c.compound?.project ? deepClips(c.compound.project) : [])])
}
