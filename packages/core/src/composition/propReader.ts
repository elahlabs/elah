import type { Project } from '../types'
import type { ProjectComposition } from './types'

/** `prop(name)` for expressions: the current value, else the default, else `undefined` for an unknown name. */
export type PropReader = (name: string) => number | string | undefined

/**
 * `prop(name)` for expressions: the composition's stored value for `name`, else
 * its prop's default, else `undefined` when no prop has that name. A boolean
 * value (stored or default) reads as `1`/`0`, since the expression language has
 * no boolean type — `ExprEnv.prop` only ever returns a number or a string.
 */
export function compositionPropReader(composition: ProjectComposition): PropReader {
  return (name: string): number | string | undefined => {
    const def = composition.props.find((p) => p.name === name)
    if (!def) return undefined
    const stored = composition.values?.[name]
    const raw = stored !== undefined ? stored : def.default
    if (typeof raw === 'boolean') return raw ? 1 : 0
    return raw
  }
}

const readers = new WeakMap<ProjectComposition, PropReader>()

/**
 * `compositionPropReader`, memoised per composition object so a resolve does
 * not rebuild it every frame. `undefined` when the project has no composition
 * — the caller (`createExpressionContext`) then leaves `env.prop` unset,
 * exactly as before this ticket.
 */
export function propReaderFor(project: Pick<Project, 'composition'>): PropReader | undefined {
  const composition = project.composition
  if (!composition) return undefined
  let reader = readers.get(composition)
  if (!reader) {
    reader = compositionPropReader(composition)
    readers.set(composition, reader)
  }
  return reader
}
