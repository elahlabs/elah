import { getFont } from '../fonts/registry'
import type { PropDef, PropIssue, PropValue } from './types'

export interface ValidatedProps {
  /** One entry per prop, always complete: input, else base, else default. */
  values: Record<string, PropValue>
  issues: PropIssue[]
  /** No issue with severity 'error'. */
  ok: boolean
}

function labelOf(def: PropDef): string {
  return def.label || def.name
}

function issueFor(def: PropDef, code: PropIssue['code'], severity: PropIssue['severity'], message: string): PropIssue {
  return { kind: 'prop', prop: def.name, code, severity, message }
}

/**
 * True when `value` is safe to hand a browser as an image/video/audio source:
 * no whitespace, and `https://`, `http://`, `blob:`, `data:`, or a single
 * leading `/` (root-relative, never `//`, which is protocol-relative and lets
 * a saved project silently point at a different host).
 */
export function isMediaUrl(value: string): boolean {
  if (/\s/.test(value)) return false
  if (value.startsWith('https://') || value.startsWith('http://') || value.startsWith('blob:') || value.startsWith('data:')) {
    return true
  }
  return value.startsWith('/') && !value.startsWith('//')
}

/**
 * Coerce one raw value into a prop's type. `raw` that is `undefined`, `null`
 * or `''` means *absent*: `{}` with no issue, so a caller can fall back to a
 * base value or the prop's default without reporting anything.
 */
export function coerceProp(def: PropDef, raw: unknown): { value?: PropValue; issue?: PropIssue } {
  if (raw === undefined || raw === null || raw === '') return {}
  const label = labelOf(def)

  switch (def.type) {
    case 'number': {
      let n: number
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        n = raw
      } else if (typeof raw === 'string' && Number.isFinite(Number(raw.trim()))) {
        n = Number(raw.trim())
      } else {
        return { issue: issueFor(def, 'wrong-type', 'error', `"${label}" must be a number`) }
      }
      const min = def.min ?? -Infinity
      const max = def.max ?? Infinity
      const clamped = Math.min(max, Math.max(min, n))
      const rangeIssue =
        clamped !== n ? issueFor(def, 'out-of-range', 'warning', `"${label}" was clamped to ${clamped}`) : undefined
      const value = def.integer ? Math.round(clamped) : clamped
      return { value, issue: rangeIssue }
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw }
      if (raw === 1) return { value: true }
      if (raw === 0) return { value: false }
      if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase()
        if (s === 'true' || s === '1' || s === 'yes') return { value: true }
        if (s === 'false' || s === '0' || s === 'no') return { value: false }
      }
      return { issue: issueFor(def, 'wrong-type', 'error', `"${label}" must be yes or no`) }
    }

    case 'color': {
      if (typeof raw === 'string') {
        const s = raw.trim()
        const m3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(s)
        if (m3) return { value: `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase() }
        if (/^#[0-9a-fA-F]{6}$/.test(s)) return { value: s.toLowerCase() }
      }
      return { issue: issueFor(def, 'bad-color', 'error', `"${label}" must be a colour like #ff8800`) }
    }

    case 'enum': {
      if (typeof raw === 'string') {
        const s = raw.trim()
        if ((def.options ?? []).includes(s)) return { value: s }
      }
      return {
        issue: issueFor(def, 'not-an-option', 'error', `"${label}" must be one of: ${(def.options ?? []).join(', ')}`),
      }
    }

    case 'text': {
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
        return { issue: issueFor(def, 'wrong-type', 'error', `"${label}" must be text`) }
      }
      const s = String(raw)
      const max = def.maxLength ?? 500
      if (s.length > max) {
        return { value: s.slice(0, max), issue: issueFor(def, 'too-long', 'warning', `"${label}" was cut to ${max} characters`) }
      }
      return { value: s }
    }

    case 'image':
    case 'video':
    case 'audio': {
      if (typeof raw === 'string') {
        const s = raw.trim()
        if (isMediaUrl(s)) return { value: s }
      }
      return { issue: issueFor(def, 'bad-url', 'error', `"${label}" must be a web address (https://…)`) }
    }

    case 'fontId': {
      if (typeof raw === 'string') {
        const s = raw.trim()
        if (getFont(s) !== undefined) return { value: s }
      }
      return { issue: issueFor(def, 'unknown-font', 'error', `"${label}" is not a font this app has`) }
    }

    default:
      return { issue: issueFor(def, 'wrong-type', 'error', `"${label}" is not a value this prop accepts`) }
  }
}

/** A prop's value with nothing usable to coerce: the closest safe default. */
export function fallbackValue(def: PropDef): PropValue {
  switch (def.type) {
    case 'number': {
      const min = def.min ?? -Infinity
      const max = def.max ?? Infinity
      return Math.min(max, Math.max(min, 0))
    }
    case 'color':
      return '#ffffff'
    case 'boolean':
      return false
    case 'enum':
      return def.options?.[0] ?? ''
    default:
      return ''
  }
}

function hasOwn(o: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key)
}

/**
 * Turn raw input (CSV strings included) into a complete, typed value per
 * prop, falling back from `input` to `base` (a previously stored value; a bad
 * one falls back silently, without reporting anything) to `def.default`. Also
 * reports every key in `input` that names no prop.
 */
export function validateProps(
  props: ReadonlyArray<PropDef>,
  input: Readonly<Record<string, unknown>>,
  base?: Readonly<Record<string, unknown>>,
): ValidatedProps {
  const values: Record<string, PropValue> = {}
  const issues: PropIssue[] = []
  const propNames = new Set(props.map((def) => def.name))

  for (const def of props) {
    const r = coerceProp(def, hasOwn(input, def.name) ? input[def.name] : undefined)
    if (r.issue) issues.push(r.issue)
    if (r.value !== undefined) {
      values[def.name] = r.value
      continue
    }
    const b = coerceProp(def, base?.[def.name])
    if (b.value !== undefined && b.issue?.severity !== 'error') {
      values[def.name] = b.value
      continue
    }
    const d = coerceProp(def, def.default)
    values[def.name] = d.value !== undefined && d.issue?.severity !== 'error' ? d.value : fallbackValue(def)
  }

  for (const key of Object.keys(input)) {
    if (!propNames.has(key)) {
      issues.push({ kind: 'prop', prop: key, code: 'unknown-prop', severity: 'warning', message: `No prop named "${key}"` })
    }
  }

  return { values, issues, ok: !issues.some((i) => i.severity === 'error') }
}
