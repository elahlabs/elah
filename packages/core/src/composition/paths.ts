import { MAX_COMPOUND_DEPTH } from '../types'
import type { PropValue } from './types'

/**
 * A path through a plain object / array structure: string keys, numeric
 * indices. Never `__proto__`/`prototype`/`constructor`, and never a timeline
 * invariant field (see `STRUCTURAL` below).
 */
export type FieldPath = ReadonlyArray<string | number>

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Fields the timeline itself depends on. Binding one of these would let a
 * composition move a clip off its track or resize it out from under its
 * trim — invariants the engine, not a binding, is responsible for.
 */
const STRUCTURAL = new Set([
  'id', 'trackId', 'type', 'startFrame', 'durationFrames',
  'sourceStartFrame', 'sourceDurationFrames', 'compound', 'linkId',
])

const PART_RE = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\])*)$/
const KEYFRAME_SHORTHAND_RE = /^keyframes\.(.+)\[(\d+)\]\.value$/

/**
 * Split a clip path ('abc' a root clip, 'abc/def' clip 'def' inside compound
 * clip 'abc') into its segments. `null` for anything malformed: an empty
 * string, an empty segment, or more hops than a compound can nest
 * ({@link MAX_COMPOUND_DEPTH} plus the root).
 */
export function parseClipPath(clipId: string): string[] | null {
  const parts = clipId.split('/')
  if (parts.some((p) => p.length === 0)) return null
  if (parts.length > 1 + MAX_COMPOUND_DEPTH) return null
  return parts
}

/**
 * Split a bindable field path into path segments a clip can be walked with
 * ({@link getAtPath} / {@link setAtPath}). `null` for anything unsafe: a
 * malformed segment, a reserved name, a path into a timeline invariant, or a
 * path deeper than 8 segments.
 */
export function parseFieldPath(path: string): FieldPath | null {
  if (path === 'text') return ['content']

  const kf = KEYFRAME_SHORTHAND_RE.exec(path)
  if (kf) {
    const channel = kf[1]!
    if (channel.length === 0) return null
    return ['keyframes', 'channels', channel, 'keys', Number(kf[2]), 'value']
  }

  if (path.length === 0) return null
  const rawParts = path.split('.')
  const out: Array<string | number> = []
  let isFirstPart = true
  for (const raw of rawParts) {
    if (raw.length === 0) return null
    const m = PART_RE.exec(raw)
    if (!m) return null
    const name = m[1]!
    if (FORBIDDEN.has(name)) return null
    if (isFirstPart && STRUCTURAL.has(name)) return null
    isFirstPart = false
    out.push(name)
    const brackets = m[2]!
    if (brackets.length > 0) {
      for (const n of brackets.match(/\d+/g) ?? []) out.push(Number(n))
    }
  }
  if (out.length > 8) return null
  return out
}

/**
 * Read a value at `path`. `undefined` as soon as a container along the way is
 * not a non-null object — arrays count as objects, so a numeric segment reads
 * an array element the same way a string segment reads a property.
 */
export function getAtPath(target: unknown, path: FieldPath): unknown {
  let cur: unknown = target
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[seg]
  }
  return cur
}

/**
 * Write a value at `path`, never creating an intermediate container. Works on
 * plain objects and immer drafts alike (PV-P7a-2 calls this from inside a
 * draft). Depth 1 may create a new top-level field (e.g. `fontId`); deeper
 * paths require every container up to the last to already exist, and an array
 * index — anywhere along the path — to already be in bounds.
 */
export function setAtPath(target: object, path: FieldPath, value: unknown): 'ok' | 'unchanged' | 'missing-target' {
  if (path.length === 0) return 'missing-target'

  let cur: unknown = target
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!
    if (cur === null || typeof cur !== 'object') return 'missing-target'
    if (typeof seg === 'number') {
      if (!Array.isArray(cur) || seg < 0 || seg >= cur.length) return 'missing-target'
      cur = cur[seg]
    } else {
      cur = (cur as Record<string, unknown>)[seg]
    }
  }

  if (cur === null || typeof cur !== 'object') return 'missing-target'
  const last = path[path.length - 1]!
  if (typeof last === 'number') {
    if (!Array.isArray(cur) || last < 0 || last >= cur.length) return 'missing-target'
    if (Object.is(cur[last], value)) return 'unchanged'
    cur[last] = value
    return 'ok'
  }
  const obj = cur as Record<string, unknown>
  if (Object.is(obj[last], value)) return 'unchanged'
  obj[last] = value
  return 'ok'
}

/**
 * Replace every `{propName}` in `template` with the prop's current value.
 * An unknown name is left literal, so a typo in a template does not silently
 * blank part of a clip's text.
 */
export function interpolateTemplate(template: string, values: Readonly<Record<string, PropValue>>): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]{0,39})\}/g, (whole: string, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  )
}
