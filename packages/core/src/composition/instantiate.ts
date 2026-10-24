import { produce } from 'immer'
import type { Clip, Project } from '../types'
import { withSeededIds } from '../utils/id'
import { getAtPath, interpolateTemplate, parseClipPath, parseFieldPath, setAtPath } from './paths'
import { regenerateIds } from './regenerateIds'
import type { Binding, BindingIssueCode, CompositionIssue, ProjectComposition, PropValue } from './types'
import { validateProps } from './validate'

export interface InstantiateOptions {
  /** Seeds every id `instantiate` creates (only with `regenerateIds`). Same seed + same input = identical output. */
  seed: number
  /** Give every project, track, clip, transition, marker and group a fresh id, compounds included. Default false. */
  regenerateIds?: boolean
}

export interface InstantiateResult {
  project: Project
  /** Every prop's value as written: validated, defaults filled. `{}` when the project has no composition. */
  values: Record<string, PropValue>
  /** Prop issues from `validateProps` plus binding issues (warnings). Rows with an 'error' issue are the caller's to refuse. */
  issues: CompositionIssue[]
}

/** A field written by a `src` binding also loses its `assetId`: the old id
 *  names another file's filmstrip and intrinsic size, which no longer applies. */
const STRING_FIELDS = new Set([
  'content', 'src', 'color', 'fontId', 'fontFamily', 'shapeFill', 'shapeStroke', 'strokeColor', 'backgroundColor', 'borderColor', 'name',
])

function shallowEqual(a: Readonly<Record<string, PropValue>>, b: Readonly<Record<string, PropValue>>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!Object.is(a[k], b[k])) return false
  }
  return true
}

type FindResult =
  | { ok: true; clip: Clip }
  | { ok: false; code: 'missing-clip' | 'not-compound'; segment: string }

/** Walk a clip path's segments through a project and its nested compounds. */
function findClipByPath(project: Project, segs: readonly string[]): FindResult {
  let p = project
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    let found: Clip | undefined
    for (const t of p.tracks) {
      found = (p.clips[t.id] ?? []).find((c) => c.id === seg)
      if (found) break
    }
    if (!found) return { ok: false, code: 'missing-clip', segment: seg }
    if (i === segs.length - 1) return { ok: true, clip: found }
    if (found.type !== 'compound' || !found.compound?.project) {
      return { ok: false, code: 'not-compound', segment: seg }
    }
    p = found.compound.project
  }
  // parseClipPath never returns an empty array, so this is unreachable.
  return { ok: false, code: 'missing-clip', segment: '' }
}

function pushIssue(issues: CompositionIssue[], b: Binding, code: BindingIssueCode, message: string): void {
  issues.push({ kind: 'binding', binding: b, code, severity: 'warning', message })
}

/** Apply one binding to the draft in place, per the ticket's Design. Every
 *  failure pushes a warning `BindingIssue` and returns without writing. */
function applyBinding(
  draft: Project,
  comp: ProjectComposition,
  b: Binding,
  values: Readonly<Record<string, PropValue>>,
  issues: CompositionIssue[],
): void {
  const def = comp.props.find((p) => p.name === b.prop)
  if (!def) {
    pushIssue(issues, b, 'unknown-prop', `Prop "${b.prop}" is not defined`)
    return
  }

  const segs = parseClipPath(b.clipId)
  if (!segs) {
    pushIssue(issues, b, 'bad-clip-path', `Bad clip path "${b.clipId}"`)
    return
  }

  const found = findClipByPath(draft, segs)
  if (!found.ok) {
    if (found.code === 'missing-clip') pushIssue(issues, b, 'missing-clip', `No clip "${b.clipId}"`)
    else pushIssue(issues, b, 'not-compound', `Clip "${found.segment}" is not a compound`)
    return
  }
  const clip = found.clip

  const field = parseFieldPath(b.path)
  if (!field) {
    pushIssue(issues, b, 'bad-path', `Cannot bind "${b.path}"`)
    return
  }

  const raw = b.template !== undefined ? interpolateTemplate(b.template, values) : values[b.prop]

  const current = getAtPath(clip, field)
  let value: unknown
  if ((typeof current === 'number' && typeof raw !== 'number') || (typeof current === 'boolean' && typeof raw !== 'boolean')) {
    pushIssue(issues, b, 'type-mismatch', `"${b.path}" holds a ${typeof current}; prop "${b.prop}" gave a ${typeof raw}`)
    return
  }
  if (typeof current === 'string' || (current === undefined && field.length === 1 && STRING_FIELDS.has(field[0] as string))) {
    value = String(raw)
  } else {
    value = raw
  }

  const r = setAtPath(clip, field, value)
  if (r === 'missing-target') {
    pushIssue(issues, b, 'missing-target', `"${b.path}" does not exist on clip "${b.clipId}"`)
    return
  }
  if (r === 'ok' && field.length === 1 && field[0] === 'src') {
    delete (clip as { assetId?: string }).assetId
  }
}

/**
 * `instantiate(project, values, { seed, regenerateIds? })` returns a new
 * project with every binding written and the validated values stored. The
 * input is untouched, and clips no binding touches stay reference-equal.
 */
export function instantiate(
  project: Project,
  values: Readonly<Record<string, unknown>>,
  options: InstantiateOptions,
): InstantiateResult {
  const comp = project.composition
  if (!comp) {
    const issues: CompositionIssue[] = Object.keys(values).map((k) => ({
      kind: 'prop',
      prop: k,
      code: 'unknown-prop',
      severity: 'warning',
      message: `No prop named "${k}"`,
    }))
    const out = options.regenerateIds ? withSeededIds(options.seed, () => regenerateIds(project)) : project
    return { project: out, values: {}, issues }
  }

  const v = validateProps(comp.props, values, comp.values)
  const issues: CompositionIssue[] = [...v.issues]

  let next = produce(project, (draft) => {
    for (const b of comp.bindings) applyBinding(draft as unknown as Project, comp, b, v.values, issues)
    if (!shallowEqual(comp.values ?? {}, v.values)) {
      draft.composition!.values = v.values
    }
  })

  if (options.regenerateIds) {
    next = withSeededIds(options.seed, () => regenerateIds(next))
  }

  return { project: next, values: v.values, issues }
}
