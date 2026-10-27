/**
 * Helpers the six systems share: param parsing, target-relative time, key merging.
 * Kept out of `index.ts` so the system files can import them without a cycle.
 */

import type { SpecElement, SpecIssue, SpecKey } from '../types'
import { mergeKeys } from '../components/motion'
import type { SystemDef, SystemParamDef, SystemParamValue } from './types'

/** Stage fractions of an element's anchor; an unplaced element sits at the centre. */
export function anchorOf(el: SpecElement): { x: number; y: number } {
  return { x: el.x ?? 0.5, y: el.y ?? 0.5 }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Round away float noise so two expansions serialise identically and a key reads cleanly. */
export const r5 = (v: number) => +v.toFixed(5)

/**
 * Parse a system's `params` rows against its declared defs. An unknown name, a
 * wrong type and an out-of-range number are each a `warn` (never a throw): the
 * default or the clamped value is used and the rest of the system still runs.
 */
export function readParams(
  def: SystemDef,
  rows: ReadonlyArray<{ name: string; value: SystemParamValue }> | undefined,
  issues: SpecIssue[],
  path: string,
): Record<string, SystemParamValue | undefined> {
  const out: Record<string, SystemParamValue | undefined> = {}
  const byName = new Map<string, SystemParamDef>(def.params.map((p) => [p.name, p]))
  for (const p of def.params) out[p.name] = p.default
  ;(rows ?? []).forEach((row, i) => {
    const at = `${path}.params[${i}]`
    const p = byName.get(row?.name)
    if (!p) {
      issues.push({ severity: 'warn', path: at, code: 'unknown-param', message: `${def.name} has no param "${String(row?.name)}"` })
      return
    }
    const v = row.value
    if (p.kind === 'number') {
      const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
      if (!Number.isFinite(num)) {
        issues.push({ severity: 'warn', path: at, code: 'bad-param', message: `${def.name}.${p.name} must be a number; using ${String(p.default)}` })
        return
      }
      const lo = p.min ?? -Infinity
      const hi = p.max ?? Infinity
      const c = clamp(num, lo, hi)
      if (c !== num) {
        issues.push({ severity: 'warn', path: at, code: 'clamped', message: `${def.name}.${p.name} runs ${lo}–${hi}; ${num} became ${c}` })
      }
      out[p.name] = c
    } else if (p.kind === 'boolean') {
      if (typeof v === 'boolean') out[p.name] = v
      else if (v === 'true' || v === 'false') out[p.name] = v === 'true'
      else issues.push({ severity: 'warn', path: at, code: 'bad-param', message: `${def.name}.${p.name} must be true or false; using ${String(p.default)}` })
    } else if (p.kind === 'enum') {
      if (typeof v === 'string' && (p.options ?? []).includes(v)) out[p.name] = v
      else {
        issues.push({
          severity: 'warn',
          path: at,
          code: 'bad-param',
          message: `${def.name}.${p.name} must be one of ${(p.options ?? []).join(', ')}; using ${String(p.default)}`,
        })
      }
    } else if (typeof v === 'string' && v.length > 0) out[p.name] = v
    else issues.push({ severity: 'warn', path: at, code: 'bad-param', message: `${def.name}.${p.name} must be an element id` })
  })
  return out
}

export const numParam = (params: Readonly<Record<string, SystemParamValue | undefined>>, name: string): number => {
  const v = params[name]
  return typeof v === 'number' ? v : 0
}
export const boolParam = (params: Readonly<Record<string, SystemParamValue | undefined>>, name: string): boolean => params[name] === true
export const strParam = (params: Readonly<Record<string, SystemParamValue | undefined>>, name: string): string | undefined => {
  const v = params[name]
  return typeof v === 'string' ? v : undefined
}

/**
 * The system's time `abs` (seconds on the level's clock) as a key time on
 * `target`: keys are relative to the element that owns them, and cannot be
 * negative. A system that starts before its target does so at the target's 0.
 */
export function keyTime(target: SpecElement, abs: number): number {
  return Math.max(0, r5(abs - target.at))
}

/** True when a target is on screen at `abs` (starts at or before it, ends after it). */
export function activeAt(target: SpecElement, abs: number): boolean {
  return target.at <= abs + 1e-9 && target.at + target.duration > abs
}

/**
 * Add `keys` to `target`. Keys the author already wrote WIN where they overlap
 * on a channel (`mergeKeys`): a system never silently rewrites hand-keyed
 * motion, and says so when part of its own output was dropped for it.
 */
export function addKeys(target: SpecElement, keys: SpecKey[], issues: SpecIssue[], path: string, systemName: string): SpecElement {
  const existing = target.keys ?? []
  const merged = mergeKeys(existing, keys)
  const dropped = existing.length + keys.length - merged.length
  if (dropped > 0) {
    issues.push({
      severity: 'warn',
      path,
      code: 'key-conflict',
      message: `${systemName}: ${dropped} key(s) on "${target.id}" overlap its own keys and were dropped; the element's keys win`,
    })
  }
  return { ...target, keys: merged }
}

const CLIP_REF = /\bclip\(\s*(["'])((?:(?!\1)[^\n\r])*)\1\s*\)/g

/**
 * A deep copy of `template` for one instance: the root gets `rootId`, every
 * descendant gets `${rootId}-${originalId}`, and the references INSIDE the
 * copy (`layout.anchorTo`/`fitTo`, `clip("id")` in an expression) are pointed
 * at the renamed ids. References leaving the template are left alone.
 */
export function cloneAs(template: SpecElement, rootId: string): SpecElement {
  const ids = new Map<string, string>()
  const collect = (el: SpecElement, newId: string) => {
    ids.set(el.id, newId)
    for (const c of el.children ?? []) collect(c, `${rootId}-${c.id}`)
  }
  collect(template, rootId)
  const rename = (el: SpecElement): SpecElement => {
    const out: SpecElement = structuredClone({ ...el, children: undefined })
    out.id = ids.get(el.id) ?? el.id
    if (!el.children) delete out.children
    else out.children = el.children.map(rename)
    if (out.layout?.anchorTo && ids.has(out.layout.anchorTo.element)) {
      out.layout = { ...out.layout, anchorTo: { ...out.layout.anchorTo, element: ids.get(out.layout.anchorTo.element)! } }
    }
    if (out.layout?.fitTo && ids.has(out.layout.fitTo.element)) {
      out.layout = { ...out.layout, fitTo: { ...out.layout.fitTo, element: ids.get(out.layout.fitTo.element)! } }
    }
    if (out.expressions) {
      out.expressions = out.expressions.map((e) => ({
        ...e,
        source: e.source.replace(CLIP_REF, (whole, q: string, id: string) => (ids.has(id) ? `clip(${q}${ids.get(id)}${q})` : whole)),
      }))
    }
    return out
  }
  return rename(template)
}
