/**
 * Motion systems (MI-P3) — behaviours the model can NAME instead of hand-keying.
 *
 * ---------------------------------------------------------------------------
 * Why a second authored layer
 * ---------------------------------------------------------------------------
 * A component (AV-8) is a finished piece of design: a title, a chip cloud. A
 * SYSTEM is a behaviour applied to elements the author already wrote, or a
 * crowd the author describes once: "twelve of these multiply and bounce",
 * "everything on screen pushes outward from here", "freeze at 9 s", "these
 * ten snap into a 2 x 5 grid", "pull the camera back". Each is hand-keyable
 * today (the explainer reel proves it) but costs a model dozens of keys per
 * behaviour, and it gets the craft wrong in a different way every time.
 *
 *   AuthoredSpec --expandComponents--> VideoSpec --polish--> VideoSpec --compile--> Project
 *                       |                                                     |
 *                  expands `system`                                 `lowerAuthoredFields`
 *                  elements here                                    (matte / fxKeys / path keys)
 *
 * A system is lowered by `expandComponents` to ordinary `SpecElement`s and keys,
 * exactly as a component is, so the compiler and the frozen `spec/types.ts`
 * never learn about it.
 *
 * `matte` and `fxKeys` are a second, unrelated reach extension: two things the
 * compiler cannot say (a track matte by element id; keys on an effect
 * parameter). They ride on the authored element and `lowering.ts` applies them
 * to the COMPILED clip, where the clip ids and the effect ids finally exist.
 */

import type { SpecElement } from '../types'
import type { AuthoredElement, ComponentContext } from '../components/types'

export const SYSTEM_NAMES = ['swarm', 'radialPush', 'freeze', 'arrange', 'crossMorph', 'camera'] as const
export type SystemName = (typeof SYSTEM_NAMES)[number]

/**
 * A system in the document. Shaped like `SpecComponent` so the flat JSON "bag"
 * the model answers with needs only `system`, `targets` and `template` beyond
 * what a component already uses.
 *
 * `x`/`y`/`w`/`h` are the system's own region: the swarm's scatter region
 * (`x`,`y` its centre as stage fractions, `w`,`h` in px), the radial push's
 * and the arrange layout's origin.
 */
export interface SpecSystem {
  id: string
  kind: 'system'
  system: string
  /** Seconds from the start of the video, or of the group that holds it. */
  at: number
  duration: number
  layer?: number
  /** Ids of SIBLING elements (same level) the system acts on, or the id of an earlier system to act on everything it emitted. */
  targets?: string[]
  /** `swarm` only: the element copied. A raw element; a component or system here is an error. */
  template?: AuthoredElement
  /** Anything else the system documents, as `{ name, value }` rows (see its SYSTEMS line). */
  params?: Array<{ name: string; value: number | string | boolean }>
  x?: number
  y?: number
  w?: number
  h?: number
}

/** `matte` on an authored element: cut it by a SIBLING element's alpha or luminance. The matte element is hidden by the renderer. */
export interface SpecMatte {
  /** Another element at the same nesting level. */
  element: string
  kind: 'alpha' | 'luma'
  invert?: boolean
}

/** One key on an effect parameter, on the element that carries the effect. `at` is seconds from the start of that element. */
export interface SpecFxKey {
  /** The effect KIND on this element (`gaussianBlur`); the first effect of that kind is keyed. */
  effect: string
  param: string
  at: number
  value: number
  /** As `SpecKey.curve`. */
  curve?: string
  hold?: boolean
}

/** The authored-only fields a raw element may carry. Applied after compile by `lowerAuthoredFields`. */
export interface AuthoredFields {
  matte?: SpecMatte
  fxKeys?: SpecFxKey[]
}

/**
 * Internal, never model-facing: set by `crossMorph` on its `from` element when
 * both ends are path shapes sharing a viewBox. `lowerAuthoredFields` turns it
 * into two `shape.path` keys on the compiled `from` clip.
 */
export interface PathMorphField {
  /** The `to` element's id. */
  to: string
  /** Seconds from the start of the `from` element. */
  at: number
  duration: number
}

export type LoweredElement = SpecElement & AuthoredFields & { pathMorph?: PathMorphField }

// ---------------------------------------------------------------------------
// The registry contract
// ---------------------------------------------------------------------------

export type SystemParamValue = number | string | boolean

export interface SystemParamDef {
  name: string
  kind: 'number' | 'boolean' | 'enum' | 'id'
  default: SystemParamValue | undefined
  /** `number`: the accepted range; outside it the value is clamped with a `warn`. */
  min?: number
  max?: number
  /** `number`: shown in the prompt line, e.g. `px`, `s`. */
  unit?: string
  /** `enum`: the accepted values. */
  options?: ReadonlyArray<string>
}

export interface SystemInput {
  system: SpecSystem
  /** Every declared param, resolved: the author's value if valid, else the default. */
  params: Readonly<Record<string, SystemParamValue | undefined>>
  /** `system.targets` resolved to the live sibling elements, in the order named. */
  targets: SpecElement[]
  /** Every element at this level right now (for ids a system names in `params`). */
  level: ReadonlyArray<SpecElement>
  /** `template`, when the def takes one and it is a usable raw element. */
  template: SpecElement | undefined
  /** `ComponentContext` shape so `components/motion.ts` helpers work unchanged. Seeded per system id. */
  ctx: ComponentContext
}

export interface SystemOutput {
  /** New elements, ids prefixed `${system.id}-`. */
  emit: SpecElement[]
  /** Replacements for existing siblings, matched by id. */
  update: SpecElement[]
  /** Siblings moved elsewhere (into an emitted group). */
  remove: string[]
}

export interface SystemDef {
  name: SystemName
  /** One line for the prompt: what it does and when to reach for it. */
  hint: string
  /** Does it act on `targets`? Shown as `targets: yes|no` in the prompt. */
  targets: boolean
  /** Does it take a `template` element? */
  template: boolean
  params: ReadonlyArray<SystemParamDef>
  /** Seconds; the system's `duration` is clamped to it with a `warn`. */
  duration: { min: number; max: number }
  /** Pure: reads its input, returns what to add, replace and remove. Issues go to `input.ctx.issues`. */
  apply(input: SystemInput): SystemOutput
}
