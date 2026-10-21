import type { EffectParamValue, ParamDef } from '../effects/registry'

/** A prop's value: the same scalar set as effect params. */
export type PropValue = EffectParamValue

/** ParamDef's five kinds, plus media URLs and a registered font id (PV-P4a). */
export type PropType = ParamDef['type'] | 'image' | 'video' | 'audio' | 'fontId'

export const PROP_TYPES: ReadonlyArray<PropType> = [
  'text', 'number', 'color', 'boolean', 'enum', 'image', 'video', 'audio', 'fontId',
]

/** Prop names are identifiers, so `{name}` templates, `prop("name")` and CSV headers all work. */
export const PROP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/

/**
 * One input of a composition (PV-P7). Reuses the effect registry's ParamDef
 * vocabulary so the Inspector draws the same controls: min/max/step/integer for
 * numbers, options for enums, maxLength for text. `keyframeable` is meaningless
 * for a prop and is left out.
 */
export interface PropDef extends Omit<ParamDef, 'type' | 'default' | 'keyframeable'> {
  name: string
  type: PropType
  default: PropValue
  /** Help text shown under the prop's editor. */
  description?: string
}

/**
 * Writes one prop into one clip field. `clipId` is a path through compounds:
 * 'abc' is a root clip, 'abc/def' is clip 'def' inside compound clip 'abc'.
 * `path` is a field path on that clip (paths.ts). With `template`, the value
 * written is the template with every `{propName}` replaced.
 */
export interface Binding {
  clipId: string
  path: string
  prop: string
  template?: string
}

/** A project as a function of props (PV-P7). Optional; absent = an ordinary project. */
export interface ProjectComposition {
  props: PropDef[]
  bindings: Binding[]
  /** Current value per prop; a missing entry means the prop's default. */
  values?: Record<string, PropValue>
}

export type PropIssueCode =
  | 'unknown-prop' | 'wrong-type' | 'out-of-range' | 'bad-color'
  | 'not-an-option' | 'too-long' | 'bad-url' | 'unknown-font'

export interface PropIssue {
  kind: 'prop'
  prop: string
  code: PropIssueCode
  severity: 'error' | 'warning'
  message: string
}

export type BindingIssueCode =
  | 'unknown-prop' | 'bad-clip-path' | 'missing-clip' | 'not-compound'
  | 'bad-path' | 'missing-target' | 'type-mismatch'

/** Produced by instantiate (PV-P7a-2); declared here so the model is in one file. */
export interface BindingIssue {
  kind: 'binding'
  binding: Binding
  code: BindingIssueCode
  severity: 'warning'
  message: string
}

export type CompositionIssue = PropIssue | BindingIssue
