import type { TimelineEngine } from '../editor/TimelineEngine'
import type { Clip, Project } from '../types'
import { instantiate } from './instantiate'
import type { CompositionIssue, ProjectComposition } from './types'

export interface CommitResult {
  ok: boolean
  issues: CompositionIssue[]
  /** Root clip ids whose fields were rewritten (a compound counts when a child changed). */
  changedClipIds: string[]
}

/**
 * Diff `before` against `next` bucket by bucket (by track, in order) and push
 * every changed clip's patch through `engine.updateClip`. Clips no binding
 * touched stay reference-equal (per `instantiate`'s contract), so a plain `===`
 * check per slot is enough — never a deep compare.
 */
function applyInstantiated(engine: TimelineEngine, before: Project, next: Project): string[] {
  const changed: string[] = []
  for (const track of before.tracks) {
    const a = before.clips[track.id] ?? []
    const b = next.clips[track.id] ?? []
    for (let i = 0; i < a.length; i++) {
      const ca = a[i]!
      const cb = b[i]
      if (!cb || ca === cb) continue
      const patch: Partial<Clip> = {}
      const keys = new Set([...Object.keys(ca), ...Object.keys(cb)])
      for (const key of keys) {
        const av = (ca as unknown as Record<string, unknown>)[key]
        const bv = (cb as unknown as Record<string, unknown>)[key]
        if (av !== bv) (patch as Record<string, unknown>)[key] = bv
      }
      if (Object.keys(patch).length > 0) {
        engine.updateClip(ca.id, track.id, patch)
        changed.push(ca.id)
      }
    }
  }
  return changed
}

/**
 * Store `next` (null, or one with no props, removes the composition) and
 * re-apply every binding with the current values (stored, else default). One
 * undo step: `setComposition` and every rewritten clip's `updateClip` collapse
 * into one history entry because they all run inside this one `engine.batch`.
 */
export function commitComposition(
  engine: TimelineEngine,
  next: ProjectComposition | null,
  description = 'Edit composition',
): CommitResult {
  const result: CommitResult = { ok: true, issues: [], changedClipIds: [] }
  engine.batch(() => {
    engine.setComposition(next, description)
    const project = engine.getProject()
    if (!project.composition) return
    const inst = instantiate(project, {}, { seed: 0 })
    result.changedClipIds = applyInstantiated(engine, project, inst.project)
    if (inst.project.composition !== project.composition) {
      engine.setComposition(inst.project.composition ?? null, description)
    }
    result.issues = inst.issues
  }, description)
  return result
}

/**
 * Validate `values` (only the names given), store them and rewrite every
 * bound field. One undo step. Refuses (writes nothing) when a given value has
 * an 'error' issue, or when the project has no composition at all.
 */
export function commitPropValues(
  engine: TimelineEngine,
  values: Readonly<Record<string, unknown>>,
  description = 'Set prop',
): CommitResult {
  const project = engine.getProject()
  if (!project.composition) {
    return {
      ok: false,
      issues: Object.keys(values).map((k) => ({
        kind: 'prop' as const,
        prop: k,
        code: 'unknown-prop' as const,
        severity: 'warning' as const,
        message: `No prop named "${k}"`,
      })),
      changedClipIds: [],
    }
  }

  const inst = instantiate(project, values, { seed: 0 })
  if (inst.issues.some((i) => i.kind === 'prop' && i.severity === 'error')) {
    return { ok: false, issues: inst.issues, changedClipIds: [] }
  }

  let changed: string[] = []
  engine.batch(() => {
    engine.setComposition(inst.project.composition ?? null, description)
    changed = applyInstantiated(engine, project, inst.project)
  }, description)
  return { ok: true, issues: inst.issues, changedClipIds: changed }
}
