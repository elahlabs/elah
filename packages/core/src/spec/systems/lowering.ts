/**
 * Post-compile lowering (MI-P3): the authored fields the compiler cannot reach.
 *
 * `compileLevel` builds clips from the fields it knows and ignores the rest, so
 * an authored element may carry three extra fields through expand and polish
 * untouched and be applied here, to the COMPILED clips, where the two things
 * they need finally exist: clip ids (a matte names another clip) and effect ids
 * (a key on an effect parameter is the channel `fx.<effectId>.<param>`).
 *
 *   matte      { element, kind, invert }      -> Clip.matte
 *   fxKeys     [{ effect, param, at, value }] -> keys on fx.<id>.<param>
 *   pathMorph  (internal, from crossMorph)    -> two shape.path keys
 *
 * A project with none of the three is returned untouched and no issue is added,
 * so a document without systems compiles to exactly what it did before.
 *
 * Every failure is an `error` issue and the entry is dropped; the element stays.
 */

import type { Clip, Project } from '../../types'
import { EFFECT_REGISTRY } from '../../effects/registry'
import { setKeyframe, setPathKeyframe } from '../../elements/keyframes'
import { effectChannel } from '../../resolver/keyframes'
import { resolveCurve } from '../curves'
import type { CompileResult, SpecElement, SpecIssue, VideoSpec } from '../types'
import type { AuthoredFields, PathMorphField } from './types'

type Carrier = SpecElement & AuthoredFields & { pathMorph?: PathMorphField }

interface Found {
  el: Carrier
  path: string
}

/** Every element in `elements` (and inside groups) that carries a lowered field, with its spec path. */
function collect(elements: ReadonlyArray<SpecElement>, prefix: string, out: Found[]): void {
  elements.forEach((el, i) => {
    const path = `${prefix}[${i}]`
    const c = el as Carrier
    if (c.matte || (c.fxKeys && c.fxKeys.length > 0) || c.pathMorph) out.push({ el: c, path })
    if (el.children) collect(el.children, `${path}.children`, out)
  })
}

interface Slot {
  /** The record (`Project.clips`) this clip lives in: two clips share a level iff they share it. */
  record: Project['clips']
  list: Clip[]
  index: number
}

function indexProject(project: Project, slots: Map<string, Slot>): void {
  for (const list of Object.values(project.clips)) {
    list.forEach((clip, index) => {
      slots.set(clip.id, { record: project.clips, list, index })
      if (clip.compound?.project) indexProject(clip.compound.project, slots)
    })
  }
}

/**
 * Apply `matte`, `fxKeys` and `pathMorph` found in `spec` to `compiled.project`, in place.
 * Returns the issues it raised (the caller appends them to the compile's).
 */
export function lowerAuthoredFields(spec: VideoSpec, compiled: CompileResult): SpecIssue[] {
  const found: Found[] = []
  collect(spec.elements ?? [], 'elements', found)
  if (found.length === 0) return []

  const issues: SpecIssue[] = []
  const slots = new Map<string, Slot>()
  indexProject(compiled.project, slots)
  const fps = compiled.project.fps > 0 ? compiled.project.fps : 30

  const clipOf = (elementId: string): { clip: Clip; slot: Slot } | undefined => {
    const clipId = compiled.elementClipIds[elementId]
    const slot = clipId ? slots.get(clipId) : undefined
    return slot ? { clip: slot.list[slot.index]!, slot } : undefined
  }
  const write = (slot: Slot, patch: Partial<Clip>) => {
    slot.list[slot.index] = { ...slot.list[slot.index]!, ...patch }
  }

  for (const { el, path } of found) {
    const self = clipOf(el.id)
    if (!self) continue // never compiled (a flattened or failed element): nothing to lower onto

    // --- matte ---------------------------------------------------------------
    if (el.matte) {
      const mPath = `${path}.matte`
      const { element, kind, invert } = el.matte
      const source = clipOf(element)
      if (kind !== 'alpha' && kind !== 'luma') {
        issues.push({ severity: 'error', path: `${mPath}.kind`, code: 'unknown-matte-kind', message: `matte kind must be alpha or luma, not "${String(kind)}"` })
      } else if (!source) {
        issues.push({ severity: 'error', path: `${mPath}.element`, code: 'bad-reference', message: `matte: no element "${String(element)}"` })
      } else if (source.clip.id === self.clip.id) {
        issues.push({ severity: 'error', path: `${mPath}.element`, code: 'bad-matte', message: 'matte: an element cannot be its own matte' })
      } else if (source.slot.record !== self.slot.record) {
        issues.push({
          severity: 'error',
          path: `${mPath}.element`,
          code: 'matte-cross-level',
          message: `matte: "${element}" is at a different nesting level than "${el.id}"; a matte and its target must be siblings`,
        })
      } else {
        write(self.slot, { matte: { sourceClipId: source.clip.id, kind, ...(invert ? { invert: true } : {}) } })
      }
    }

    // --- fxKeys --------------------------------------------------------------
    ;(el.fxKeys ?? []).forEach((fk, i) => {
      const kPath = `${path}.fxKeys[${i}]`
      const current = clipOf(el.id)!.clip
      const def = EFFECT_REGISTRY.get(fk.effect)
      if (!def) {
        issues.push({ severity: 'error', path: `${kPath}.effect`, code: 'unknown-effect', message: `unknown effect "${String(fk.effect)}"` })
        return
      }
      const param = def.params[fk.param]
      if (!param) {
        issues.push({ severity: 'error', path: `${kPath}.param`, code: 'unknown-param', message: `effect "${fk.effect}" has no param "${String(fk.param)}"` })
        return
      }
      if (param.type !== 'number' || !param.keyframeable) {
        issues.push({ severity: 'error', path: `${kPath}.param`, code: 'param-not-keyable', message: `effect "${fk.effect}" param "${fk.param}" is not a keyable number` })
        return
      }
      const effect = current.effects?.find((e) => e.kind === fk.effect)
      if (!effect) {
        issues.push({ severity: 'error', path: `${kPath}.effect`, code: 'effect-missing', message: `"${el.id}" has no "${fk.effect}" effect to key; add it to effects first` })
        return
      }
      const lo = param.min ?? -Infinity
      const hi = param.max ?? Infinity
      const value = Math.min(hi, Math.max(lo, fk.value))
      if (value !== fk.value) {
        issues.push({ severity: 'warn', path: `${kPath}.value`, code: 'clamped', message: `${fk.effect}.${fk.param} runs ${lo}–${hi}; ${fk.value} became ${value}` })
      }
      const curve = resolveCurve(fk.curve, `${kPath}.curve`, issues)
      const frame = Math.max(0, Math.min(Math.max(0, current.durationFrames - 1), Math.round(fk.at * fps)))
      const patch = setKeyframe(current, effectChannel(effect.id, fk.param), frame, { stage: compiled.project.stage }, value, {
        easing: curve.easing,
        ...(curve.easingBezier ? { easingBezier: [...curve.easingBezier] as [number, number, number, number] } : {}),
        ...(curve.spring ? { spring: curve.spring } : {}),
        ...(fk.hold ? { hold: true as const } : {}),
      })
      write(self.slot, patch)
    })

    // --- pathMorph -------------------------------------------------------------
    if (el.pathMorph) {
      const mPath = `${path}.pathMorph`
      const to = clipOf(el.pathMorph.to)
      const from = clipOf(el.id)!.clip
      if (!to) {
        issues.push({ severity: 'error', path: mPath, code: 'bad-reference', message: `crossMorph: no element "${el.pathMorph.to}" to morph into` })
      } else if (!from.shapePath || !to.clip.shapePath) {
        issues.push({ severity: 'warn', path: mPath, code: 'morph-skipped', message: 'crossMorph: both ends need a path; left as a crossfade' })
      } else {
        const start = Math.max(0, Math.min(Math.max(0, from.durationFrames - 1), Math.round(el.pathMorph.at * fps)))
        const end = Math.max(0, Math.min(Math.max(0, from.durationFrames - 1), start + Math.round(el.pathMorph.duration * fps)))
        if (end <= start) {
          issues.push({ severity: 'warn', path: mPath, code: 'morph-skipped', message: 'crossMorph: the morph is shorter than a frame; left as a crossfade' })
        } else {
          write(self.slot, setPathKeyframe(from, start, from.shapePath))
          write(self.slot, setPathKeyframe(clipOf(el.id)!.clip, end, to.clip.shapePath, { easing: 'quad-in-out' }))
        }
      }
    }
  }
  return issues
}
